import { useState } from 'react';
import { Pressable, SafeAreaView, Text, TextInput, View } from 'react-native';
import { ArrowLeft, UserCircle2 } from 'lucide-react-native';
import { callRpc } from '../rpc';
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
      await callRpc('add_placeholder_participant', {
        p_trip_id: tripId,
        p_display_name: name.trim(),
        p_phone: phone.trim() || null,
      });
      onDone();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView className="flex-1 bg-white">
      <View className="page-shell space-y-6">
        {/* Header — matches TripDetails.tsx's back-arrow + page-title pattern */}
        <View className="flex-row items-center gap-3 page-header">
          <Pressable onPress={onCancel} disabled={busy} className="p-2 -ml-1 rounded-xl active:bg-slate-100">
            <ArrowLeft size={20} color="#64748b" />
          </Pressable>
          <View>
            <GradientText className="page-title">Add a person</GradientText>
            <Text className="page-subtitle">For splitting expenses together</Text>
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
            <View className="bg-red-50 border border-red-200 rounded-2xl px-4 py-3">
              <Text className="text-sm text-red-700 font-medium">⚠ {error}</Text>
            </View>
          )}
        </View>

        {/* Actions */}
        <View className="flex-row gap-3">
          <Pressable
            onPress={onCancel}
            disabled={busy}
            className="flex-1 py-3.5 rounded-2xl items-center justify-center active:bg-slate-100"
          >
            <Text className="text-slate-600 font-semibold text-sm">Cancel</Text>
          </Pressable>
          <View className="flex-1">
            <PrimaryButton onPress={submit} disabled={!name.trim()} loading={busy} className="w-full">
              Add
            </PrimaryButton>
          </View>
        </View>
      </View>
    </SafeAreaView>
  );
}
