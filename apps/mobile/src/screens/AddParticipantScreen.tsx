import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { ArrowLeft, UserCircle2 } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { callRpc } from '../rpc';
import { formatError } from '../utils/errors';
import { LIMITS, validateParticipantName, validatePhone, normalisePhone } from '../constants/limits';
import PrimaryButton from '../components/PrimaryButton';
import GradientText from '../components/GradientText';

export default function AddParticipantScreen({
  tripId,
  onDone,
  onCancel,
}: {
  tripId: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [nameFocused, setNameFocused] = useState(false);
  const [phoneFocused, setPhoneFocused] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const nameError = validateParticipantName(name);
    const phoneError = validatePhone(phone, false);
    if (nameError || phoneError) {
      setError(nameError ?? phoneError);
      return;
    }
    setBusy(true); setError(null);
    try {
      const result = await callRpc('add_placeholder_participant', {
        p_trip_id: tripId,
        p_display_name: name.trim(),
        p_phone: normalisePhone(phone) || null,
      });
      if (result.status === 'ok') {
        onDone();
      } else {
        setError('You appear to be offline. The member will be added automatically when you reconnect.');
      }
    } catch (err) {
      setError(formatError(err));
    } finally {
      setBusy(false);
    }
  }

  const isOfflineError = error?.includes('offline');

  return (
    <View
      style={[
        s.root,
        {
          paddingTop: Math.max(insets.top, 16),
          paddingBottom: Math.max(insets.bottom, 16),
        },
      ]}
    >
      {/* Header */}
      <View style={s.header}>
        <Pressable
          onPress={onCancel}
          disabled={busy}
          style={({ pressed }) => [s.backBtn, pressed && s.backBtnPressed]}
          hitSlop={8}
        >
          <ArrowLeft size={18} color="#334155" />
        </Pressable>
        <View style={{ flex: 1 }}>
          <GradientText className="text-2xl font-black">Add a Person</GradientText>
          <Text style={s.headerSub}>For splitting expenses together</Text>
        </View>
      </View>

      {/* Hint card */}
      <View style={s.hintCard}>
        <Text style={s.hintText}>
          For splitting expenses with someone who isn&apos;t using the app. Give them a phone number
          now and if they join later with that number, it links to their account automatically.
        </Text>
      </View>

      {/* Form */}
      <View style={s.form}>
        <View>
          <Text style={s.fieldLabel}>Name</Text>
          <View style={[s.inputRow, nameFocused && s.inputRowFocused]}>
            <UserCircle2 size={18} color="#94a3b8" />
            <TextInput
              style={s.input}
              value={name}
              onChangeText={setName}
              onFocus={() => setNameFocused(true)}
              onBlur={() => setNameFocused(false)}
              placeholder="Rahul"
              placeholderTextColor="#94a3b8"
              maxLength={LIMITS.participant.displayName.max}
              autoFocus
            />
          </View>
        </View>

        <View>
          <Text style={s.fieldLabel}>Phone (optional)</Text>
          <View style={[s.inputRow, phoneFocused && s.inputRowFocused]}>
            <TextInput
              style={[s.input, { paddingLeft: 0 }]}
              value={phone}
              onChangeText={setPhone}
              onFocus={() => setPhoneFocused(true)}
              onBlur={() => setPhoneFocused(false)}
              placeholder="+91…"
              placeholderTextColor="#94a3b8"
              keyboardType="phone-pad"
              maxLength={LIMITS.participant.phone.max}
            />
          </View>
        </View>

        {!!error && (
          <View style={[s.errorBanner, isOfflineError ? s.errorBannerAmber : s.errorBannerRed]}>
            <Text style={[s.errorText, isOfflineError ? s.errorTextAmber : s.errorTextRed]}>
              {error}
            </Text>
          </View>
        )}
      </View>

      {/* Actions */}
      <View style={s.actions}>
        <Pressable
          onPress={onCancel}
          disabled={busy}
          style={({ pressed }) => [s.cancelBtn, pressed && s.cancelBtnPressed]}
        >
          <Text style={s.cancelText}>Cancel</Text>
        </Pressable>
        <View style={{ flex: 1 }}>
          <PrimaryButton onPress={submit} disabled={!name.trim()} loading={busy}>
            Add Member
          </PrimaryButton>
        </View>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#f8fafc', paddingHorizontal: 16, justifyContent: 'space-between' },

  header: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 20 },
  backBtn: { width: 36, height: 36, borderRadius: 12, backgroundColor: '#fff', borderWidth: 1, borderColor: '#e2e8f0', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  backBtnPressed: { backgroundColor: '#e2e8f0' },
  headerSub: { fontSize: 12, fontWeight: '600', color: '#94a3b8', marginTop: 2 },

  hintCard: { backgroundColor: '#fff', borderRadius: 16, padding: 16, borderWidth: 1, borderColor: '#e2e8f0', marginBottom: 24 },
  hintText: { fontSize: 13, fontWeight: '500', color: '#64748b', lineHeight: 20 },

  form: { gap: 16, flex: 1 },
  fieldLabel: { fontSize: 11, fontWeight: '700', color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 6 },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#fff', borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12 },
  inputRowFocused: { borderColor: '#2563eb' },
  input: { flex: 1, fontSize: 15, fontWeight: '600', color: '#0f172a' },

  errorBanner: { borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, borderWidth: 1 },
  errorBannerRed: { backgroundColor: '#fff1f2', borderColor: '#fecdd3' },
  errorBannerAmber: { backgroundColor: '#fffbeb', borderColor: '#fde68a' },
  errorText: { fontSize: 13, fontWeight: '600' },
  errorTextRed: { color: '#be123c' },
  errorTextAmber: { color: '#92400e' },

  actions: { flexDirection: 'row', gap: 12, paddingTop: 20 },
  cancelBtn: { flex: 1, paddingVertical: 14, borderRadius: 16, backgroundColor: '#f1f5f9', borderWidth: 1, borderColor: '#e2e8f0', alignItems: 'center', justifyContent: 'center' },
  cancelBtnPressed: { backgroundColor: '#e2e8f0' },
  cancelText: { fontSize: 14, fontWeight: '700', color: '#334155' },
});
