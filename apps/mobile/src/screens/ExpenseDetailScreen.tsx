import { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { ArrowLeft, Calendar, MessageSquare, Pencil, Trash2, User, Users, X, AlertCircle } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { format, parseISO } from 'date-fns';
import { db } from '../powersync/db';
import { callRpc } from '../rpc';
import { formatError } from '../utils/errors';
import PrimaryButton from '../components/PrimaryButton';

type Expense = {
  id: string;
  description: string;
  amount: number;
  currency: string;
  paid_by: string;
  category: string | null;
  expense_date: string | null;
  created_at: string;
};
type Participant = { id: string; display_name: string };
type Split = { participant_id: string; share_amount: number };
type Comment = { id: string; body: string; comment_type: string; created_at: string };

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

// Ported from tripspend/src/screens/ExpenseDetail.tsx -- see
// docs/architecture/expensio-ui-port-plan.md for the general porting rules. What changed
// from the original beyond the RN adaptations documented there:
//
// - Dropped the `isLocked` / "locked for editing" amber banner entirely. It's driven by
//   `setup.lockPreviousDays`, which -- like the rest of TripSpend's budget concept -- has
//   no field anywhere in Expensio's `trips` table. Same schema gap the plan doc already
//   flags for Dashboard.tsx/TripDetails.tsx, just a smaller corner of it here.
// - Dropped the note/tags/receipts sections. `expenses` has no columns for any of the
//   three -- not a stylistic choice, there's nothing to display.
// - Added `category` and `expense_date` to the query and to the visual layout below.
//   The *original* Expensio screen didn't select either, even though both columns already
//   exist on `expenses` and `add_expense`'s RPC already accepts `p_category` -- this was
//   already-real data nothing was reading, not new scope invented for the port.
// - The split section shows each participant's actual `share_amount` from `expense_splits`
//   rather than TripSpend's single computed "per person share" figure. TripSpend's version
//   assumes an equal split (dividing amount by participant count); Expensio's data already
//   supports unequal splits once that UI lands (TASKS.md), so showing the real per-person
//   amount is strictly more correct here rather than baking in the equal-split assumption.
// - The delete confirmation is a real Modal (matching TripSpend's custom rose-ring card)
//   instead of the native Alert.alert() the previous version used.
// - Edit stays inline-in-this-screen (toggling `editing`), matching how this screen
//   already worked, rather than TripSpend's separate /edit/:id route -- restructuring to a
//   separate route wasn't needed to get the same visual result and would have meant
//   touching RootNavigator's routes for no visible difference.
export default function ExpenseDetailScreen({ expenseId, onBack }: { expenseId: string; onBack: () => void }) {
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

  useEffect(() => {
    const abortController = new AbortController();
    db.watch(
      'SELECT id, description, amount, currency, paid_by, category, expense_date, created_at FROM expenses WHERE id = ? AND deleted_at IS NULL',
      [expenseId],
      {
        onResult: (result) => {
          const row = result.rows?._array?.[0] ?? null;
          setExpense(row);
          if (row && description === '' && amount === '') {
            setDescription(row.description);
            setAmount(String(row.amount));
          }
        },
      },
      { signal: abortController.signal }
    );
    return () => abortController.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expenseId]);

  useEffect(() => {
    const abortController = new AbortController();
    db.watch(
      'SELECT id, body, comment_type, created_at FROM expense_comments WHERE expense_id = ? ORDER BY created_at ASC',
      [expenseId],
      { onResult: (result) => setComments(result.rows?._array ?? []) },
      { signal: abortController.signal }
    );
    return () => abortController.abort();
  }, [expenseId]);

  useEffect(() => {
    if (!expense) return;
    const abortController = new AbortController();
    db.watch(
      'SELECT id, display_name FROM participants WHERE trip_id = (SELECT trip_id FROM expenses WHERE id = ?)',
      [expenseId],
      { onResult: (result) => setParticipants(result.rows?._array ?? []) },
      { signal: abortController.signal }
    );
    return () => abortController.abort();
  }, [expenseId, expense]);

  useEffect(() => {
    const abortController = new AbortController();
    db.watch(
      'SELECT participant_id, share_amount FROM expense_splits WHERE expense_id = ?',
      [expenseId],
      { onResult: (result) => setSplits(result.rows?._array ?? []) },
      { signal: abortController.signal }
    );
    return () => abortController.abort();
  }, [expenseId]);

  const nameFor = (participantId: string) =>
    participants.find((p) => p.id === participantId)?.display_name ?? '…';

  async function saveEdit() {
    const parsedAmount = parseFloat(amount);
    if (!description.trim() || !parsedAmount || parsedAmount <= 0) return;
    setBusy(true);
    setError(null);
    try {
      await callRpc('edit_expense', {
        p_expense_id: expenseId,
        p_description: description.trim(),
        p_amount: parsedAmount,
        p_split_type: 'equal',
        p_split_config: {},
      });
      setEditing(false);
    } catch (err) {
      setError(formatError(err));
    } finally {
      setBusy(false);
    }
  }

  async function confirmDelete() {
    setBusy(true);
    try {
      await callRpc('delete_expense', { p_expense_id: expenseId });
      onBack();
    } catch (err) {
      setError(formatError(err));
      setBusy(false);
      setShowDeleteConfirm(false);
    }
  }

  async function addComment() {
    const body = comment.trim();
    if (!body) return;
    setCommentBusy(true);
    setError(null);
    try {
      await callRpc('add_comment', { p_expense_id: expenseId, p_body: body }, { idempotent: false });
      setComment('');
    } catch (err) {
      setError(formatError(err));
    } finally {
      setCommentBusy(false);
    }
  }

  if (!expense) {
    return (
      <View className="page-shell">
        <Pressable onPress={onBack} className="flex-row items-center gap-2 mb-4">
          <ArrowLeft size={16} color="#475569" />
          <Text className="text-sm font-semibold text-slate-600">Back</Text>
        </Pressable>
        <Text className="text-slate-400 text-center mt-10">Loading…</Text>
      </View>
    );
  }

  const expenseDate = expense.expense_date ? parseISO(expense.expense_date) : null;
  const createdAtLabel = expense.created_at ? format(new Date(expense.created_at), 'hh:mm a') : null;

  return (
    <ScrollView
      className="flex-1 bg-white"
      contentContainerStyle={{
        paddingTop: Math.max(insets.top, 16),
        paddingBottom: Math.max(insets.bottom, 16) + 32,
        paddingHorizontal: 16,
      }}
      showsVerticalScrollIndicator={false}
    >
      <Pressable onPress={onBack} className="flex-row items-center gap-2 py-1 -ml-1 mb-2">
        <ArrowLeft size={18} color="#1e293b" />
        <Text className="text-sm font-bold text-slate-800">Back</Text>
      </Pressable>

      {error && !editing && (
        <View className="p-4 bg-rose-50 border border-rose-200 rounded-2xl flex-row items-center gap-3">
          <AlertCircle size={20} color="#e11d48" />
          <Text className="text-sm text-rose-700 font-medium flex-1">{error}</Text>
        </View>
      )}

      {editing ? (
        <View className="card-elevated p-6 space-y-4">
          <Text className="text-lg font-black text-slate-900">Edit expense</Text>

          <View>
            <Text className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">What was it for?</Text>
            <TextInput className="input-field text-base text-slate-900" value={description} onChangeText={setDescription} />
          </View>

          <View>
            <Text className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
              Amount ({expense.currency})
            </Text>
            <TextInput
              className="input-field text-base text-slate-900"
              value={amount}
              onChangeText={setAmount}
              keyboardType="decimal-pad"
            />
          </View>

          {error && (
            <View className="bg-red-50 border border-red-200 rounded-2xl px-4 py-3">
              <Text className="text-sm text-red-700 font-medium">{error}</Text>
            </View>
          )}

          <View className="flex-row gap-3 pt-2">
            <Pressable
              onPress={() => setEditing(false)}
              disabled={busy}
              className="flex-1 py-3.5 rounded-2xl items-center justify-center active:bg-slate-100"
            >
              <Text className="text-slate-600 font-semibold text-sm">Cancel</Text>
            </Pressable>
            <View className="flex-1">
              <PrimaryButton onPress={saveEdit} disabled={!description.trim() || !amount} loading={busy} className="w-full">
                Save
              </PrimaryButton>
            </View>
          </View>
        </View>
      ) : (
        <>
          <View className="bg-white p-6 rounded-[2.5rem] border border-slate-100 shadow-sm space-y-4">
            <View className="flex-row items-start justify-between gap-3">
              <View>
                <Text className="text-xs font-bold text-slate-400 uppercase tracking-wider">Amount</Text>
                <Text className="text-3xl font-black text-slate-900">
                  {expense.currency} {expense.amount.toFixed(2)}
                </Text>
              </View>
              {expense.category && (
                <View className="badge-primary">
                  <Text className="text-xs font-bold text-blue-700">{expense.category}</Text>
                </View>
              )}
            </View>

            {expenseDate && (
              <View className="flex-row items-center gap-2">
                <Calendar size={16} color="#64748b" />
                <Text className="text-sm text-slate-500">{format(expenseDate, 'EEEE, MMM dd, yyyy')}</Text>
                {createdAtLabel && <Text className="ml-auto text-xs text-slate-400">added {createdAtLabel}</Text>}
              </View>
            )}

            <View>
              <Text className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Paid by</Text>
              <View className="flex-row items-center gap-2">
                <View className="w-7 h-7 bg-emerald-50 rounded-lg items-center justify-center border border-emerald-100">
                  <User size={14} color="#059669" />
                </View>
                <Text className="text-sm font-semibold text-slate-700">{nameFor(expense.paid_by)}</Text>
              </View>
            </View>

            {splits.length > 0 && (
              <View>
                <View className="flex-row items-center gap-1 mb-2">
                  <Users size={12} color="#94a3b8" />
                  <Text className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                    Split between · {splits.length} people
                  </Text>
                </View>
                <View className="flex-row flex-wrap gap-2">
                  {splits.map((s) => {
                    const isPayer = s.participant_id === expense.paid_by;
                    return (
                      <View
                        key={s.participant_id}
                        className={`flex-row items-center gap-1.5 px-3 py-1.5 rounded-xl border ${
                          isPayer ? 'bg-emerald-50 border-emerald-100' : 'bg-slate-50 border-slate-100'
                        }`}
                      >
                        <View className="w-4 h-4 rounded-full bg-white border border-current items-center justify-center">
                          <Text className={`text-[9px] font-black ${isPayer ? 'text-emerald-700' : 'text-slate-600'}`}>
                            {nameFor(s.participant_id)[0]?.toUpperCase()}
                          </Text>
                        </View>
                        <Text className={`text-xs font-semibold ${isPayer ? 'text-emerald-700' : 'text-slate-600'}`}>
                          {nameFor(s.participant_id)} · {expense.currency} {s.share_amount.toFixed(2)}
                        </Text>
                        {isPayer && <Text className="text-[9px] font-bold text-emerald-500">paid</Text>}
                      </View>
                    );
                  })}
                </View>
              </View>
            )}
          </View>

          {/* Comments -- merged back in from a parallel change on the same file
              (add_comment RPC + expense_comments watch query); not part of TripSpend's
              own ExpenseDetail.tsx, kept as its own card in the ported design language
              rather than dropped. */}
          <View className="card-elevated p-6 space-y-3">
            <View className="flex-row items-center gap-1">
              <MessageSquare size={12} color="#94a3b8" />
              <Text className="text-xs font-bold text-slate-400 uppercase tracking-wider">Comments</Text>
            </View>
            {comments.map((entry) => (
              <View key={entry.id} className="border-b border-slate-100 pb-2">
                <Text className="text-sm text-slate-700">{entry.body}</Text>
                <Text className="text-xs text-slate-400 mt-1">
                  {entry.comment_type === 'system' ? 'System' : 'Member'} · {formatTimestamp(entry.created_at)}
                </Text>
              </View>
            ))}
            <View className="flex-row gap-2 items-end">
              <TextInput
                className="input-field flex-1 text-sm text-slate-900"
                value={comment}
                onChangeText={setComment}
                placeholder="Add a comment"
                placeholderTextColor="#94a3b8"
                multiline
              />
              <Pressable
                onPress={addComment}
                disabled={commentBusy || !comment.trim()}
                className={`px-4 py-3 rounded-2xl ${commentBusy || !comment.trim() ? 'bg-slate-100' : 'bg-blue-600'}`}
              >
                <Text className={`text-sm font-semibold ${commentBusy || !comment.trim() ? 'text-slate-400' : 'text-white'}`}>
                  Send
                </Text>
              </Pressable>
            </View>
          </View>

          <View className="flex-row gap-3">
            <Pressable onPress={() => setEditing(true)} className="btn-secondary flex-1 flex-row items-center justify-center gap-2">
              <Pencil size={16} color="#475569" />
              <Text className="text-slate-600 font-bold text-sm">Edit</Text>
            </Pressable>
            <Pressable
              onPress={() => setShowDeleteConfirm(true)}
              className="btn-danger flex-1 flex-row items-center justify-center gap-2"
            >
              <Trash2 size={16} color="#e11d48" />
              <Text className="text-rose-600 font-bold text-sm">Delete</Text>
            </Pressable>
          </View>
        </>
      )}

      {/* NOTE: no shadow-*/bg-color-opacity classNames here (see DatePicker.tsx
          for why) -- inline styles instead avoid NativeWind's documented
          "Couldn't find a navigation context" race condition on first mount. */}
      <Modal visible={showDeleteConfirm} transparent animationType="fade" onRequestClose={() => setShowDeleteConfirm(false)}>
        <Pressable
          className="flex-1 items-center justify-center p-4"
          style={{ backgroundColor: 'rgba(15, 23, 42, 0.4)' }}
          onPress={() => !busy && setShowDeleteConfirm(false)}
        >
          <Pressable
            className="w-full max-w-sm bg-white rounded-[2rem] border-2 border-rose-200 p-6"
            style={{
              shadowColor: '#0f172a',
              shadowOffset: { width: 0, height: 20 },
              shadowOpacity: 0.25,
              shadowRadius: 40,
              elevation: 12,
            }}
            onPress={(e) => e.stopPropagation()}
          >
            <View className="flex-row items-start justify-between gap-3">
              <View className="w-10 h-10 rounded-2xl bg-rose-50 border border-rose-100 items-center justify-center">
                <Trash2 size={20} color="#e11d48" />
              </View>
              <Pressable onPress={() => setShowDeleteConfirm(false)} disabled={busy}>
                <X size={20} color="#94a3b8" />
              </Pressable>
            </View>

            <Text className="mt-4 text-lg font-black text-slate-900">Delete this expense?</Text>
            <Text className="mt-1 text-sm text-slate-500">
              {expense.currency} {expense.amount.toFixed(2)}
              {expense.category ? ` · ${expense.category}` : ''} will be permanently removed. This can't be undone.
            </Text>

            <View className="mt-6 flex-row gap-3">
              <Pressable
                onPress={() => setShowDeleteConfirm(false)}
                disabled={busy}
                className="flex-1 py-3 rounded-2xl bg-slate-100 items-center justify-center"
              >
                <Text className="text-slate-700 font-bold text-sm">Cancel</Text>
              </Pressable>
              <Pressable
                onPress={confirmDelete}
                disabled={busy}
                className="flex-1 py-3 rounded-2xl bg-rose-600 items-center justify-center flex-row gap-2"
              >
                {busy ? <ActivityIndicator color="#fff" /> : <Text className="text-white font-bold text-sm">Delete</Text>}
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </ScrollView>
  );
}
