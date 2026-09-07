import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import { ArrowLeft, Link2, Share2, ShieldAlert, Ticket, UserPlus, X } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { callRpc } from '../rpc';
import { db } from '../powersync/db';
import { formatError } from '../utils/errors';
import { LIMITS } from '../constants/limits';
import PrimaryButton from '../components/PrimaryButton';

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
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <ArrowLeft size={18} color="#0b1c30" strokeWidth={2} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={s.headerTitle}>Invite or Join</Text>
          <Text style={s.headerSub}>Share a one-time code with a verified account</Text>
        </View>
      </View>

      {/* Invite section */}
      <Text style={s.sectionLabel}>Invite someone to this trip</Text>

      {displayCode ? (
        <View style={s.codeCard}>
          <View style={s.codeIconWrap}>
            <Ticket size={22} color="#2563eb" strokeWidth={2} />
          </View>
          <Text style={s.codeHint}>Invite code</Text>
          <Text style={s.codeText}>{displayCode}</Text>
          <Pressable
            onPress={shareInvite}
            style={({ pressed }) => [s.shareBtn, pressed && s.shareBtnPressed]}
            accessibilityRole="button"
            accessibilityLabel="Share code"
          >
            <Share2 size={15} color="#0b1c30" />
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
            accessibilityRole="button"
            accessibilityLabel={`Revoke code ${invite.code}`}
          >
            <X size={12} color="#ba1a1a" />
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
        placeholderTextColor="#c3c6d7"
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
            <ShieldAlert size={16} color="#ba1a1a" />
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
  root: { flex: 1, backgroundColor: '#f8f9ff' },

  header: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 20 },
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

  sectionLabel: {
    fontSize: 12,
    fontWeight: '600',
    fontFamily: 'Inter_600SemiBold',
    color: '#737686',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 10,
  },

  codeCard: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 24,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
    shadowColor: '#0b1c30',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 1,
  },
  codeIconWrap: {
    width: 46,
    height: 46,
    borderRadius: 12,
    backgroundColor: '#eff4ff',
    borderWidth: 1,
    borderColor: '#bfdbfe',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  codeHint: {
    fontSize: 11,
    fontWeight: '600',
    fontFamily: 'Inter_600SemiBold',
    color: '#737686',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  codeText: {
    fontSize: 34,
    fontWeight: '700',
    fontFamily: 'Inter_700Bold',
    color: '#0b1c30',
    letterSpacing: 6,
    fontVariant: ['tabular-nums'],
  },
  shareBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
    backgroundColor: '#f8f9ff',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 12,
    paddingHorizontal: 16,
    height: 40,
  },
  shareBtnPressed: { backgroundColor: '#eff4ff' },
  shareBtnText: {
    fontSize: 13,
    fontWeight: '600',
    fontFamily: 'Inter_600SemiBold',
    color: '#0b1c30',
  },

  activeInviteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#ffffff',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginTop: 8,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  activeInviteText: {
    fontSize: 13,
    fontWeight: '600',
    fontFamily: 'Inter_600SemiBold',
    color: '#0b1c30',
    fontVariant: ['tabular-nums'],
  },
  revokeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    backgroundColor: '#ffdad6',
  },
  revokeBtnPressed: { backgroundColor: '#ffb4ab' },
  revokeText: {
    fontSize: 12,
    fontWeight: '600',
    fontFamily: 'Inter_600SemiBold',
    color: '#ba1a1a',
  },

  joinInput: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#c3c6d7',
    borderRadius: 12,
    paddingHorizontal: 16,
    height: 52,
    fontSize: 22,
    fontWeight: '700',
    fontFamily: 'Inter_700Bold',
    textAlign: 'center',
    letterSpacing: 6,
    color: '#0b1c30',
    fontVariant: ['tabular-nums'],
  },

  errorBanner: {
    marginTop: 18,
    backgroundColor: '#ffdad6',
    borderWidth: 1,
    borderColor: '#ffb4ab',
    borderRadius: 12,
    padding: 14,
    gap: 8,
  },
  errorRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  errorText: {
    flex: 1,
    fontSize: 13,
    fontWeight: '600',
    fontFamily: 'Inter_600SemiBold',
    color: '#ba1a1a',
  },
  verifyLink: { paddingTop: 4 },
  verifyLinkText: {
    fontSize: 13,
    fontWeight: '700',
    fontFamily: 'Inter_700Bold',
    color: '#0b1c30',
  },
});
