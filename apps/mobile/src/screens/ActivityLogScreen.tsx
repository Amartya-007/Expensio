import { useEffect, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { ArrowLeft, Clock, Layers } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { db } from '../powersync/db';
import GradientText from '../components/GradientText';

type ActivityEntry = {
  id: string;
  event_type: string;
  description: string;
  created_at: string;
};

// Map event_type to an accent colour so different event kinds are visually distinct
// without needing a lookup table of every possible string.
const EVENT_ACCENTS: Record<string, { bg: string; icon: string }> = {
  expense_added:   { bg: '#f0fdf4', icon: '#16a34a' },
  expense_edited:  { bg: '#eff6ff', icon: '#2563eb' },
  expense_deleted: { bg: '#fff1f2', icon: '#e11d48' },
  member_joined:   { bg: '#f5f3ff', icon: '#7c3aed' },
  member_left:     { bg: '#fffbeb', icon: '#d97706' },
  payment_made:    { bg: '#ecfdf5', icon: '#059669' },
};
function accentFor(eventType: string) {
  return EVENT_ACCENTS[eventType] ?? { bg: '#f8fafc', icon: '#64748b' };
}

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default function ActivityLogScreen({
  tripId,
  onBack,
}: {
  tripId: string;
  onBack: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [log, setLog] = useState<ActivityEntry[]>([]);

  useEffect(() => {
    const ac = new AbortController();
    db.watch(
      'SELECT id, event_type, description, created_at FROM trip_activity_log WHERE trip_id = ? ORDER BY created_at DESC',
      [tripId],
      { onResult: (r) => setLog(r.rows?._array ?? []) },
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
          <GradientText className="text-2xl font-black">Activity Log</GradientText>
          <Text style={styles.headerSub}>History of changes and events</Text>
        </View>

        {log.length > 0 && (
          <View style={styles.countBadge}>
            <Text style={styles.countBadgeText}>{log.length}</Text>
          </View>
        )}
      </View>

      {/* ── Log list ── */}
      <FlatList
        data={log}
        keyExtractor={(item) => item.id}
        contentContainerStyle={[
          styles.list,
          { paddingBottom: Math.max(insets.bottom, 16) + 24 },
        ]}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Layers size={36} color="#cbd5e1" />
            <Text style={styles.emptyTitle}>No activity yet</Text>
            <Text style={styles.emptyBody}>
              Events like adding expenses or new members will appear here.
            </Text>
          </View>
        }
        renderItem={({ item, index }) => {
          const accent = accentFor(item.event_type);
          const isLast = index === log.length - 1;
          return (
            <View style={styles.entryRow}>
              {/* Timeline line */}
              <View style={styles.timelineTrack}>
                <View style={[styles.timelineDot, { backgroundColor: accent.icon }]} />
                {!isLast && <View style={styles.timelineLine} />}
              </View>

              {/* Content card */}
              <View style={[styles.entryCard, isLast && { marginBottom: 0 }]}>
                <View style={[styles.entryIconWrap, { backgroundColor: accent.bg }]}>
                  <Clock size={14} color={accent.icon} />
                </View>
                <View style={styles.entryBody}>
                  <Text style={styles.entryDesc}>{item.description}</Text>
                  <Text style={styles.entryTime}>{formatTimestamp(item.created_at)}</Text>
                </View>
              </View>
            </View>
          );
        }}
      />
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
  countBadge: {
    backgroundColor: '#eff6ff',
    borderWidth: 1,
    borderColor: '#bfdbfe',
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 20,
  },
  countBadgeText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#2563eb',
  },

  // ── List ──
  list: {
    paddingHorizontal: 16,
    paddingTop: 20,
  },
  empty: {
    alignItems: 'center',
    paddingVertical: 72,
    paddingHorizontal: 32,
    gap: 10,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#334155',
  },
  emptyBody: {
    fontSize: 13,
    fontWeight: '500',
    color: '#94a3b8',
    textAlign: 'center',
    lineHeight: 20,
  },

  // ── Timeline entry ──
  entryRow: {
    flexDirection: 'row',
    gap: 12,
  },
  timelineTrack: {
    width: 20,
    alignItems: 'center',
    paddingTop: 2,
  },
  timelineDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    flexShrink: 0,
  },
  timelineLine: {
    flex: 1,
    width: 2,
    backgroundColor: '#e2e8f0',
    marginTop: 4,
    marginBottom: -8,
  },
  entryCard: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    backgroundColor: '#fff',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 14,
    marginBottom: 10,
    shadowColor: '#94a3b8',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },
  entryIconWrap: {
    width: 30,
    height: 30,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  entryBody: { flex: 1, gap: 3 },
  entryDesc: {
    fontSize: 13,
    fontWeight: '600',
    color: '#0f172a',
    lineHeight: 19,
  },
  entryTime: {
    fontSize: 11,
    fontWeight: '500',
    color: '#94a3b8',
  },
});
