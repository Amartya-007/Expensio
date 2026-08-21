import { useEffect, useState } from 'react';
import { ActivityIndicator, Share, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { callRpc } from '../rpc';
import { db } from '../powersync/db';

type ActiveInvite = { id: string; code: string; expires_at: string; use_count: number; max_uses: number | null };

function isVerificationError(error: unknown): boolean {
  return String(error).toLowerCase().includes('verify your account');
}

export default function InviteScreen({
  tripId,
  onRequireVerification,
  onJoined,
  onDone,
}: {
  tripId: string;
  onRequireVerification: () => void;
  onJoined: (tripId: string) => void;
  onDone: () => void;
}) {
  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const [joinCode, setJoinCode] = useState('');
  const [busy, setBusy] = useState<'generate' | 'join' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeInvites, setActiveInvites] = useState<ActiveInvite[]>([]);

  useEffect(() => {
    const abortController = new AbortController();
    db.watch(
      'SELECT id, code, expires_at, use_count, max_uses FROM trip_invites WHERE trip_id = ? AND revoked_at IS NULL ORDER BY created_at DESC',
      [tripId],
      { onResult: (result) => setActiveInvites(result.rows?._array ?? []) },
      { signal: abortController.signal }
    );
    return () => abortController.abort();
  }, [tripId]);

  async function generateInvite() {
    setBusy('generate');
    setError(null);
    try {
      const result = await callRpc<string>('generate_invite', {
        p_trip_id: tripId,
        p_expires_in: '24 hours',
        p_max_uses: 1,
      });
      if (result.status === 'ok') {
        setInviteCode(result.data);
      } else {
        setError('The invite will be available after the connection returns.');
      }
    } catch (err) {
      if (isVerificationError(err)) {
        setError('Verify your account once before inviting someone.');
      } else {
        setError(String(err));
      }
    } finally {
      setBusy(null);
    }
  }

  async function shareInvite() {
    if (!inviteCode) return;
    await Share.share({
      message: `Join my Expensio trip with code ${inviteCode}. It expires in 24 hours.`,
    });
  }

  async function joinTrip() {
    if (!/^\d{6}$/.test(joinCode.trim())) {
      setError('Enter the six-digit invite code.');
      return;
    }
    setBusy('join');
    setError(null);
    try {
      const result = await callRpc<string>('join_trip_via_code', { p_code: joinCode.trim() });
      if (result.status === 'ok') {
        onJoined(result.data);
      } else {
        setError('The join request will retry when the connection returns.');
      }
    } catch (err) {
      if (isVerificationError(err)) {
        setError('Verify your account once before joining a trip.');
      } else {
        setError(String(err));
      }
    } finally {
      setBusy(null);
    }
  }

  async function revokeInvite(inviteId: string) {
    setBusy('generate');
    setError(null);
    try {
      await callRpc('revoke_invite', { p_invite_id: inviteId }, { idempotent: false });
      setInviteCode(null);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <View style={styles.container}>
      <TouchableOpacity onPress={onDone} disabled={busy !== null}>
        <Text style={styles.back}>‹ Back</Text>
      </TouchableOpacity>
      <Text style={styles.heading}>Invite or join</Text>
      <Text style={styles.description}>Share a one-time code with a verified Expensio account.</Text>

      <Text style={styles.sectionHeading}>Invite someone to this trip</Text>
      {inviteCode ? (
        <View style={styles.codeCard}>
          <Text style={styles.codeLabel}>Invite code</Text>
          <Text style={styles.code}>{inviteCode}</Text>
          <TouchableOpacity style={styles.secondaryButton} onPress={shareInvite}>
            <Text style={styles.secondaryText}>Share code</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <TouchableOpacity style={styles.primaryButton} onPress={generateInvite} disabled={busy !== null}>
          {busy === 'generate' ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>Generate invite code</Text>}
        </TouchableOpacity>
      )}

      {activeInvites.map((invite) => (
        <View style={styles.activeInvite} key={invite.id}>
          <Text style={styles.activeInviteText}>Active code {invite.code}</Text>
          <TouchableOpacity onPress={() => revokeInvite(invite.id)} disabled={busy !== null}>
            <Text style={styles.revokeText}>Revoke</Text>
          </TouchableOpacity>
        </View>
      ))}

      <Text style={styles.sectionHeading}>Join another trip</Text>
      <TextInput
        style={styles.input}
        value={joinCode}
        onChangeText={(value) => setJoinCode(value.replace(/\D/g, '').slice(0, 6))}
        placeholder="123456"
        keyboardType="number-pad"
        maxLength={6}
      />
      <TouchableOpacity style={styles.primaryButton} onPress={joinTrip} disabled={busy !== null}>
        {busy === 'join' ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>Join trip</Text>}
      </TouchableOpacity>

      {!!error && (
        <View style={styles.errorCard}>
          <Text style={styles.error}>{error}</Text>
          {isVerificationError(error) && (
            <TouchableOpacity onPress={onRequireVerification}>
              <Text style={styles.verifyLink}>Verify with phone</Text>
            </TouchableOpacity>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff', paddingTop: 60, paddingHorizontal: 20 },
  back: { color: '#666', fontSize: 15, marginBottom: 20 },
  heading: { fontSize: 24, fontWeight: '700' },
  description: { color: '#666', marginTop: 8, lineHeight: 20 },
  sectionHeading: { fontSize: 16, fontWeight: '600', marginTop: 28, marginBottom: 10 },
  codeCard: { borderWidth: 1, borderColor: '#ddd', borderRadius: 12, padding: 16, alignItems: 'center' },
  codeLabel: { color: '#666', fontSize: 12 },
  code: { fontSize: 32, fontWeight: '700', letterSpacing: 4, marginVertical: 8 },
  input: { borderWidth: 1, borderColor: '#ddd', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 12, fontSize: 18, letterSpacing: 2 },
  primaryButton: { backgroundColor: '#111', borderRadius: 8, paddingVertical: 13, alignItems: 'center', marginTop: 12 },
  primaryText: { color: '#fff', fontWeight: '600' },
  secondaryButton: { borderWidth: 1, borderColor: '#111', borderRadius: 8, paddingVertical: 10, paddingHorizontal: 20, marginTop: 8 },
  secondaryText: { color: '#111', fontWeight: '600' },
  errorCard: { backgroundColor: '#fff5f5', borderRadius: 8, padding: 12, marginTop: 16 },
  error: { color: '#b00020', fontSize: 13 },
  verifyLink: { color: '#111', fontWeight: '700', marginTop: 8 },
  activeInvite: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 10, padding: 10, backgroundColor: '#f7f7f7', borderRadius: 8 },
  activeInviteText: { color: '#111', fontSize: 13 },
  revokeText: { color: '#b00020', fontWeight: '600' },
});
