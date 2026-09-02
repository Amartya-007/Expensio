import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { ArrowLeft, UserCircle2 } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { callRpc } from '../rpc';
import { formatError } from '../utils/errors';
import PrimaryButton from '../components/PrimaryButton';
import GradientText from '../components/GradientText';

// Placeholder participants are how Expensio handles someone who doesn't have (or doesn't
// want) the app -- see permissions-matrix.md: a placeholder has no auth.uid(), so any
// active trip member manages expenses on their behalf. This is the ONLY way to add another
// person to a trip right now -- real invites (generate_invite/join_trip_via_code) need
// is_verified_user(), which nothing in this client satisfies yet (anonymous sign-in only).
//
// Visual language ported from tripspend/src/screens/GroupMemberManager.tsx's "add new
// member" row + tripspend's shared page-shell/page-header/card-elevated/input-field
// classes (global.css) -- see docs/architecture/expensio-ui-port-plan.md for the full
// screen-by-screen mapping. The richer list-management view GroupMemberManager actually
// is (inline rename, remove-with-settlement-check, restore inactive members) is scoped as
// its own follow-up there, not attempted in this pass -- this screen ports the "add"
// slice only, matching what exists on the Expensio side today.
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
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const result = await callRpc('add_placeholder_participant', {
        p_trip_id: tripId,
        p_display_name: name.trim(),
        p_phone: phone.trim() || null,
      });
      if (result.status === 'ok') {
        // RPC ran immediately — the new participant will sync back down via
        // PowerSync within seconds and appear in MembersScreen's db.watch query.
        onDone();
      } else {
        // Queued for later (offline). The participant won't appear on the
        // members list until the connection returns and the RPC actually runs.
        setError(
          'You appear to be offline. The member will be added automatically when you reconnect.'
        );
      }
    } catch (err) {
      setError(formatError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View
      style={{
        paddingTop: Math.max(insets.top, 16),
        paddingBottom: Math.max(insets.bottom, 16),
        paddingHorizontal: 16,
      }}
      className="flex-1 bg-white justify-between"
    >
      <View className="space-y-5">
        {/* Header */}
        <View className="flex-row items-center gap-3 mb-2">
          <Pressable onPress={onCancel} disabled={busy} className="p-2 -ml-2 rounded-xl active:bg-slate-100">
            <ArrowLeft size={20} color="#1e293b" />
          </Pressable>
          <View>
            <GradientText className="text-2xl font-black">Add a Person</GradientText>
            <Text className="text-xs font-semibold text-slate-500">For splitting expenses together</Text>
          </View>
        </View>

        {/* Hint card */}
        <View className="card-elevated p-4">
          <Text className="text-sm text-slate-500 leading-5">
            For splitting expenses with someone who isn't using the app. Give them a phone
            number now and if they ever join for real with that same number, this gets
            linked to their account automatically.
          </Text>
        </View>

        {/* Form */}
        <View className="space-y-4">
          <View>
            <Text className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-2 flex-row items-center gap-1.5">
              Name
            </Text>
            <View
              className={`flex-row items-center gap-2 input-field ${nameFocused ? 'input-field-focused' : ''}`}
            >
              <UserCircle2 size={18} color="#94a3b8" />
              <TextInput
                className="flex-1 text-base text-slate-900"
                value={name}
                onChangeText={setName}
                onFocus={() => setNameFocused(true)}
                onBlur={() => setNameFocused(false)}
                placeholder="Rahul"
                placeholderTextColor="#94a3b8"
                autoFocus
              />
            </View>
          </View>

          <View>
            <Text className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">
              Phone (optional)
            </Text>
            <TextInput
              className={`input-field text-base text-slate-900 ${phoneFocused ? 'input-field-focused' : ''}`}
              value={phone}
              onChangeText={setPhone}
              onFocus={() => setPhoneFocused(true)}
              onBlur={() => setPhoneFocused(false)}
              placeholder="+91…"
              placeholderTextColor="#94a3b8"
              keyboardType="phone-pad"
            />
          </View>

          {error && (
            <View className={`rounded-2xl px-4 py-3 ${error.includes('offline') ? 'bg-amber-50 border border-amber-200' : 'bg-red-50 border border-red-200'}`}>
              <Text className={`text-sm font-medium ${error.includes('offline') ? 'text-amber-800' : 'text-red-700'}`}>
                {error.includes('offline') ? '📶 ' : '⚠ '}{error}
              </Text>
            </View>
          )}
        </View>

        {/* Actions */}
        <View className="flex-row gap-3 mt-auto pt-4">
          <Pressable
            onPress={onCancel}
            disabled={busy}
            className="flex-1 py-3.5 rounded-2xl items-center justify-center border border-slate-300 active:bg-slate-100"
          >
            <Text className="text-slate-700 font-bold text-sm">Cancel</Text>
          </Pressable>
          <View className="flex-1">
            <PrimaryButton onPress={submit} disabled={!name.trim()} loading={busy} className="w-full">
              Add Member
            </PrimaryButton>
          </View>
        </View>
      </View>
    </View>
  );
}
