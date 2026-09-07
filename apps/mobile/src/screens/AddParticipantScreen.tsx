import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { ArrowLeft, UserCircle2 } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { callRpc } from '../rpc';
import { formatError } from '../utils/errors';
import { LIMITS, validateParticipantName, validatePhone, digitsOnly, toE164, COUNTRY_CODE } from '../constants/limits';
import PrimaryButton from '../components/PrimaryButton';

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
      const digits = digitsOnly(phone);
      const result = await callRpc('add_placeholder_participant', {
        p_trip_id: tripId,
        p_display_name: name.trim(),
        p_phone: digits ? toE164(digits) : null,
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
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <ArrowLeft size={18} color="#0b1c30" strokeWidth={2} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={s.headerTitle}>Add a Person</Text>
          <Text style={s.headerSub}>For splitting expenses together</Text>
        </View>
      </View>

      {/* Hint card */}
      <View style={s.hintCard}>
        <Text style={s.hintText}>
          For splitting expenses with someone who isn&apos;t using the app yet. Give them a phone number
          now and if they join later with that number, it links to their account automatically.
        </Text>
      </View>

      {/* Form */}
      <View style={s.form}>
        <View>
          <Text style={s.fieldLabel}>Name</Text>
          <View style={[s.inputRow, nameFocused && s.inputRowFocused]}>
            <UserCircle2 size={18} color="#737686" />
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
            <Text style={s.countryCode}>{COUNTRY_CODE}</Text>
            <View style={s.phoneDivider} />
            <TextInput
              style={[s.input, { paddingLeft: 0 }]}
              value={phone}
              onChangeText={v => setPhone(digitsOnly(v).slice(0, LIMITS.participant.phone.length))}
              onFocus={() => setPhoneFocused(true)}
              onBlur={() => setPhoneFocused(false)}
              placeholder="9876543210"
              placeholderTextColor="#94a3b8"
              keyboardType="number-pad"
              maxLength={LIMITS.participant.phone.length}
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
          accessibilityRole="button"
          accessibilityLabel="Cancel"
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
  root: { flex: 1, backgroundColor: '#f8f9ff', paddingHorizontal: 16, justifyContent: 'space-between' },

  header: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 18 },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    shadowColor: '#0b1c30',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 2,
    elevation: 1,
  },
  backBtnPressed: { backgroundColor: '#f1f5f9' },
  headerTitle: {
    fontSize: 24,
    fontWeight: '700',
    fontFamily: 'Inter_700Bold',
    color: '#0b1c30',
    letterSpacing: -0.3,
  },
  headerSub: {
    fontSize: 13,
    fontWeight: '400',
    fontFamily: 'Inter_400Regular',
    color: '#434655',
    marginTop: 2,
  },

  hintCard: {
    backgroundColor: '#eff4ff',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#bfdbfe',
    marginBottom: 20,
  },
  hintText: {
    fontSize: 13,
    fontWeight: '400',
    fontFamily: 'Inter_400Regular',
    color: '#1e3a8a',
    lineHeight: 19,
  },

  form: { gap: 16, flex: 1 },
  fieldLabel: {
    fontSize: 12,
    fontWeight: '600',
    fontFamily: 'Inter_600SemiBold',
    color: '#434655',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#c3c6d7',
    borderRadius: 12,
    paddingHorizontal: 14,
    height: 48,
  },
  inputRowFocused: { borderColor: '#2563eb' },
  input: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
    fontFamily: 'Inter_600SemiBold',
    color: '#0b1c30',
  },
  countryCode: {
    fontSize: 15,
    fontWeight: '700',
    fontFamily: 'Inter_700Bold',
    color: '#434655',
  },
  phoneDivider: { width: 1, height: 20, backgroundColor: '#e2e8f0' },

  errorBanner: { borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, borderWidth: 1 },
  errorBannerRed: { backgroundColor: '#ffdad6', borderColor: '#ffb4ab' },
  errorBannerAmber: { backgroundColor: '#fffbeb', borderColor: '#fde68a' },
  errorText: { fontSize: 13, fontWeight: '600', fontFamily: 'Inter_600SemiBold' },
  errorTextRed: { color: '#ba1a1a' },
  errorTextAmber: { color: '#92400e' },

  actions: { flexDirection: 'row', gap: 12, paddingTop: 16 },
  cancelBtn: {
    height: 48,
    paddingHorizontal: 20,
    borderRadius: 12,
    backgroundColor: '#f8f9ff',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelBtnPressed: { backgroundColor: '#eff4ff' },
  cancelText: {
    fontSize: 14,
    fontWeight: '600',
    fontFamily: 'Inter_600SemiBold',
    color: '#434655',
  },
});
