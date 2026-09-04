import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ArrowLeftRight, Home, List, Plus, Settings } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export type TripTab = 'home' | 'expenses' | 'settle' | 'settings';

const LEFT_ITEMS: Array<{ key: TripTab; label: string; Icon: typeof Home }> = [
  { key: 'home', label: 'Home', Icon: Home },
  { key: 'expenses', label: 'Expenses', Icon: List },
];
const RIGHT_ITEMS: Array<{ key: TripTab; label: string; Icon: typeof Home }> = [
  { key: 'settle', label: 'Settle', Icon: ArrowLeftRight },
  { key: 'settings', label: 'Settings', Icon: Settings },
];

export default function TripTabBar({
  active,
  onChange,
  onAddExpense,
}: {
  active: TripTab;
  onChange: (tab: TripTab) => void;
  onAddExpense: () => void;
}) {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.container, { paddingBottom: Math.max(insets.bottom, 10) }]}>
      <View style={styles.row}>
        {/* Left tabs */}
        {LEFT_ITEMS.map((item) => (
          <NavItem
            key={item.key}
            item={item}
            active={active === item.key}
            onPress={() => onChange(item.key)}
          />
        ))}

        {/* Centre FAB */}
        <View style={styles.fabWrapper}>
          <Pressable
            onPress={onAddExpense}
            style={({ pressed }) => [styles.fab, pressed && styles.fabPressed]}
          >
            <Plus size={24} color="#fff" strokeWidth={2.5} />
          </Pressable>
        </View>

        {/* Right tabs */}
        {RIGHT_ITEMS.map((item) => (
          <NavItem
            key={item.key}
            item={item}
            active={active === item.key}
            onPress={() => onChange(item.key)}
          />
        ))}
      </View>
    </View>
  );
}

function NavItem({
  item,
  active,
  onPress,
}: {
  item: { label: string; Icon: typeof Home };
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.navItem, pressed && styles.navItemPressed]}
    >
      <View style={[styles.navIconWrap, active && styles.navIconWrapActive]}>
        <item.Icon
          size={20}
          color={active ? '#2563eb' : '#94a3b8'}
          strokeWidth={active ? 2.5 : 2}
        />
      </View>
      <Text style={[styles.navLabel, active && styles.navLabelActive]}>
        {item.label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.06,
    shadowRadius: 16,
    elevation: 12,
    zIndex: 40,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 60,
    paddingHorizontal: 8,
  },

  // ── Nav item ──
  navItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    paddingVertical: 6,
    borderRadius: 14,
  },
  navItemPressed: {
    backgroundColor: '#f8fafc',
  },
  navIconWrap: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navIconWrapActive: {
    backgroundColor: '#eff6ff',
  },
  navLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: '#94a3b8',
    letterSpacing: 0.2,
  },
  navLabelActive: {
    color: '#2563eb',
    fontWeight: '800',
  },

  // ── FAB ──
  fabWrapper: {
    width: 64,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: -20,
  },
  fab: {
    width: 52,
    height: 52,
    borderRadius: 18,
    backgroundColor: '#2563eb',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#2563eb',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 8,
    borderWidth: 3,
    borderColor: '#fff',
  },
  fabPressed: {
    transform: [{ scale: 0.93 }],
    shadowOpacity: 0.2,
  },
});
