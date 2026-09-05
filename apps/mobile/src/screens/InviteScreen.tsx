import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import { ArrowLeft, Link2, Share2, ShieldAlert, Ticket, UserPlus, X } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { callRpc } from '../rpc';
import { db } from '../powersync/db';
import { formatError } from '../utils/errors';
import { LIMITS } from '../constants/limits';
import PrimaryButton from '../components/PrimaryButton';
import GradientText from '../components/GradientText';

type ActiveInvite = { id: string; code: string; expires_at: string; use_count: number; max_uses: number | null };

function isVerificationError(err: unknown): boolean {
  const msg = typeof err === 'string' ? err
    : typeof (err as { message?: unknown })?.message === 'string'
      ? (err as { message: string }).message
      : String(err);
  return msg.toLowerCase().includes('verify your account');
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
  const insets = useSafeAreaInsets();
  const [joinCode, setJoinCode] = useState('');
  const [busy, setBusy] = useState<'generate' | 'join' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeInvites, setActiveInvites] = useState<ActiveInvite[]>([]);

  // The displayed invite code is derived from the first active invite synced back
  // down via PowerSync — no separate local state needed. generateInvite sets it
  // optimistically while we wait for the db.watch to catch up.
  const [generatedCode, setGeneratedCode] = useState<string | null>(null);
  const displayCode = generatedCode ?? activeInvites[0]?.code ?? null;

  useEffect(() => {
    const ac = new AbortController();
    db.watch(
      // Filter out expired and revoked invites — only show codes still redeemable.
      "SELECT id, code, expires_at, use_count, max_uses FROM trip_invites WHERE trip_id = ? AND revoked_at IS NULL AND expires_at > datetime('now') ORDER BY created_at DESC",
      [tripId],
      { onResult: r => setActiveInvites(r.rows?._array ?? []) },
      { signal: ac.signal }
    );
    return () => ac.abort();
  }, [tripId]);

  async function generateInvite() {
    setBusy('generate'); setError(null);
    try {
      const result = await callRpc<string>('generate_invite', { p_trip_id: tripId, p_expires_in: '24 hours', p_max_uses: 1 });
      if (result.status === 'ok') setGeneratedCode(result.data);
      else setError('Invite will be available once the connection returns.');
    } catch (err) {
      if (isVerificationError(err)) { setBusy(null); onRequireVerification(); return; }
      setError(formatError(err));
    } finally { setBusy(null); }
  }

  async function shareInvite() {
    if (!displayCode) return;
    await Share.share({ message: `Join my Expensio trip with code ${displayCode}. It expires in 24 hours.` });
  }

  async function joinTrip() {
    if (!new RegExp(`^\\d{${LIMITS.invite.code.length}}$`).test(joinCode.trim())) {
      setError(`Enter the ${LIMITS.invite.code.length}-digit invite code.`);
      return;
    }
    setBusy('join'); setError(null);
    try {
      const result = await callRpc<string>('join_trip_via_code', { p_code: joinCode.trim() });
      if (result.status === 'ok') onJoined(result.data);
      else setError('Join request will retry when the connection returns.');
    } catch (err) {
      if (isVerificationError(err)) { setBusy(null); onRequireVerification(); return; }
      setError(formatError(err));
    } finally { setBusy(null); }
  }

  async function revokeInvite(inviteId: string) {
    setBusy('revoke' as any); setError(null);
    try {
      await callRpc('revoke_invite', { p_invite_id: inviteId }, { idempotent: false });
    } catch (err) { setError(formatError(err)); }
    finally { setBusy(null); }
  }

  return (
    <ScrollView
      style={s.root}
      contentContainerStyle={{
        paddingTop: Math.max(insets.top, 16),
        paddingBottom: Math.max(insets.bottom, 16) + 32,
        paddingHorizontal: 16,
      }}
      showsVerticalScrollIndicator={false}
    >
      {/* Header */}
      <View style={s.header}>
        <Pressable
          onPress={onDone}
          disabled={busy !== null}
          style={({ pressed }) => [s.backBtn, pressed && s.backBtnPressed]}
          hitSlop={8}
        >
          <ArrowLeft size={18} color="#334155" />
        </Pressable>
        <View style={{ flex: 1 }}>
          <GradientText className="text-2xl font-black">Invite or Join</GradientText>
          <Text style={s.headerSub}>Share a one-time code with a verified account</Text>
        </View>
      </View>

      {/* Invite section */}
      <Text style={s.sectionLabel}>Invite someone to this trip</Text>

      {displayCode ? (
        <View style={s.codeCard}>
          <View style={s.codeIconWrap}>
            <Ticket size={20} color="#2563eb" />
          </View>
          <Text style={s.codeHint}>Invite code</Text>
          <Text style={s.codeText}>{displayCode}</Text>
          <Pressable
            onPress={shareInvite}
            style={({ pressed }) => [s.shareBtn, pressed && s.shareBtnPressed]}
          >
            <Share2 size={15} color="#334155" />
            <Text style={s.shareBtnText}>Share code</Text>
          </Pressable>
        </View>
      ) : (
        <PrimaryButton
          onPress={generateInvite}
          disabled={busy !== null}
          loading={busy === 'generate'}
          icon={<Ticket size={16} color="#fff" />}
        >
          Generate invite code
        </PrimaryButton>
      )}

      {activeInvites.map(invite => (
        <View key={invite.id} style={s.activeInviteRow}>
          <Text style={s.activeInviteText}>Active code {invite.code}</Text>
          <Pressable
            onPress={() => revokeInvite(invite.id)}
            disabled={busy !== null}
            style={({ pressed }) => [s.revokeBtn, pressed && s.revokeBtnPressed]}
          >
            <X size={12} color="#e11d48" />
            <Text style={s.revokeText}>Revoke</Text>
          </Pressable>
        </View>
      ))}

      {/* Join section */}
      <Text style={[s.sectionLabel, { marginTop: 28 }]}>Join another trip</Text>

      <TextInput
        style={s.joinInput}
        value={joinCode}
        onChangeText={v => setJoinCode(v.replace(/\D/g, '').slice(0, LIMITS.invite.code.length))}
        placeholder="123456"
        placeholderTextColor="#cbd5e1"
        keyboardType="number-pad"
        maxLength={LIMITS.invite.code.length}
      />

      <PrimaryButton
        onPress={joinTrip}
        disabled={busy !== null}
        loading={busy === 'join'}
        icon={<UserPlus size={16} color="#fff" />}
        style={{ marginTop: 12 }}
      >
        Join trip
      </PrimaryButton>

      {/* Error */}
      {!!error && (
        <View style={s.errorBanner}>
          <View style={s.errorRow}>
            <ShieldAlert size={16} color="#dc2626" />
            <Text style={s.errorText}>{error}</Text>
          </View>
          {isVerificationError(error) && (
            <Pressable onPress={onRequireVerification} style={s.verifyLink}>
              <Text style={s.verifyLinkText}>Verify with phone →</Text>
            </Pressable>
          )}
        </View>
      )}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#f8fafc' },

  header: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 24 },
  backBtn: { width: 36, height: 36, borderRadius: 12, backgroundColor: '#fff', borderWidth: 1, borderColor: '#e2e8f0', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  backBtnPressed: { backgroundColor: '#e2e8f0' },
  headerSub: { fontSize: 12, fontWeight: '600', color: '#94a3b8', marginTop: 2 },

  sectionLabel: { fontSize: 11, fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 },

  codeCard: { backgroundColor: '#fff', borderRadius: 20, padding: 24, borderWidth: 1, borderColor: '#e2e8f0', alignItems: 'center', gap: 8, marginBottom: 12, shadowColor: '#94a3b8', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 2 },
  codeIconWrap: { width: 44, height: 44, borderRadius: 14, backgroundColor: '#eff6ff', alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  codeHint: { fontSize: 11, fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.8 },
  codeText: { fontSize: 36, fontWeight: '900', color: '#0f172a', letterSpacing: 8, fontFamily: 'Inter_900Black' },
  shareBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8, backgroundColor: '#f1f5f9', borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 14, paddingHorizontal: 16, paddingVertical: 10 },
  shareBtnPressed: { backgroundColor: '#e2e8f0' },
  shareBtnText: { fontSize: 13, fontWeight: '700', color: '#334155' },

  activeInviteRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#fff', borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, marginTop: 10, borderWidth: 1, borderColor: '#e2e8f0' },
  activeInviteText: { fontSize: 13, fontWeight: '600', color: '#334155' },
  revokeBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 10, backgroundColor: '#fff1f2' },
  revokeBtnPressed: { backgroundColor: '#ffe4e6' },
  revokeText: { fontSize: 12, fontWeight: '700', color: '#e11d48' },

  joinInput: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 16, paddingHorizontal: 16, paddingVertical: 16, fontSize: 24, fontWeight: '800', textAlign: 'center', letterSpacing: 8, color: '#0f172a' },

  errorBanner: { marginTop: 20, backgroundColor: '#fff1f2', borderWidth: 1, borderColor: '#fecdd3', borderRadius: 14, padding: 14, gap: 8 },
  errorRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  errorText: { flex: 1, fontSize: 13, fontWeight: '600', color: '#be123c' },
  verifyLink: { paddingTop: 4 },
  verifyLinkText: { fontSize: 13, fontWeight: '700', color: '#0f172a' },
});
