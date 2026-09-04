import { useEffect, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { ArrowLeft, Link2, UserPlus } from 'lucide-react-native';
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
      {/* ── Header ── */}
      <View style={[styles.header, { paddingTop: Math.max(insets.top, 16) }]}>
        <Pressable
          onPress={onBack}
          style={({ pressed }) => [styles.backBtn, pressed && styles.backBtnPressed]}
          hitSlop={8}
        >
          <ArrowLeft size={18} color="#334155" />
        </Pressable>

        <View style={styles.headerBody}>
          <GradientText className="text-2xl font-black">Members</GradientText>
          <Text style={styles.headerSub}>
            {participants.length} participant{participants.length !== 1 ? 's' : ''}
          </Text>
        </View>
      </View>

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
          const initials = item.display_name.slice(0, 2).toUpperCase();
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
    backgroundColor: '#f8fafc',
  },

  // ── Header ──
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingBottom: 14,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  backBtnPressed: { backgroundColor: '#e2e8f0' },
  headerBody: { flex: 1 },
  headerSub: {
    fontSize: 12,
    fontWeight: '600',
    color: '#94a3b8',
    marginTop: 2,
  },

  // ── Banner ──
  bannerArea: {
    paddingHorizontal: 16,
    paddingTop: 12,
  },

  // ── List ──
  list: {
    paddingHorizontal: 16,
    paddingTop: 12,
    gap: 8,
  },
  empty: {
    alignItems: 'center',
    paddingVertical: 64,
  },
  emptyText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#94a3b8',
  },

  // ── Member card ──
  memberCard: {
    backgroundColor: '#fff',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    shadowColor: '#94a3b8',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 1,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  avatarText: {
    fontSize: 15,
    fontWeight: '800',
  },
  memberInfo: {
    flex: 1,
    gap: 2,
  },
  memberName: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0f172a',
  },
  memberType: {
    fontSize: 12,
    fontWeight: '500',
    color: '#94a3b8',
  },
  typeBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
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
    fontWeight: '700',
  },
  typeBadgeTextPlaceholder: { color: '#b45309' },
  typeBadgeTextLinked: { color: '#15803d' },

  // ── Bottom bar ──
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
    paddingHorizontal: 16,
    paddingTop: 12,
    flexDirection: 'row',
    gap: 10,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.05,
    shadowRadius: 12,
    elevation: 8,
  },
  secondaryBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#f1f5f9',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 16,
    paddingVertical: 14,
  },
  secondaryBtnPressed: { backgroundColor: '#e2e8f0' },
  secondaryBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#334155',
  },
  primaryBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#2563eb',
    borderRadius: 16,
    paddingVertical: 14,
    shadowColor: '#2563eb',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 4,
  },
  primaryBtnPressed: { opacity: 0.88, transform: [{ scale: 0.97 }] },
  primaryBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#fff',
  },
});
