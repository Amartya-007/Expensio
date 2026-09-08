import { useEffect, useState } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { Clock, Layers } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { db } from '../powersync/db';
import ScreenHeader from '../components/ScreenHeader';
import { formatTimestamp } from '../utils/formatDate';

type ActivityEntry = {
  id: string;
  event_type: string;
  description: string;
  created_at: string;
};

// Map event_type to an accent colour so different event kinds are visually distinct
// without needing a lookup table of every possible string.
const EVENT_ACCENTS: Record<string, { bg: string; icon: string }> = {
  expense_added:   { bg: '#d1fae5', icon: '#059669' },
  expense_edited:  { bg: '#dbeafe', icon: '#2563eb' },
  expense_deleted: { bg: '#fee2e2', icon: '#dc2626' },
  member_joined:   { bg: '#e8ecf4', icon: '#0b1c30' },
  member_left:     { bg: '#fef3c7', icon: '#d97706' },
  payment_made:    { bg: '#d1fae5', icon: '#047857' },
};
function accentFor(eventType: string) {
  return EVENT_ACCENTS[eventType] ?? { bg: '#f1f5f9', icon: '#43474e' };
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
      <ScreenHeader
        onBack={onBack}
        title="Activity Log"
        subtitle="History of changes and events"
        paddingTop={Math.max(insets.top, 16)}
        right={
          log.length > 0 ? (
            <View style={styles.countBadge}>
              <Text style={styles.countBadgeText}>{log.length}</Text>
            </View>
          ) : undefined
        }
      />

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
    backgroundColor: '#f8f9ff',
  },

  // ── Header ──
  countBadge: {
    backgroundColor: '#e8ecf4',
    borderWidth: 1,
    borderColor: '#c5c6d0',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  countBadgeText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0b1c30',
    fontVariant: ['tabular-nums'],
  },

  // ── List ──
  list: {
    paddingHorizontal: 16,
    paddingTop: 20,
  },
  empty: {
    alignItems: 'center',
    paddingVertical: 56,
    paddingHorizontal: 24,
    gap: 12,
    backgroundColor: '#ffffff',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0b1c30',
  },
  emptyBody: {
    fontSize: 13,
    fontWeight: '500',
    color: '#43474e',
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
    paddingTop: 4,
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
    gap: 12,
    backgroundColor: '#ffffff',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 14,
    marginBottom: 10,
  },
  entryIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  entryBody: { flex: 1, gap: 4 },
  entryDesc: {
    fontSize: 14,
    fontWeight: '600',
    color: '#0b1c30',
    lineHeight: 20,
  },
  entryTime: {
    fontSize: 12,
    fontWeight: '500',
    color: '#43474e',
    fontVariant: ['tabular-nums'],
  },
});
