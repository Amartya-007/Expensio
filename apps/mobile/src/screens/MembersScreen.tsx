import { useEffect, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { Link2, UserPlus } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { db } from '../powersync/db';
import { colorFor } from '../utils/avatarColor';
import ScreenHeader from '../components/ScreenHeader';
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
    const ac = new AbortController();
    db.watch(
      'SELECT id, display_name, type FROM participants WHERE trip_id = ?',
      [tripId],
      { onResult: (r) => setParticipants(r.rows?._array ?? []) },
      { signal: ac.signal }
    );
    return () => ac.abort();
  }, [tripId]);

  return (
    <View style={styles.shell}>
      <ScreenHeader
        onBack={onBack}
        title="Members"
        subtitle={`${participants.length} participant${participants.length !== 1 ? 's' : ''}`}
        paddingTop={Math.max(insets.top, 16)}
      />

      {/* ── Sync banner ── */}
      <View style={styles.bannerArea}>
        <SyncStatusBanner />
      </View>

      {/* ── Member list ── */}
      <FlatList
        data={participants}
        keyExtractor={(item) => item.id}
        contentContainerStyle={[
          styles.list,
          { paddingBottom: Math.max(insets.bottom, 16) + 90 },
        ]}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyText}>No members found.</Text>
          </View>
        }
        renderItem={({ item }) => {
          const color = colorFor(item.id);
          // Word-split initials: "Alice Bob" → "AB", "Rahul" → "RA"
          const words = item.display_name.trim().split(/\s+/);
          const initials = words.length >= 2
            ? (words[0][0] + words[words.length - 1][0]).toUpperCase()
            : item.display_name.slice(0, 2).toUpperCase();
          return (
            <View style={styles.memberCard}>
              {/* Avatar */}
              <View style={[styles.avatar, { backgroundColor: color.rawBg, borderColor: color.rawBorder }]}>
                <Text style={[styles.avatarText, { color: color.rawText }]}>{initials}</Text>
              </View>

              {/* Info */}
              <View style={styles.memberInfo}>
                <Text style={styles.memberName}>{item.display_name}</Text>
                <Text style={styles.memberType}>
                  {item.type === 'placeholder' ? 'Added manually · no account' : 'Registered member'}
                </Text>
              </View>

              {/* Type badge */}
              <View style={[
                styles.typeBadge,
                item.type === 'placeholder' ? styles.typeBadgePlaceholder : styles.typeBadgeLinked,
              ]}>
                <Text style={[
                  styles.typeBadgeText,
                  item.type === 'placeholder' ? styles.typeBadgeTextPlaceholder : styles.typeBadgeTextLinked,
                ]}>
                  {item.type === 'placeholder' ? 'Guest' : 'Member'}
                </Text>
              </View>
            </View>
          );
        }}
      />

      {/* ── Bottom action bar ── */}
      <View style={[styles.bottomBar, { paddingBottom: Math.max(insets.bottom, 12) }]}>
        <Pressable
          onPress={onAddParticipant}
          style={({ pressed }) => [styles.secondaryBtn, pressed && styles.secondaryBtnPressed]}
        >
          <UserPlus size={16} color="#334155" />
          <Text style={styles.secondaryBtnText}>Add Person</Text>
        </Pressable>

        <Pressable
          onPress={onOpenInvite}
          style={({ pressed }) => [styles.primaryBtn, pressed && styles.primaryBtnPressed]}
        >
          <Link2 size={16} color="#fff" />
          <Text style={styles.primaryBtnText}>Invite / Join</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  shell: {
    flex: 1,
    backgroundColor: '#f8f9ff',
  },

  // ── Banner ──
  bannerArea: {
    paddingHorizontal: 16,
    paddingTop: 8,
  },

  // ── List ──
  list: {
    paddingHorizontal: 16,
    paddingTop: 10,
    gap: 8,
  },
  empty: {
    alignItems: 'center',
    paddingVertical: 64,
  },
  emptyText: {
    fontSize: 14,
    fontWeight: '400',
    fontFamily: 'Inter_400Regular',
    color: '#737686',
  },

  // ── Member card ──
  memberCard: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    shadowColor: '#0b1c30',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 1,
  },
  avatar: {
    width: 42,
    height: 42,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  avatarText: {
    fontSize: 14,
    fontWeight: '700',
    fontFamily: 'Inter_700Bold',
  },
  memberInfo: {
    flex: 1,
    gap: 2,
  },
  memberName: {
    fontSize: 15,
    fontWeight: '600',
    fontFamily: 'Inter_600SemiBold',
    color: '#0b1c30',
  },
  memberType: {
    fontSize: 12,
    fontWeight: '400',
    fontFamily: 'Inter_400Regular',
    color: '#737686',
  },
  typeBadge: {
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
  },
  typeBadgePlaceholder: {
    backgroundColor: '#fffbeb',
    borderColor: '#fde68a',
  },
  typeBadgeLinked: {
    backgroundColor: '#f0fdf4',
    borderColor: '#bbf7d0',
  },
  typeBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    fontFamily: 'Inter_600SemiBold',
  },
  typeBadgeTextPlaceholder: { color: '#92400e' },
  typeBadgeTextLinked: { color: '#15803d' },

  // ── Bottom bar ──
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#ffffff',
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
    paddingHorizontal: 16,
    paddingTop: 12,
    flexDirection: 'row',
    gap: 10,
    shadowColor: '#0b1c30',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 4,
  },
  secondaryBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#f8f9ff',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 12,
    height: 48,
  },
  secondaryBtnPressed: { backgroundColor: '#eff4ff' },
  secondaryBtnText: {
    fontSize: 14,
    fontWeight: '600',
    fontFamily: 'Inter_600SemiBold',
    color: '#0b1c30',
  },
  primaryBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#2563eb',
    borderRadius: 12,
    height: 48,
    shadowColor: '#2563eb',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 2,
  },
  primaryBtnPressed: { opacity: 0.88, transform: [{ scale: 0.98 }] },
  primaryBtnText: {
    fontSize: 14,
    fontWeight: '600',
    fontFamily: 'Inter_600SemiBold',
    color: '#ffffff',
  },
});
