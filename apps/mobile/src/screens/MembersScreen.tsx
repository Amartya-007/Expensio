import { useEffect, useState } from 'react';
import { ArrowLeft, UserPlus, Users } from 'lucide-react-native';
import { FlatList, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { db } from '../powersync/db';
import { colorFor } from '../utils/avatarColor';
import GradientText from '../components/GradientText';
import SyncStatusBanner from '../components/SyncStatusBanner';

type Participant = { id: string; display_name: string; type: string };

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
  const insets = useSafeAreaInsets();
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
      {/* Header with Safe Area Inset */}
      <View style={{ paddingTop: Math.max(insets.top, 16) }} className="px-4 pb-3 bg-white border-b border-slate-100">
        <View className="flex-row items-center gap-3">
          <Pressable onPress={onBack} className="p-2 -ml-2 rounded-xl active:bg-slate-100">
            <ArrowLeft size={20} color="#1e293b" />
          </Pressable>
          <View>
            <GradientText className="text-2xl font-black">Members</GradientText>
            <Text className="text-xs font-semibold text-slate-500">
              {participants.length} participant{participants.length !== 1 ? 's' : ''} in this trip
            </Text>
          </View>
        </View>
      </View>

      <View className="px-4 pt-3">
        <SyncStatusBanner />
      </View>

      <FlatList
        data={participants}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingTop: 12,
          paddingBottom: Math.max(insets.bottom, 16) + 80,
        }}
        ListEmptyComponent={
          <View className="items-center py-16">
            <Text className="text-sm font-semibold text-slate-400">No members found.</Text>
          </View>
        }
        renderItem={({ item }) => {
          const color = colorFor(item.id);
          return (
            <View className="flex-row items-center gap-3.5 py-3.5 px-3 mb-2 rounded-2xl bg-slate-50 border border-slate-200/60">
              <View className={`w-11 h-11 rounded-2xl items-center justify-center ${color.bg} border ${color.border}`}>
                <Text className={`text-base font-black ${color.text}`}>{item.display_name[0]?.toUpperCase() ?? '?'}</Text>
              </View>
              <View className="flex-1">
                <Text className="text-base font-bold text-slate-900">{item.display_name}</Text>
                <Text className="text-xs font-semibold text-slate-400 mt-0.5">
                  {item.type === 'placeholder' ? 'Added locally (no account)' : 'Registered account'}
                </Text>
              </View>
            </View>
          );
        }}
      />

      {/* Pinned Bottom Action Bar */}
      <View
        style={{ paddingBottom: Math.max(insets.bottom, 12) }}
        className="absolute bottom-0 left-0 right-0 bg-white border-t border-slate-200 px-4 pt-3 flex-row gap-3 shadow-xl"
      >
        <Pressable
          onPress={onAddParticipant}
          className="flex-1 py-3.5 rounded-2xl bg-slate-100 border border-slate-200 flex-row items-center justify-center gap-2 active:bg-slate-200"
        >
          <UserPlus size={16} color="#1e293b" />
          <Text className="text-slate-800 font-bold text-sm">Add Person</Text>
        </Pressable>

        <Pressable
          onPress={onOpenInvite}
          className="flex-1 py-3.5 rounded-2xl bg-blue-600 flex-row items-center justify-center gap-2 shadow-md shadow-blue-500/30 active:bg-blue-700"
        >
          <Users size={16} color="#ffffff" />
          <Text className="text-white font-bold text-sm">Invite / Join</Text>
        </Pressable>
      </View>
    </View>
  );
}
