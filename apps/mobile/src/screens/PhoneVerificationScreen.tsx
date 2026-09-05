import { useEffect, useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { ArrowLeft, MessageSquareText, ShieldCheck } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '../supabaseClient';
import { callRpc } from '../rpc';
import { formatError } from '../utils/errors';
import { LIMITS, validateDisplayName, validatePhone, normalisePhone } from '../constants/limits';
import PrimaryButton from '../components/PrimaryButton';
import GradientText from '../components/GradientText';

export default function PhoneVerificationScreen({
  onDone,
  onCancel,
}: {
  onDone: () => void;
  onCancel: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [phone, setPhone] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [otp, setOtp] = useState('');
  const [step, setStep] = useState<'phone' | 'otp'>('phone');
  const [cooldown, setCooldown] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setInterval(() => setCooldown(c => Math.max(0, c - 1)), 1000);
    return () => clearInterval(t);
  }, [cooldown]);

  const canonicalPhone = useMemo(() => normalisePhone(phone), [phone]);

  async function sendCode() {
    const phoneError = validatePhone(phone, true);
    const nameError = displayName.trim() ? validateDisplayName(displayName) : null;
    if (phoneError || nameError) {
      setError(phoneError ?? nameError);
      return;
    }
    setBusy(true); setError(null);
    try {
      const { error: e } = await supabase.auth.updateUser({
        phone: canonicalPhone,
        data: displayName.trim() ? { display_name: displayName.trim() } : undefined,
      });
      if (e) throw e;
      setStep('otp'); setCooldown(60);
    } catch (err) { setError(formatError(err)); }
    finally { setBusy(false); }
  }

  async function verifyCode() {
    if (!new RegExp(`^\\d{${LIMITS.phoneVerification.otp.length}}$`).test(otp)) {
      setError(`Enter the ${LIMITS.phoneVerification.otp.length}-digit code from the SMS.`);
      return;
    }
    setBusy(true); setError(null);
    try {
      const { error: e } = await supabase.auth.verifyOtp({ phone: canonicalPhone, token: otp, type: 'sms' });
      if (e) throw e;
      if (displayName.trim()) {
        try { await callRpc('update_display_name', { p_new_name: displayName.trim() }, { idempotent: false }); } catch {}
      }
      onDone();
    } catch (err) { setError(formatError(err)); }
    finally { setBusy(false); }
  }

  return (
    <KeyboardAvoidingView style={s.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        style={s.scroll}
        contentContainerStyle={{
          paddingTop: Math.max(insets.top, 16),
          paddingBottom: Math.max(insets.bottom, 16) + 32,
          paddingHorizontal: 16,
        }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
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
            <GradientText className="text-2xl font-black">Verify Account</GradientText>
            <Text style={s.headerSub}>Required to collaborate and join group trips</Text>
          </View>
        </View>

        {step === 'phone' ? (
          <View style={s.section}>
            <Text style={s.fieldLabel}>Name (optional)</Text>
            <TextInput
              style={s.input}
              value={displayName}
              onChangeText={setDisplayName}
              placeholder="Your name"
              placeholderTextColor="#94a3b8"
              maxLength={LIMITS.phoneVerification.displayName.max}
              autoCapitalize="words"
            />

            <Text style={[s.fieldLabel, { marginTop: 16 }]}>Phone number</Text>
            <TextInput
              style={s.input}
              value={phone}
              onChangeText={setPhone}
              placeholder="+91 9876543210"
              placeholderTextColor="#94a3b8"
              keyboardType="phone-pad"
              maxLength={LIMITS.participant.phone.max}
              autoComplete="tel"
            />

            <PrimaryButton
              onPress={sendCode}
              disabled={busy}
              loading={busy}
              icon={<MessageSquareText size={16} color="#fff" />}
              style={s.btn}
            >
              Send OTP
            </PrimaryButton>
          </View>
        ) : (
          <View style={s.section}>
            <View style={s.codeSentCard}>
              <View style={s.codeSentIcon}>
                <MessageSquareText size={16} color="#2563eb" />
              </View>
              <Text style={s.codeSentText}>Code sent to {canonicalPhone}</Text>
            </View>

            <TextInput
              style={[s.input, s.otpInput]}
              value={otp}
              onChangeText={v => setOtp(v.replace(/\D/g, '').slice(0, LIMITS.phoneVerification.otp.length))}
              placeholder="123456"
              placeholderTextColor="#cbd5e1"
              keyboardType="number-pad"
              maxLength={LIMITS.phoneVerification.otp.length}
              autoFocus
            />

            <PrimaryButton
              onPress={verifyCode}
              disabled={busy}
              loading={busy}
              icon={<ShieldCheck size={16} color="#fff" />}
              style={s.btn}
            >
              Verify
            </PrimaryButton>

            <Pressable
              onPress={sendCode}
              disabled={busy || cooldown > 0}
              style={s.resendBtn}
            >
              <Text style={[s.resendText, (busy || cooldown > 0) && s.resendTextDim]}>
                {cooldown > 0 ? `Resend code in ${cooldown}s` : 'Resend code'}
              </Text>
            </Pressable>
          </View>
        )}

        {!!error && (
          <View style={s.errorBanner}>
            <Text style={s.errorText}>{error}</Text>
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#f8fafc' },
  scroll: { flex: 1 },

  header: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 28 },
  backBtn: { width: 36, height: 36, borderRadius: 12, backgroundColor: '#fff', borderWidth: 1, borderColor: '#e2e8f0', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  backBtnPressed: { backgroundColor: '#e2e8f0' },
  headerSub: { fontSize: 12, fontWeight: '600', color: '#94a3b8', marginTop: 2 },

  section: { gap: 8 },
  fieldLabel: { fontSize: 11, fontWeight: '700', color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.6 },
  input: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 14, paddingHorizontal: 14, paddingVertical: 13, fontSize: 15, fontWeight: '600', color: '#0f172a' },
  otpInput: { fontSize: 24, fontWeight: '800', textAlign: 'center', letterSpacing: 8 },
  btn: { marginTop: 8 },

  codeSentCard: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#fff', borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 16, padding: 14 },
  codeSentIcon: { width: 36, height: 36, borderRadius: 10, backgroundColor: '#eff6ff', alignItems: 'center', justifyContent: 'center' },
  codeSentText: { fontSize: 13, fontWeight: '600', color: '#334155', flex: 1 },

  resendBtn: { alignItems: 'center', paddingVertical: 12 },
  resendText: { fontSize: 13, fontWeight: '600', color: '#334155' },
  resendTextDim: { color: '#cbd5e1' },

  errorBanner: { marginTop: 16, backgroundColor: '#fff1f2', borderWidth: 1, borderColor: '#fecdd3', borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12 },
  errorText: { fontSize: 13, fontWeight: '600', color: '#be123c' },
});
