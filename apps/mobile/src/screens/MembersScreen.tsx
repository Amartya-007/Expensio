import { useEffect, useState } from 'react';
import { ArrowLeft, UserPlus, Users } from 'lucide-react-native';
import { FlatList, Pressable, Text, View } from 'react-native';
import { db } from '../powersync/db';
import { colorFor } from '../utils/avatarColor';

type Participant = { id: string; display_name: string; type: string };

// Extracted from TripDetailScreen.tsx's old in-page 'members' tab body + its footer
// (Add Person / Invite buttons), once that tab moved out to make room for the
// Home/Expenses/Settle/Settings bottom tab bar -- see TripSettingsScreen.tsx's "Manage
// Members" row, the new way in. This actually matches tripspend/src/screens/TripDetails.tsx
// more closely than the old flat tab did: TripSpend's own member management
// (GroupMemberManager.tsx) isn't a bottom tab there either, it's one level down from
// Settings. Row layout, colorFor badge, and both button actions are otherwise unchanged
// from before this move.
export default function MembersScreen({
  tripId,
  onBack,
  onAddParticipant,
  onOpenInvite,
}: {
  tripId: string;
  onBack: () => void;
  onAddParticipant: () => void;
  onOpenInvite: () => void;
}) {
  const [participants, setParticipants] = useState<Participant[]>([]);

  useEffect(() => {
    const abortController = new AbortController();
    db.watch(
      'SELECT id, display_name, type FROM participants WHERE trip_id = ?',
      [tripId],
      { onResult: (result) => setParticipants(result.rows?._array ?? []) },
      { signal: abortController.signal }
    );
    return () => abortController.abort();
  }, [tripId]);

  return (
    <View className="flex-1 bg-white">
      <View className="page-shell pb-0">
        <View className="flex-row items-center gap-3 page-header">
          <Pressable onPress={onBack} className="p-2 -ml-1 rounded-xl active:bg-slate-100">
            <ArrowLeft size={20} color="#64748b" />
          </Pressable>
          <View>
            <Text className="page-title">Members</Text>
            <Text className="page-subtitle">
              {participants.length} participant{participants.length !== 1 ? 's' : ''}
            </Text>
          </View>
        </View>
      </View>

      <FlatList
        data={participants}
        keyExtractor={(item) => item.id}
        contentContainerClassName="px-4 pb-28 pt-3"
        ListEmptyComponent={<Text className="text-slate-400 text-center mt-16">No one here yet.</Text>}
        renderItem={({ item }) => {
          const color = colorFor(item.id);
          return (
            <View className="flex-row items-center gap-3 py-3 border-b border-slate-50">
              <View className={`w-10 h-10 rounded-full items-center justify-center ${color.bg} border ${color.border}`}>
                <Text className={`text-sm font-black ${color.text}`}>{item.display_name[0]?.toUpperCase() ?? '?'}</Text>
              </View>
              <View className="flex-1">
                <Text className="text-sm font-bold text-slate-900">{item.display_name}</Text>
                <Text className="text-xs text-slate-400 mt-0.5">
                  {item.type === 'placeholder' ? 'Added by you, no account' : 'Has an account'}
                </Text>
              </View>
            </View>
          );
        }}
      />

      <View className="absolute bottom-6 left-4 right-4 flex-row gap-3">
        <Pressable onPress={onAddParticipant} className="flex-1 btn-secondary flex-row items-center justify-center gap-2">
          <UserPlus size={16} color="#475569" />
          <Text className="text-slate-600 font-bold text-sm">Add Person</Text>
        </Pressable>
        <Pressable onPress={onOpenInvite} className="flex-1 bg-slate-900 rounded-2xl py-3 flex-row items-center justify-center gap-2">
          <Users size={16} color="#fff" />
          <Text className="text-white font-bold text-sm">Invite / Join</Text>
        </Pressable>
      </View>
    </View>
  );
}
