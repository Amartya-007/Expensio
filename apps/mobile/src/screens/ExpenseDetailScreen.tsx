import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  AlertCircle,
  ArrowLeft,
  Calendar,
  MessageSquare,
  Pencil,
  Trash2,
  User,
  Users,
  X,
} from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { format, parseISO } from 'date-fns';
import { db } from '../powersync/db';
import { callRpc } from '../rpc';
import { formatError } from '../utils/errors';
import { LIMITS, validateExpenseDescription, validateExpenseAmount, validateCommentBody } from '../constants/limits';
import PrimaryButton from '../components/PrimaryButton';

type Expense = {
  id: string; description: string; amount: number; currency: string;
  paid_by: string; category: string | null; expense_date: string | null; created_at: string;
};
type Participant = { id: string; display_name: string };
type Split = { participant_id: string; share_amount: number };
type Comment = { id: string; body: string; comment_type: string; created_at: string };

function formatTs(iso: string) {
  return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export default function ExpenseDetailScreen({
  expenseId,
  onBack,
}: {
  expenseId: string;
  onBack: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [expense, setExpense] = useState<Expense | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [splits, setSplits] = useState<Split[]>([]);
  const [comments, setComments] = useState<Comment[]>([]);
  const [comment, setComment] = useState('');
  const [commentBusy, setCommentBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  // Tracks whether we have already seeded the edit fields from the expense row.
  // Using a ref instead of state avoids triggering a re-render on first seed.
  const hydratedRef = useRef(false);

  useEffect(() => {
    const ac = new AbortController();
    db.watch(
      'SELECT id, description, amount, currency, paid_by, category, expense_date, created_at FROM expenses WHERE id = ? AND deleted_at IS NULL',
      [expenseId],
      { onResult: r => {
        const row = r.rows?._array?.[0] ?? null;
        setExpense(row);
        // Seed edit fields only once — a remote sync update arriving while the user
        // is editing should never clobber their in-progress changes.
        if (row && !hydratedRef.current) {
          hydratedRef.current = true;
          setDescription(row.description);
          setAmount(String(row.amount));
        }
      }},
      { signal: ac.signal }
    );
    return () => ac.abort();
  // eslint-disable-next-line react-hooks/exhaustive-deps -- hydratedRef is a ref, not reactive state
  }, [expenseId]);

  useEffect(() => {
    const ac = new AbortController();
    db.watch(
      'SELECT id, body, comment_type, created_at FROM expense_comments WHERE expense_id = ? ORDER BY created_at ASC',
      [expenseId],
      { onResult: r => setComments(r.rows?._array ?? []) },
      { signal: ac.signal }
    );
    return () => ac.abort();
  }, [expenseId]);

  useEffect(() => {
    if (!expense) return;
    const ac = new AbortController();
    db.watch(
      // deleted_at IS NULL on the inner SELECT so that if the expense is soft-deleted
      // while this screen is open, the trip_id subquery resolves correctly.
      'SELECT id, display_name FROM participants WHERE trip_id = (SELECT trip_id FROM expenses WHERE id = ? AND deleted_at IS NULL)',
      [expenseId],
      { onResult: r => setParticipants(r.rows?._array ?? []) },
      { signal: ac.signal }
    );
    return () => ac.abort();
  }, [expenseId, expense]);

  useEffect(() => {
    const ac = new AbortController();
    db.watch(
      // expense_splits has no soft-delete column in the current schema, but
      // guard here in case it is added later.
      'SELECT participant_id, share_amount FROM expense_splits WHERE expense_id = ?',
      [expenseId],
      { onResult: r => setSplits(r.rows?._array ?? []) },
      { signal: ac.signal }
    );
    return () => ac.abort();
  }, [expenseId]);

  const nameFor = (id: string) => participants.find(p => p.id === id)?.display_name ?? '…';

  async function saveEdit() {
    const descError = validateExpenseDescription(description);
    if (descError) { setError(descError); return; }
    const amountError = validateExpenseAmount(amount);
    if (amountError) { setError(amountError); return; }
    const parsed = parseFloat(amount);
    setBusy(true); setError(null);
    try {
      await callRpc('edit_expense', { p_expense_id: expenseId, p_description: description.trim(), p_amount: parsed, p_split_type: 'equal', p_split_config: {} });
      setEditing(false);
    } catch (err) { setError(formatError(err)); }
    finally { setBusy(false); }
  }

  async function doDelete() {
    setBusy(true);
    try {
      await callRpc('delete_expense', { p_expense_id: expenseId });
      onBack();
    } catch (err) { setError(formatError(err)); setBusy(false); setShowDeleteConfirm(false); }
  }

  async function addComment() {
    const body = comment.trim();
    const bodyError = validateCommentBody(body);
    if (bodyError) { setError(bodyError); return; }
    setCommentBusy(true); setError(null);
    try {
      await callRpc('add_comment', { p_expense_id: expenseId, p_body: body }, { idempotent: false });
      setComment('');
    } catch (err) { setError(formatError(err)); }
    finally { setCommentBusy(false); }
  }

  if (!expense) {
    return (
      <View style={[s.loadingShell, { paddingTop: Math.max(insets.top, 16) }]}>
        <Pressable onPress={onBack} style={s.backRow} hitSlop={8}>
          <ArrowLeft size={16} color="#475569" />
          <Text style={s.backText}>Back</Text>
        </Pressable>
        <Text style={s.loadingText}>Loading…</Text>
      </View>
    );
  }

  const expDate = expense.expense_date ? parseISO(expense.expense_date) : null;
  const createdAtLabel = expense.created_at ? format(new Date(expense.created_at), 'hh:mm a') : null;

  return (
    <ScrollView
      style={s.root}
      contentContainerStyle={{
        paddingTop: Math.max(insets.top, 16),
        paddingBottom: Math.max(insets.bottom, 16) + 32,
        paddingHorizontal: 16,
        gap: 12,
      }}
      showsVerticalScrollIndicator={false}
    >
      <Pressable onPress={onBack} style={s.backRow} hitSlop={8}>
        <ArrowLeft size={18} color="#334155" />
        <Text style={s.backText}>Back</Text>
      </Pressable>

      {!!error && !editing && (
        <View style={s.errorBanner}>
          <AlertCircle size={18} color="#e11d48" />
          <Text style={s.errorText}>{error}</Text>
        </View>
      )}

      {editing ? (
        <View style={s.editCard}>
          <Text style={s.editTitle}>Edit expense</Text>

          <Text style={s.fieldLabel}>Description</Text>
          <TextInput style={s.input} value={description} onChangeText={setDescription} maxLength={LIMITS.expense.description.max} />

          <Text style={[s.fieldLabel, { marginTop: 12 }]}>Amount ({expense.currency})</Text>
          <TextInput style={s.input} value={amount} onChangeText={setAmount} keyboardType="decimal-pad" maxLength={String(LIMITS.expense.amount.max).length + 3} />

          {!!error && <View style={s.errorBanner}><Text style={s.errorText}>{error}</Text></View>}

          <View style={s.editActions}>
            <Pressable
              onPress={() => setEditing(false)}
              disabled={busy}
              style={({ pressed }) => [s.cancelBtn, pressed && s.cancelBtnPressed]}
            >
              <Text style={s.cancelText}>Cancel</Text>
            </Pressable>
            <View style={{ flex: 1 }}>
              <PrimaryButton onPress={saveEdit} disabled={!description.trim() || !amount} loading={busy}>
                Save
              </PrimaryButton>
            </View>
          </View>
        </View>
      ) : (
        <>
          {/* Main detail card */}
          <View style={s.detailCard}>
            <View style={s.amountRow}>
              <View>
                <Text style={s.amountLabel}>Amount</Text>
                <Text style={s.amountValue}>
                  {expense.currency} {expense.amount.toFixed(2)}
                </Text>
              </View>
              {!!expense.category && (
                <View style={s.categoryBadge}>
                  <Text style={s.categoryBadgeText}>{expense.category}</Text>
                </View>
              )}
            </View>

            {!!expDate && (
              <View style={s.metaRow}>
                <Calendar size={15} color="#64748b" />
                <Text style={s.metaText}>{format(expDate, 'EEEE, MMM dd, yyyy')}</Text>
                {!!createdAtLabel && <Text style={s.metaTextRight}>added {createdAtLabel}</Text>}
              </View>
            )}

            <View style={s.paidBySection}>
              <Text style={s.fieldLabel}>Paid by</Text>
              <View style={s.paidByRow}>
                <View style={s.paidByIcon}>
                  <User size={14} color="#059669" />
                </View>
                <Text style={s.paidByName}>{nameFor(expense.paid_by)}</Text>
              </View>
            </View>

            {splits.length > 0 && (
              <View style={s.splitsSection}>
                <View style={s.splitsHeader}>
                  <Users size={12} color="#94a3b8" />
                  <Text style={s.fieldLabel}>Split between · {splits.length} people</Text>
                </View>
                <View style={s.splitsGrid}>
                  {splits.map(sp => {
                    const isPayer = sp.participant_id === expense.paid_by;
                    return (
                      <View key={sp.participant_id} style={[s.splitChip, isPayer ? s.splitChipPayer : s.splitChipNormal]}>
                        <View style={s.splitAvatar}>
                          <Text style={[s.splitAvatarText, isPayer ? s.splitAvatarTextPayer : s.splitAvatarTextNormal]}>
                            {nameFor(sp.participant_id)[0]?.toUpperCase()}
                          </Text>
                        </View>
                        <Text style={[s.splitName, isPayer ? s.splitNamePayer : s.splitNameNormal]}>
                          {nameFor(sp.participant_id)} · {expense.currency} {sp.share_amount.toFixed(2)}
                        </Text>
                        {isPayer && <Text style={s.paidTag}>paid</Text>}
                      </View>
                    );
                  })}
                </View>
              </View>
            )}
          </View>

          {/* Comments card */}
          <View style={s.commentsCard}>
            <View style={s.commentsHeader}>
              <MessageSquare size={13} color="#94a3b8" />
              <Text style={s.fieldLabel}>Comments</Text>
            </View>

            {comments.map(c => (
              <View key={c.id} style={s.commentRow}>
                <Text style={s.commentBody}>{c.body}</Text>
                <Text style={s.commentMeta}>
                  {c.comment_type === 'system' ? 'System' : 'Member'} · {formatTs(c.created_at)}
                </Text>
              </View>
            ))}

            <View style={s.commentInputRow}>
              <TextInput
                style={s.commentInput}
                value={comment}
                onChangeText={setComment}
                placeholder="Add a comment"
                placeholderTextColor="#94a3b8"
                maxLength={LIMITS.comment.body.max}
                multiline
              />
              <Pressable
                onPress={addComment}
                disabled={commentBusy || !comment.trim()}
                style={[s.sendBtn, (commentBusy || !comment.trim()) ? s.sendBtnDisabled : s.sendBtnActive]}
              >
                <Text style={[s.sendText, (commentBusy || !comment.trim()) ? s.sendTextDisabled : s.sendTextActive]}>
                  Send
                </Text>
              </Pressable>
            </View>
          </View>

          {/* Action buttons */}
          <View style={s.actionRow}>
            <Pressable
              onPress={() => setEditing(true)}
              style={({ pressed }) => [s.editBtn, pressed && s.editBtnPressed]}
            >
              <Pencil size={16} color="#475569" />
              <Text style={s.editBtnText}>Edit</Text>
            </Pressable>
            <Pressable
              onPress={() => setShowDeleteConfirm(true)}
              style={({ pressed }) => [s.deleteBtn, pressed && s.deleteBtnPressed]}
            >
              <Trash2 size={16} color="#e11d48" />
              <Text style={s.deleteBtnText}>Delete</Text>
            </Pressable>
          </View>
        </>
      )}

      {/* Delete confirmation modal — all inline styles, no className */}
      <Modal
        visible={showDeleteConfirm}
        transparent
        animationType="fade"
        onRequestClose={() => setShowDeleteConfirm(false)}
      >
        <Pressable
          style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: 'rgba(15,23,42,0.4)' }}
          onPress={() => !busy && setShowDeleteConfirm(false)}
        >
          <Pressable
            style={{ width: '100%', maxWidth: 360, backgroundColor: '#fff', borderRadius: 28, borderWidth: 2, borderColor: '#fecdd3', padding: 24, shadowColor: '#0f172a', shadowOffset: { width: 0, height: 20 }, shadowOpacity: 0.25, shadowRadius: 40, elevation: 12 }}
            onPress={e => e.stopPropagation()}
          >
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 16 }}>
              <View style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: '#fff1f2', borderWidth: 1, borderColor: '#fecdd3', alignItems: 'center', justifyContent: 'center' }}>
                <Trash2 size={20} color="#e11d48" />
              </View>
              <Pressable onPress={() => setShowDeleteConfirm(false)} disabled={busy} hitSlop={8}>
                <X size={20} color="#94a3b8" />
              </Pressable>
            </View>

            <Text style={{ fontSize: 18, fontWeight: '800', color: '#0f172a', marginBottom: 6 }}>Delete this expense?</Text>
            <Text style={{ fontSize: 13, fontWeight: '500', color: '#64748b', lineHeight: 20 }}>
              {expense.currency} {expense.amount.toFixed(2)}
              {expense.category ? ` · ${expense.category}` : ''} will be permanently removed.
            </Text>

            <View style={{ flexDirection: 'row', gap: 12, marginTop: 24 }}>
              <Pressable
                onPress={() => setShowDeleteConfirm(false)}
                disabled={busy}
                style={({ pressed }) => [{ flex:1, paddingVertical:14, borderRadius:16, backgroundColor: pressed ? '#e2e8f0' : '#f1f5f9', alignItems:'center', justifyContent:'center' }]}
              >
                <Text style={{ fontSize: 14, fontWeight: '700', color: '#334155' }}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={doDelete}
                disabled={busy}
                style={{ flex:1, paddingVertical:14, borderRadius:16, backgroundColor:'#e11d48', alignItems:'center', justifyContent:'center', flexDirection:'row', gap:8 }}
              >
                {busy ? <ActivityIndicator color="#fff" /> : <Text style={{ fontSize: 14, fontWeight: '700', color: '#fff' }}>Delete</Text>}
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#f8fafc' },
  loadingShell: { flex: 1, backgroundColor: '#f8fafc', paddingHorizontal: 16 },
  loadingText: { fontSize: 14, fontWeight: '600', color: '#94a3b8', textAlign: 'center', marginTop: 48 },

  backRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 },
  backText: { fontSize: 13, fontWeight: '700', color: '#334155' },

  errorBanner: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, backgroundColor: '#fff1f2', borderWidth: 1, borderColor: '#fecdd3', borderRadius: 14 },
  errorText: { flex: 1, fontSize: 13, fontWeight: '600', color: '#be123c' },

  // Edit card
  editCard: { backgroundColor: '#fff', borderRadius: 20, padding: 20, borderWidth: 1, borderColor: '#e2e8f0', gap: 8 },
  editTitle: { fontSize: 17, fontWeight: '800', color: '#0f172a' },
  fieldLabel: { fontSize: 11, fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.6 },
  input: { backgroundColor: '#f8fafc', borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, fontWeight: '600', color: '#0f172a' },
  editActions: { flexDirection: 'row', gap: 12, marginTop: 8 },
  cancelBtn: { flex: 1, paddingVertical: 14, borderRadius: 16, backgroundColor: '#f1f5f9', alignItems: 'center', justifyContent: 'center' },
  cancelBtnPressed: { backgroundColor: '#e2e8f0' },
  cancelText: { fontSize: 14, fontWeight: '700', color: '#334155' },

  // Detail card
  detailCard: { backgroundColor: '#fff', borderRadius: 24, padding: 20, borderWidth: 1, borderColor: '#e2e8f0', gap: 16, shadowColor: '#94a3b8', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 2 },
  amountRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 },
  amountLabel: { fontSize: 11, fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.6 },
  amountValue: { fontSize: 30, fontWeight: '900', color: '#0f172a', letterSpacing: -0.5, fontFamily: 'Inter_900Black' },
  categoryBadge: { backgroundColor: '#eff6ff', borderWidth: 1, borderColor: '#bfdbfe', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  categoryBadgeText: { fontSize: 11, fontWeight: '700', color: '#1d4ed8' },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  metaText: { fontSize: 13, fontWeight: '500', color: '#64748b', flex: 1 },
  metaTextRight: { fontSize: 11, fontWeight: '500', color: '#94a3b8' },
  paidBySection: { gap: 8 },
  paidByRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  paidByIcon: { width: 30, height: 30, borderRadius: 10, backgroundColor: '#ecfdf5', borderWidth: 1, borderColor: '#d1fae5', alignItems: 'center', justifyContent: 'center' },
  paidByName: { fontSize: 14, fontWeight: '600', color: '#334155' },
  splitsSection: { gap: 10 },
  splitsHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  splitsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  splitChip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 14, borderWidth: 1 },
  splitChipPayer: { backgroundColor: '#ecfdf5', borderColor: '#d1fae5' },
  splitChipNormal: { backgroundColor: '#f8fafc', borderColor: '#e2e8f0' },
  splitAvatar: { width: 18, height: 18, borderRadius: 9, backgroundColor: '#fff', borderWidth: 1, borderColor: '#e2e8f0', alignItems: 'center', justifyContent: 'center' },
  splitAvatarText: { fontSize: 9, fontWeight: '800' },
  splitAvatarTextPayer: { color: '#065f46' },
  splitAvatarTextNormal: { color: '#475569' },
  splitName: { fontSize: 12, fontWeight: '600' },
  splitNamePayer: { color: '#065f46' },
  splitNameNormal: { color: '#475569' },
  paidTag: { fontSize: 9, fontWeight: '800', color: '#16a34a' },

  // Comments card
  commentsCard: { backgroundColor: '#fff', borderRadius: 20, padding: 20, borderWidth: 1, borderColor: '#e2e8f0', gap: 12 },
  commentsHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  commentRow: { paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: '#f1f5f9', gap: 4 },
  commentBody: { fontSize: 13, fontWeight: '500', color: '#334155' },
  commentMeta: { fontSize: 11, fontWeight: '500', color: '#94a3b8' },
  commentInputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 10 },
  commentInput: { flex: 1, backgroundColor: '#f8fafc', borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 14, paddingHorizontal: 14, paddingVertical: 10, fontSize: 14, fontWeight: '500', color: '#0f172a' },
  sendBtn: { paddingHorizontal: 14, paddingVertical: 12, borderRadius: 14 },
  sendBtnActive: { backgroundColor: '#2563eb' },
  sendBtnDisabled: { backgroundColor: '#f1f5f9' },
  sendText: { fontSize: 13, fontWeight: '700' },
  sendTextActive: { color: '#fff' },
  sendTextDisabled: { color: '#94a3b8' },

  // Action row
  actionRow: { flexDirection: 'row', gap: 12 },
  editBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14, borderRadius: 16, backgroundColor: '#f1f5f9', borderWidth: 1, borderColor: '#e2e8f0' },
  editBtnPressed: { backgroundColor: '#e2e8f0' },
  editBtnText: { fontSize: 14, fontWeight: '700', color: '#475569' },
  deleteBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14, borderRadius: 16, backgroundColor: '#fff1f2', borderWidth: 1, borderColor: '#fecdd3' },
  deleteBtnPressed: { backgroundColor: '#ffe4e6' },
  deleteBtnText: { fontSize: 14, fontWeight: '700', color: '#e11d48' },
});
