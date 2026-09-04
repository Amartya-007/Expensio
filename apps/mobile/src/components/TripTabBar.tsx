import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ArrowLeftRight, Home, List, Plus, Settings } from 'lucide-react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export type TripTab = 'home' | 'expenses' | 'settle' | 'settings';

// Defined in order: [home, expenses, FAB, settle, settings]
// The FAB sits as a standalone View between the two pairs so all 4 tab items
// get equal flex and the layout is perfectly symmetric.
const ALL_TABS: Array<{ key: TripTab; label: string; Icon: typeof Home }> = [
  { key: 'home',     label: 'Home',     Icon: Home },
  { key: 'expenses', label: 'Expenses', Icon: List },
  { key: 'settle',   label: 'Settle',   Icon: ArrowLeftRight },
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
        {/* Left pair */}
        <NavItem item={ALL_TABS[0]} active={active === ALL_TABS[0].key} onPress={() => onChange(ALL_TABS[0].key)} />
        <NavItem item={ALL_TABS[1]} active={active === ALL_TABS[1].key} onPress={() => onChange(ALL_TABS[1].key)} />

        {/* Centre FAB — fixed width so it doesn't steal flex from the tab items */}
        <View style={styles.fabWrapper}>
          <Pressable
            onPress={onAddExpense}
            style={({ pressed }) => [styles.fabOuter, pressed && styles.fabPressed]}
            hitSlop={4}
          >
            <LinearGradient
              colors={['#3b82f6', '#1d4ed8']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.fab}
            >
              <Plus size={26} color="#fff" strokeWidth={2.5} />
            </LinearGradient>
          </Pressable>
        </View>

        {/* Right pair */}
        <NavItem item={ALL_TABS[2]} active={active === ALL_TABS[2].key} onPress={() => onChange(ALL_TABS[2].key)} />
        <NavItem item={ALL_TABS[3]} active={active === ALL_TABS[3].key} onPress={() => onChange(ALL_TABS[3].key)} />
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
      style={({ pressed }) => [
        styles.navItem,
        active && styles.navItemActive,
        pressed && !active && styles.navItemPressed,
      ]}
    >
      <item.Icon
        size={active ? 21 : 20}
        color={active ? '#2563eb' : '#94a3b8'}
        strokeWidth={active ? 2.5 : 1.8}
      />
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
    backgroundColor: '#ffffff',
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: -3 },
    shadowOpacity: 0.07,
    shadowRadius: 16,
    elevation: 16,
    zIndex: 40,
  },
  // flexDirection row, each of the 4 tab items is flex:1, FAB is fixed-width
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 64,
    paddingHorizontal: 4,
  },

  // ── Nav item — flex:1 so the 4 items share equal space ──────────────────────
  navItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    paddingVertical: 6,
    paddingHorizontal: 4,
    borderRadius: 18,
    minWidth: 0,
  },
  navItemActive: {
    backgroundColor: '#eff6ff',
  },
  navItemPressed: {
    backgroundColor: '#f8fafc',
  },
  navLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: '#94a3b8',
    letterSpacing: 0.1,
  },
  navLabelActive: {
    fontSize: 10,
    fontWeight: '800',
    color: '#2563eb',
    letterSpacing: 0.1,
  },

  // ── FAB — fixed 72px wide so it doesn't flex ──────────────────────────────
  fabWrapper: {
    width: 72,
    alignItems: 'center',
    justifyContent: 'center',
    // Lifts the FAB above the bar
    marginTop: -24,
  },
  fabOuter: {
    borderRadius: 30,
    borderWidth: 4,
    borderColor: '#ffffff',
    shadowColor: '#2563eb',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.38,
    shadowRadius: 14,
    elevation: 14,
  },
  fab: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fabPressed: {
    transform: [{ scale: 0.91 }],
    shadowOpacity: 0.18,
  },
});
