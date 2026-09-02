import { useEffect, useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { ArrowLeft, MessageSquareText, ShieldCheck } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '../supabaseClient';
import { callRpc } from '../rpc';
import { formatError } from '../utils/errors';
import PrimaryButton from '../components/PrimaryButton';
import GradientText from '../components/GradientText';

function normalisePhone(value: string): string {
  return value.replace(/[\s()-]/g, '');
}

function isValidPhone(value: string): boolean {
  return /^\+[1-9]\d{7,14}$/.test(value);
}

// Restyled with this port's design language -- no TripSpend screen to port from (that
// codebase doesn't have a phone-verification flow at all). All logic (updateUser/
// verifyOtp calls, the cooldown timer, phone normalisation/validation) unchanged from
// before this pass -- only the JSX changed.
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
    const timer = setInterval(() => setCooldown((current) => Math.max(0, current - 1)), 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  const canonicalPhone = useMemo(() => normalisePhone(phone), [phone]);

  async function sendCode() {
    if (!isValidPhone(canonicalPhone)) {
      setError('Enter a phone number in international format, for example +919876543210.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // This upgrades the current anonymous user instead of creating a second
      // account, so trips created before verification remain on the same user id.
      const { error: updateError } = await supabase.auth.updateUser({
        phone: canonicalPhone,
        data: displayName.trim() ? { display_name: displayName.trim() } : undefined,
      });
      if (updateError) throw updateError;
      setStep('otp');
      setCooldown(60);
    } catch (err) {
      setError(formatError(err));
    } finally {
      setBusy(false);
    }
  }

  async function verifyCode() {
    if (!/^\d{6}$/.test(otp)) {
      setError('Enter the six-digit code from the SMS.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { error: verifyError } = await supabase.auth.verifyOtp({
        phone: canonicalPhone,
        token: otp,
        type: 'sms',
      });
      if (verifyError) throw verifyError;

      // Phone is now verified and linked -- that already happened, irreversibly, on the
      // line above. A failure in this optional follow-up shouldn't make it look like
      // verification itself failed (a network hiccup here would otherwise leave the user
      // staring at an error on the OTP screen for a phone that was, in fact, already
      // successfully verified -- and a "resend code"/retry from there doesn't make sense
      // for an already-linked number). Best-effort here; onDone() always fires once
      // verifyOtp succeeds.
      if (displayName.trim()) {
        try {
          await callRpc('update_display_name', { p_new_name: displayName.trim() }, { idempotent: false });
        } catch {
          // Name can be set later from Settings -- not worth blocking on.
        }
      }
      onDone();
    } catch (err) {
      setError(formatError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView className="flex-1 bg-white" behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        className="flex-1"
        contentContainerStyle={{
          paddingTop: Math.max(insets.top, 16),
          paddingBottom: Math.max(insets.bottom, 16) + 32,
          paddingHorizontal: 16,
        }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View className="flex-row items-center gap-3 mb-5">
          <Pressable onPress={onCancel} disabled={busy} className="p-2 -ml-2 rounded-xl active:bg-slate-100">
            <ArrowLeft size={20} color="#1e293b" />
          </Pressable>
          <View className="flex-1">
            <GradientText className="text-2xl font-black">Verify Account</GradientText>
            <Text className="text-xs font-semibold text-slate-500">Required to collaborate and join group trips</Text>
          </View>
        </View>

        {step === 'phone' ? (
          <View className="space-y-4">
            <View>
              <Text className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Name (optional)</Text>
              <TextInput
                className="input-field text-base text-slate-900"
                value={displayName}
                onChangeText={setDisplayName}
                placeholder="Your name"
                placeholderTextColor="#94a3b8"
                autoCapitalize="words"
              />
            </View>
            <View>
              <Text className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Phone number</Text>
              <TextInput
                className="input-field text-base text-slate-900"
                value={phone}
                onChangeText={setPhone}
                placeholder="+91 9876543210"
                placeholderTextColor="#94a3b8"
                keyboardType="phone-pad"
                autoComplete="tel"
              />
            </View>
            <PrimaryButton onPress={sendCode} disabled={busy} loading={busy} icon={<MessageSquareText size={16} color="#fff" />} className="w-full">
              Send OTP
            </PrimaryButton>
          </View>
        ) : (
          <View className="space-y-4">
            <View className="card-elevated p-4 flex-row items-center gap-3">
              <View className="w-9 h-9 rounded-xl bg-blue-50 border border-blue-100 items-center justify-center">
                <MessageSquareText size={16} color="#2563eb" />
              </View>
              <Text className="text-sm text-slate-600 flex-1">Code sent to {canonicalPhone}</Text>
            </View>
            <TextInput
              className="input-field text-2xl font-black text-slate-900 tracking-[0.3em] text-center"
              value={otp}
              onChangeText={(value) => setOtp(value.replace(/\D/g, '').slice(0, 6))}
              placeholder="123456"
              placeholderTextColor="#cbd5e1"
              keyboardType="number-pad"
              maxLength={6}
              autoFocus
            />
            <PrimaryButton onPress={verifyCode} disabled={busy} loading={busy} icon={<ShieldCheck size={16} color="#fff" />} className="w-full">
              Verify
            </PrimaryButton>
            <Pressable onPress={sendCode} disabled={busy || cooldown > 0} className="items-center py-2">
              <Text className={`text-sm font-semibold ${busy || cooldown > 0 ? 'text-slate-300' : 'text-slate-700'}`}>
                {cooldown > 0 ? `Resend code in ${cooldown}s` : 'Resend code'}
              </Text>
            </Pressable>
          </View>
        )}

        {!!error && (
          <View className="bg-red-50 border border-red-200 rounded-2xl px-4 py-3">
            <Text className="text-sm text-red-700 font-medium">{error}</Text>
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
