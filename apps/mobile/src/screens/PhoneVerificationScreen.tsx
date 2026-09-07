import { useEffect, useMemo, useRef, useState } from 'react';
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
import {
  ArrowLeft,
  ArrowRight,
  Clock,
  Edit2,
  Lock,
  MessageSquareText,
  ShieldCheck,
} from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '../supabaseClient';
import { callRpc } from '../rpc';
import { formatError } from '../utils/errors';
import {
  LIMITS,
  validateDisplayName,
  validatePhone,
  digitsOnly,
  toE164,
  COUNTRY_CODE,
} from '../constants/limits';
import PrimaryButton from '../components/PrimaryButton';

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
  const otpInputRef = useRef<TextInput>(null);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setInterval(() => setCooldown((c) => Math.max(0, c - 1)), 1000);
    return () => clearInterval(t);
  }, [cooldown]);

  const canonicalPhone = useMemo(() => toE164(digitsOnly(phone)), [phone]);

  async function sendCode() {
    const phoneError = validatePhone(phone, true);
    const nameError = displayName.trim() ? validateDisplayName(displayName) : null;
    if (phoneError || nameError) {
      setError(phoneError ?? nameError);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { error: e } = await supabase.auth.updateUser({
        phone: canonicalPhone,
        data: displayName.trim() ? { display_name: displayName.trim() } : undefined,
      });
      if (e) throw e;
      setStep('otp');
      setCooldown(60);
    } catch (err) {
      setError(formatError(err));
    } finally {
      setBusy(false);
    }
  }

  async function verifyCode() {
    if (!new RegExp(`^\\d{${LIMITS.phoneVerification.otp.length}}$`).test(otp)) {
      setError(`Enter the ${LIMITS.phoneVerification.otp.length}-digit code from the SMS.`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { error: e } = await supabase.auth.verifyOtp({
        phone: canonicalPhone,
        token: otp,
        type: 'sms',
      });
      if (e) throw e;
      if (displayName.trim()) {
        try {
          await callRpc('update_display_name', { p_new_name: displayName.trim() }, { idempotent: false });
        } catch {}
      }
      onDone();
    } catch (err) {
      setError(formatError(err));
    } finally {
      setBusy(false);
    }
  }

  const otpDigits = useMemo(() => {
    const arr = [];
    for (let i = 0; i < 6; i++) {
      arr.push(otp[i] ?? '');
    }
    return arr;
  }, [otp]);

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
        {/* Top bar with back button and security badge */}
        <View style={s.topBar}>
          <Pressable
            onPress={onCancel}
            disabled={busy}
            style={({ pressed }) => [s.backBtn, pressed && s.backBtnPressed]}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Go back"
          >
            <ArrowLeft size={20} color="#0b1c30" strokeWidth={2.2} />
          </Pressable>

          <View style={s.secureBadge}>
            <Lock size={14} color="#10b981" strokeWidth={2.5} />
            <Text style={s.secureBadgeText}>Encrypted Step</Text>
          </View>
        </View>

        {step === 'phone' ? (
          <View style={s.container}>
            {/* Header */}
            <View style={s.iconBubble}>
              <MessageSquareText size={28} color="#2563eb" strokeWidth={2.2} />
            </View>

            <Text style={s.title}>Verify your phone</Text>
            <Text style={s.subtitle}>
              Required to collaborate with friends, share expenses, and settle debts with UPI.
            </Text>

            {/* Form Fields */}
            <View style={s.form}>
              <View style={s.inputGroup}>
                <Text style={s.fieldLabel}>Display Name (Optional)</Text>
                <TextInput
                  style={s.input}
                  value={displayName}
                  onChangeText={setDisplayName}
                  placeholder="e.g. Amartya"
                  placeholderTextColor="#737686"
                  maxLength={LIMITS.phoneVerification.displayName.max}
                  autoCapitalize="words"
                />
              </View>

              <View style={s.inputGroup}>
                <Text style={s.fieldLabel}>Mobile Phone Number</Text>
                <View style={s.phoneRow}>
                  <View style={s.countryCodeBadge}>
                    <Text style={s.countryCodeText}>{COUNTRY_CODE}</Text>
                  </View>
                  <TextInput
                    style={s.phoneInput}
                    value={phone}
                    onChangeText={(v) =>
                      setPhone(digitsOnly(v).slice(0, LIMITS.participant.phone.length))
                    }
                    placeholder="98765 43210"
                    placeholderTextColor="#737686"
                    keyboardType="number-pad"
                    maxLength={LIMITS.participant.phone.length}
                    autoComplete="tel"
                  />
                </View>
              </View>

              {!!error && (
                <View style={s.errorBox}>
                  <Text style={s.errorText}>{error}</Text>
                </View>
              )}

              <PrimaryButton
                onPress={sendCode}
                disabled={busy}
                loading={busy}
                icon={<ArrowRight size={18} color="#ffffff" />}
                style={s.submitBtn}
              >
                Send Verification Code
              </PrimaryButton>
            </View>
          </View>
        ) : (
          <View style={s.container}>
            {/* OTP Header */}
            <View style={s.iconBubble}>
              <ShieldCheck size={28} color="#2563eb" strokeWidth={2.2} />
            </View>

            <Text style={s.title}>Enter 6-digit code</Text>
            <View style={s.phoneSubRow}>
              <Text style={s.subtitle}>We sent a code to </Text>
              <Text style={s.phoneHighlight}>{canonicalPhone}</Text>
              <Pressable
                onPress={() => {
                  setStep('phone');
                  setOtp('');
                }}
                hitSlop={6}
                style={s.editPhoneBtn}
              >
                <Edit2 size={13} color="#2563eb" />
                <Text style={s.editPhoneText}>Edit</Text>
              </Pressable>
            </View>

            {/* 6 Digit Boxes */}
            <Pressable
              onPress={() => otpInputRef.current?.focus()}
              style={s.otpBoxesRow}
            >
              {otpDigits.map((digit, idx) => {
                const isActive = otp.length === idx;
                const isFilled = digit !== '';
                return (
                  <View
                    key={idx}
                    style={[
                      s.otpBox,
                      isFilled && s.otpBoxFilled,
                      isActive && s.otpBoxActive,
                    ]}
                  >
                    <Text style={s.otpDigit}>{digit}</Text>
                  </View>
                );
              })}
            </Pressable>

            {/* Hidden native input for seamless mobile keyboard interaction */}
            <TextInput
              ref={otpInputRef}
              style={s.hiddenInput}
              value={otp}
              onChangeText={(v) =>
                setOtp(digitsOnly(v).slice(0, LIMITS.phoneVerification.otp.length))
              }
              keyboardType="number-pad"
              maxLength={LIMITS.phoneVerification.otp.length}
              autoFocus
            />

            {/* Timer / Resend Feedback */}
            <View style={s.timerCard}>
              <Clock size={16} color="#1d4ed8" />
              {cooldown > 0 ? (
                <Text style={s.timerText}>
                  Resend code in <Text style={s.timerCountdown}>0:{cooldown < 10 ? `0${cooldown}` : cooldown}s</Text>
                </Text>
              ) : (
                <Pressable onPress={sendCode} disabled={busy} hitSlop={6}>
                  <Text style={s.resendActiveText}>Resend code now</Text>
                </Pressable>
              )}
            </View>

            {!!error && (
              <View style={s.errorBox}>
                <Text style={s.errorText}>{error}</Text>
              </View>
            )}

            <PrimaryButton
              onPress={verifyCode}
              disabled={busy || otp.length < 6}
              loading={busy}
              icon={<ArrowRight size={18} color="#ffffff" />}
              style={s.submitBtn}
            >
              Verify & Continue
            </PrimaryButton>
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#f8f9ff',
  },
  scroll: {
    flex: 1,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 20,
    height: 48,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: '#eff4ff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  backBtnPressed: {
    backgroundColor: '#dce9ff',
  },
  secureBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: '#e5eeff',
  },
  secureBadgeText: {
    fontSize: 12,
    fontWeight: '600',
    fontFamily: 'Inter_600SemiBold',
    color: '#0b1c30',
  },
  container: {
    maxWidth: 420,
    width: '100%',
    alignSelf: 'center',
  },
  iconBubble: {
    width: 52,
    height: 52,
    borderRadius: 16,
    backgroundColor: '#dce9ff',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    fontFamily: 'Inter_700Bold',
    color: '#0b1c30',
    letterSpacing: -0.4,
  },
  subtitle: {
    fontSize: 14,
    fontWeight: '400',
    fontFamily: 'Inter_400Regular',
    color: '#434655',
    marginTop: 6,
    lineHeight: 20,
  },
  phoneSubRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    marginTop: 6,
    gap: 4,
  },
  phoneHighlight: {
    fontSize: 14,
    fontWeight: '700',
    fontFamily: 'Inter_700Bold',
    color: '#0b1c30',
  },
  editPhoneBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 8,
    paddingVertical: 2,
    backgroundColor: '#eff4ff',
    borderRadius: 6,
    marginLeft: 4,
  },
  editPhoneText: {
    fontSize: 12,
    fontWeight: '600',
    fontFamily: 'Inter_600SemiBold',
    color: '#2563eb',
  },
  form: {
    marginTop: 24,
    gap: 16,
  },
  inputGroup: {
    gap: 6,
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: '600',
    fontFamily: 'Inter_600SemiBold',
    color: '#0b1c30',
  },
  input: {
    height: 52,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    backgroundColor: '#ffffff',
    paddingHorizontal: 16,
    fontSize: 15,
    fontFamily: 'Inter_400Regular',
    color: '#0b1c30',
  },
  phoneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 52,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    backgroundColor: '#ffffff',
    paddingHorizontal: 10,
    gap: 10,
  },
  countryCodeBadge: {
    backgroundColor: '#eff4ff',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  countryCodeText: {
    fontSize: 14,
    fontWeight: '700',
    fontFamily: 'Inter_700Bold',
    color: '#2563eb',
  },
  phoneInput: {
    flex: 1,
    height: '100%',
    fontSize: 15,
    fontFamily: 'Inter_400Regular',
    color: '#0b1c30',
  },
  otpBoxesRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 28,
    marginBottom: 16,
    gap: 8,
  },
  otpBox: {
    flex: 1,
    height: 56,
    borderRadius: 12,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#0b1c30',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 2,
    elevation: 1,
  },
  otpBoxFilled: {
    borderColor: '#cbdbf5',
    backgroundColor: '#ffffff',
  },
  otpBoxActive: {
    borderColor: '#2563eb',
    borderWidth: 2,
    backgroundColor: '#eff4ff',
  },
  otpDigit: {
    fontSize: 26,
    fontWeight: '700',
    fontFamily: 'Inter_700Bold',
    color: '#0b1c30',
    fontVariant: ['tabular-nums'],
  },
  hiddenInput: {
    position: 'absolute',
    opacity: 0,
    width: 1,
    height: 1,
  },
  timerCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 16,
    backgroundColor: '#eff4ff',
    borderRadius: 12,
    marginBottom: 20,
  },
  timerText: {
    fontSize: 13,
    fontWeight: '400',
    fontFamily: 'Inter_400Regular',
    color: '#434655',
  },
  timerCountdown: {
    fontWeight: '700',
    fontFamily: 'Inter_700Bold',
    color: '#0b1c30',
  },
  resendActiveText: {
    fontSize: 13,
    fontWeight: '700',
    fontFamily: 'Inter_700Bold',
    color: '#2563eb',
  },
  submitBtn: {
    marginTop: 8,
  },
  errorBox: {
    backgroundColor: '#fef2f2',
    borderWidth: 1,
    borderColor: '#fecdd3',
    borderRadius: 12,
    padding: 12,
    marginTop: 8,
  },
  errorText: {
    fontSize: 13,
    fontWeight: '600',
    fontFamily: 'Inter_600SemiBold',
    color: '#ef4444',
    textAlign: 'center',
  },
});
