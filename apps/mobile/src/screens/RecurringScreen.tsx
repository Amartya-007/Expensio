import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Repeat, Trash2 } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { db } from '../powersync/db';
import { callRpc } from '../rpc';
import { formatError } from '../utils/errors';
import { LIMITS, validateRecurringDescription, validateRecurringAmount, validateTripDate } from '../constants/limits';
import PrimaryButton from '../components/PrimaryButton';
import ScreenHeader from '../components/ScreenHeader';
import Chip from '../components/Chip';
import DatePicker from '../components/DatePicker';

// Local-time today ISO — avoids giving yesterday's date to users west of UTC
function localTodayIso(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

type Participant = { id: string; display_name: string };
type Template = {
  id: string;
  description: string;
  amount: number;
  currency: string;
  recurrence_rule: string;
  next_run_date: string;
};

const RULES = ['weekly', 'monthly', 'yearly'] as const;

const RULE_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  weekly:  { bg: '#e8ecf4', text: '#0b1c30', border: '#c5c6d0' },
  monthly: { bg: '#dbeafe', text: '#1e40af', border: '#bfdbfe' },
  yearly:  { bg: '#d1fae5', text: '#065f46', border: '#a7f3d0' },
};

export default function RecurringScreen({
  tripId,
  currency,
  onBack,
}: {
  tripId: string;
  currency: string;
  onBack: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [paidBy, setPaidBy] = useState<string | null>(null);
  const [rule, setRule] = useState<(typeof RULES)[number]>('monthly');
  const [nextRunDate, setNextRunDate] = useState(localTodayIso());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const ac = new AbortController();
    db.watch(
      'SELECT id, display_name FROM participants WHERE trip_id = ?',
      [tripId],
      {
        onResult: (r) => {
          const rows = r.rows?._array ?? [];
          setParticipants(rows);
          setPaidBy((c) => c ?? rows[0]?.id ?? null);
        },
      },
      { signal: ac.signal }
    );
    db.watch(
      'SELECT id, description, amount, currency, recurrence_rule, next_run_date FROM expense_templates WHERE trip_id = ? AND is_active = 1 ORDER BY next_run_date',
      [tripId],
      { onResult: (r) => setTemplates(r.rows?._array ?? []) },
      { signal: ac.signal }
    );
    return () => ac.abort();
  }, [tripId]);

  async function createTemplate() {
    const descError = validateRecurringDescription(description);
    if (descError) { setError(descError); return; }
    const amountError = validateRecurringAmount(amount);
    if (amountError) { setError(amountError); return; }
    const dateError = validateTripDate(nextRunDate);
    if (dateError) { setError(dateError); return; }
    if (!paidBy) { setError('Select who pays.'); return; }
    setBusy(true);
    setError(null);
    try {
      await callRpc('create_expense_template', {
        p_trip_id: tripId,
        p_description: description.trim(),
        p_amount: Number(amount),
        p_currency: currency,
        p_paid_by: paidBy,
        p_split_type: 'equal',
        p_split_config: {},
        p_recurrence_rule: rule,
        p_next_run_date: nextRunDate,
        p_category: null,
      });
      setDescription('');
      setAmount('');
    } catch (err) {
      setError(formatError(err));
    } finally {
      setBusy(false);
    }
  }

  async function deleteTemplate(id: string) {
    setError(null);
    try {
      await callRpc('delete_expense_template', { p_template_id: id }, { idempotent: false });
    } catch (err) {
      setError(formatError(err));
    }
  }

  return (
    <View style={styles.root}>
      <ScreenHeader
        onBack={onBack}
        title="Recurring"
        subtitle="Auto-repeating expense templates"
        paddingTop={Math.max(insets.top, 16)}
        backDisabled={busy}
        right={
          <View style={styles.countBadge}>
            <Repeat size={13} color="#2563eb" />
            <Text style={styles.countBadgeText}>{templates.length} active</Text>
          </View>
        }
      />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={{
          paddingBottom: Math.max(insets.bottom, 16) + 32,
          paddingHorizontal: 16,
          paddingTop: 16,
        }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >

      {/* ── Create form ── */}
      <Text style={styles.sectionLabel}>New Template</Text>
      <View style={styles.card}>
        {/* Description */}
        <View style={styles.fieldGroup}>
          <Text style={styles.fieldLabel}>Description</Text>
          <TextInput
            style={styles.textInput}
            value={description}
            onChangeText={setDescription}
            placeholder="e.g. Rent, Subscription"
            placeholderTextColor="#94a3b8"
            maxLength={LIMITS.recurring.description.max}
          />
        </View>

        <View style={styles.divider} />

        {/* Amount */}
        <View style={styles.fieldGroup}>
          <Text style={styles.fieldLabel}>Amount ({currency})</Text>
          <View style={styles.amountRow}>
            <View style={styles.currencyChip}>
              <Text style={styles.currencyChipText}>{currency}</Text>
            </View>
            <TextInput
              style={styles.amountInput}
              value={amount}
              onChangeText={setAmount}
              placeholder="0.00"
              placeholderTextColor="#94a3b8"
              keyboardType="decimal-pad"
              maxLength={String(LIMITS.recurring.amount.max).length + 3}
            />
          </View>
        </View>

        <View style={styles.divider} />

        {/* Paid by */}
        <View style={styles.fieldGroup}>
          <Text style={styles.fieldLabel}>Paid by</Text>
          <View style={styles.chipRow}>
            {participants.map((p) => (
              <Chip
                key={p.id}
                selected={paidBy === p.id}
                label={p.display_name}
                onPress={() => setPaidBy(p.id)}
              />
            ))}
          </View>
        </View>

        <View style={styles.divider} />

        {/* Repeats */}
        <View style={styles.fieldGroup}>
          <Text style={styles.fieldLabel}>Repeats</Text>
          <View style={styles.chipRow}>
            {RULES.map((r) => (
              <Chip
                key={r}
                selected={rule === r}
                label={r.charAt(0).toUpperCase() + r.slice(1)}
                onPress={() => setRule(r)}
              />
            ))}
          </View>
        </View>

        <View style={styles.divider} />

        {/* Next run date */}
        <View style={styles.fieldGroup}>
          <Text style={styles.fieldLabel}>Next run date</Text>
          <DatePicker value={nextRunDate} onChange={setNextRunDate} label="First occurrence" />
        </View>

        {/* Error */}
        {!!error && (
          <View style={styles.errorBanner}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        <PrimaryButton
          onPress={createTemplate}
          loading={busy}
          disabled={busy || !description.trim() || !amount || !paidBy}
          style={styles.createBtn}
        >
          Add Recurring Expense
        </PrimaryButton>
      </View>

      {/* ── Active templates ── */}
      <Text style={styles.sectionLabel}>
        Active Templates ({templates.length})
      </Text>

      {templates.length === 0 ? (
        <View style={styles.emptyTemplates}>
          <Repeat size={28} color="#cbd5e1" />
          <Text style={styles.emptyText}>No recurring expenses set up yet.</Text>
        </View>
      ) : (
        <View style={styles.templateList}>
          {templates.map((t) => {
            const ruleColor = RULE_COLORS[t.recurrence_rule] ?? RULE_COLORS.monthly;
            return (
              <View key={t.id} style={styles.templateCard}>
                {/* Icon */}
                <View style={styles.templateIcon}>
                  <Repeat size={16} color="#2563eb" />
                </View>

                {/* Info */}
                <View style={styles.templateBody}>
                  <Text style={styles.templateName} numberOfLines={1}>
                    {t.description}
                  </Text>
                  <View style={styles.templateMeta}>
                    <View style={[styles.ruleChip, { backgroundColor: ruleColor.bg, borderColor: ruleColor.border }]}>
                      <Text style={[styles.ruleChipText, { color: ruleColor.text }]}>
                        {t.recurrence_rule}
                      </Text>
                    </View>
                    <Text style={styles.templateMetaText}>
                      {t.currency} {t.amount.toFixed(2)}  ·  next {t.next_run_date}
                    </Text>
                  </View>
                </View>

                {/* Delete */}
                <Pressable
                  onPress={() => deleteTemplate(t.id)}
                  style={({ pressed }) => [styles.deleteBtn, pressed && styles.deleteBtnPressed]}
                  hitSlop={8}
                >
                  <Trash2 size={16} color="#dc2626" />
                </Pressable>
              </View>
            );
          })}
        </View>
      )}
    </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#f8f9ff',
  },
  scroll: { flex: 1 },

  // ── Count badge ──
  countBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#e8ecf4',
    borderWidth: 1,
    borderColor: '#c5c6d0',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  countBadgeText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0b1c30',
  },

  // ── Section label ──
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#43474e',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 8,
    paddingHorizontal: 2,
  },

  // ── Card ──
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 16,
    gap: 16,
    marginBottom: 20,
  },
  fieldGroup: { gap: 8 },
  fieldLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#43474e',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  textInput: {
    backgroundColor: '#f8f9ff',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    minHeight: 48,
    fontSize: 15,
    fontWeight: '600',
    color: '#0b1c30',
  },
  amountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f8f9ff',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 12,
    paddingHorizontal: 14,
    minHeight: 52,
    gap: 10,
  },
  currencyChip: {
    backgroundColor: '#e8ecf4',
    borderWidth: 1,
    borderColor: '#c5c6d0',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  currencyChipText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0b1c30',
  },
  amountInput: {
    flex: 1,
    fontSize: 22,
    fontWeight: '700',
    color: '#0b1c30',
    fontVariant: ['tabular-nums'],
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  divider: {
    height: 1,
    backgroundColor: '#f1f5f9',
  },
  errorBanner: {
    backgroundColor: '#fff1f2',
    borderWidth: 1,
    borderColor: '#fecdd3',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  errorText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#be123c',
  },
  createBtn: { marginTop: 4 },

  // ── Empty templates ──
  emptyTemplates: {
    alignItems: 'center',
    gap: 10,
    paddingVertical: 40,
    backgroundColor: '#ffffff',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  emptyText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#43474e',
  },

  // ── Template list ──
  templateList: {
    gap: 8,
  },
  templateCard: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  templateIcon: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: '#eff6ff',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  templateBody: {
    flex: 1,
    gap: 6,
  },
  templateName: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0b1c30',
  },
  templateMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  ruleChip: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
  },
  ruleChipText: {
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'capitalize',
  },
  templateMetaText: {
    fontSize: 12,
    fontWeight: '500',
    color: '#43474e',
    fontVariant: ['tabular-nums'],
  },
  deleteBtn: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: '#fee2e2',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  deleteBtnPressed: { backgroundColor: '#fecdd3' },
});
