import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { supabase } from '../supabaseClient';
import { callRpc } from '../rpc';

function normalisePhone(value: string): string {
  return value.replace(/[\s()-]/g, '');
}

function isValidPhone(value: string): boolean {
  return /^\+[1-9]\d{7,14}$/.test(value);
}

export default function PhoneVerificationScreen({
  onDone,
  onCancel,
}: {
  onDone: () => void;
  onCancel: () => void;
}) {
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
      setError(String(err));
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
        type: 'phone_change',
      });
      if (verifyError) throw verifyError;

      if (displayName.trim()) {
        await callRpc(
          'update_display_name',
          { p_new_name: displayName.trim() },
          { idempotent: false }
        );
      }
      onDone();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <TouchableOpacity onPress={onCancel} disabled={busy}>
        <Text style={styles.back}>‹ Back</Text>
      </TouchableOpacity>
      <Text style={styles.heading}>Verify your account</Text>
      <Text style={styles.description}>
        Verification is required before you can invite someone or join another trip.
      </Text>

      {step === 'phone' ? (
        <>
          <Text style={styles.label}>Name (optional)</Text>
          <TextInput
            style={styles.input}
            value={displayName}
            onChangeText={setDisplayName}
            placeholder="Your name"
            autoCapitalize="words"
          />
          <Text style={styles.label}>Phone number</Text>
          <TextInput
            style={styles.input}
            value={phone}
            onChangeText={setPhone}
            placeholder="+91 9876543210"
            keyboardType="phone-pad"
            autoComplete="tel"
          />
          <TouchableOpacity style={styles.primaryButton} onPress={sendCode} disabled={busy}>
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>Send OTP</Text>}
          </TouchableOpacity>
        </>
      ) : (
        <>
          <Text style={styles.label}>Code sent to {canonicalPhone}</Text>
          <TextInput
            style={styles.input}
            value={otp}
            onChangeText={(value) => setOtp(value.replace(/\D/g, '').slice(0, 6))}
            placeholder="123456"
            keyboardType="number-pad"
            maxLength={6}
            autoFocus
          />
          <TouchableOpacity style={styles.primaryButton} onPress={verifyCode} disabled={busy}>
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>Verify</Text>}
          </TouchableOpacity>
          <TouchableOpacity onPress={sendCode} disabled={busy || cooldown > 0}>
            <Text style={[styles.secondaryText, (busy || cooldown > 0) && styles.disabledText]}>
              {cooldown > 0 ? `Resend code in ${cooldown}s` : 'Resend code'}
            </Text>
          </TouchableOpacity>
        </>
      )}

      {!!error && <Text style={styles.error}>{error}</Text>}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff', paddingTop: 60, paddingHorizontal: 20 },
  back: { color: '#666', fontSize: 15, marginBottom: 20 },
  heading: { fontSize: 24, fontWeight: '700' },
  description: { color: '#666', lineHeight: 20, marginTop: 8, marginBottom: 20 },
  label: { color: '#666', fontSize: 13, marginBottom: 6, marginTop: 16 },
  input: { borderWidth: 1, borderColor: '#ddd', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 12, fontSize: 16 },
  primaryButton: { backgroundColor: '#111', borderRadius: 8, paddingVertical: 13, alignItems: 'center', marginTop: 24 },
  primaryText: { color: '#fff', fontWeight: '600' },
  secondaryText: { color: '#111', textAlign: 'center', paddingVertical: 18 },
  disabledText: { color: '#aaa' },
  error: { color: '#b00020', fontSize: 13, marginTop: 16 },
});
