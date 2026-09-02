import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Share, Text, TextInput, View } from 'react-native';
import { ArrowLeft, Share2, ShieldAlert, Ticket, UserPlus, X } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { callRpc } from '../rpc';
import { db } from '../powersync/db';
import { formatError } from '../utils/errors';
import PrimaryButton from '../components/PrimaryButton';
import GradientText from '../components/GradientText';

type ActiveInvite = { id: string; code: string; expires_at: string; use_count: number; max_uses: number | null };

function isVerificationError(error: unknown): boolean {
  return String(error).toLowerCase().includes('verify your account');
}

// Restyled with this port's design language -- TripSpend's own invite flow isn't a
// standalone screen to port from at all (it lives inline elsewhere in that codebase), so
// this follows the established page-shell/card-elevated/badge patterns instead. All
// logic (every RPC call, the verification-error detection, code formatting) is
// unchanged from before this pass -- only the JSX changed.
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
        // Route directly to the verification flow instead of making the user
        // read the error and tap a separate "Verify with phone →" link.
        // This matches the design intent in expensio-onboarding-auth.md §3:
        // hitting the collaborative gate should immediately trigger verification.
        setBusy(null);
        onRequireVerification();
        return;
      }
      setError(formatError(err));
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
        // Same immediate redirect as generateInvite — don't make the user
        // tap a secondary link in the error card.
        setBusy(null);
        onRequireVerification();
        return;
      }
      setError(formatError(err));
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
      setError(formatError(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <ScrollView
      className="flex-1 bg-white"
      contentContainerStyle={{
        paddingTop: Math.max(insets.top, 16),
        paddingBottom: Math.max(insets.bottom, 16) + 32,
        paddingHorizontal: 16,
      }}
      showsVerticalScrollIndicator={false}
    >
      <View className="flex-row items-center gap-3 mb-5">
        <Pressable onPress={onDone} disabled={busy !== null} className="p-2 -ml-2 rounded-xl active:bg-slate-100">
          <ArrowLeft size={20} color="#1e293b" />
        </Pressable>
        <View>
          <GradientText className="text-2xl font-black">Invite or Join</GradientText>
          <Text className="text-xs font-semibold text-slate-500">Share a one-time code with a verified account</Text>
        </View>
      </View>

      <View>
        <Text className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Invite someone to this trip</Text>
        {inviteCode ? (
          <View className="card-elevated p-6 items-center">
            <View className="w-10 h-10 rounded-2xl bg-blue-50 border border-blue-100 items-center justify-center mb-3">
              <Ticket size={18} color="#2563eb" />
            </View>
            <Text className="text-xs font-bold text-slate-400 uppercase tracking-wider">Invite code</Text>
            <Text className="text-4xl font-black text-slate-900 tracking-[0.2em] my-2">{inviteCode}</Text>
            <Pressable onPress={shareInvite} className="btn-secondary flex-row items-center gap-2 mt-2">
              <Share2 size={15} color="#475569" />
              <Text className="text-slate-600 font-bold text-sm">Share code</Text>
            </Pressable>
          </View>
        ) : (
          <PrimaryButton onPress={generateInvite} disabled={busy !== null} loading={busy === 'generate'} icon={<Ticket size={16} color="#fff" />} className="w-full">
            Generate invite code
          </PrimaryButton>
        )}

        {activeInvites.map((invite) => (
          <View className="flex-row items-center justify-between gap-3 bg-slate-50 rounded-2xl px-4 py-3 mt-3" key={invite.id}>
            <Text className="text-sm font-semibold text-slate-700">Active code {invite.code}</Text>
            <Pressable onPress={() => revokeInvite(invite.id)} disabled={busy !== null} className="flex-row items-center gap-1">
              <X size={12} color="#e11d48" />
              <Text className="text-xs font-bold text-rose-600">Revoke</Text>
            </Pressable>
          </View>
        ))}
      </View>

      <View>
        <Text className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Join another trip</Text>
        <TextInput
          className="input-field text-lg font-black text-slate-900 tracking-[0.3em] text-center mb-3"
          value={joinCode}
          onChangeText={(value) => setJoinCode(value.replace(/\D/g, '').slice(0, 6))}
          placeholder="123456"
          placeholderTextColor="#cbd5e1"
          keyboardType="number-pad"
          maxLength={6}
        />
        <PrimaryButton onPress={joinTrip} disabled={busy !== null} loading={busy === 'join'} icon={<UserPlus size={16} color="#fff" />} className="w-full">
          Join trip
        </PrimaryButton>
      </View>

      {!!error && (
        <View className="bg-red-50 border border-red-200 rounded-2xl px-4 py-3">
          <View className="flex-row items-start gap-2">
            <ShieldAlert size={16} color="#dc2626" />
            <Text className="text-sm text-red-700 font-medium flex-1">{error}</Text>
          </View>
          {isVerificationError(error) && (
            <Pressable onPress={onRequireVerification} className="mt-2">
              <Text className="text-sm font-bold text-slate-900">Verify with phone →</Text>
            </Pressable>
          )}
        </View>
      )}
    </ScrollView>
  );
}
