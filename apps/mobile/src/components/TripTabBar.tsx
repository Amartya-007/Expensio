import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ArrowLeftRight, Home, List, Plus, Settings } from 'lucide-react-native';
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
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel="Add expense"
          >
            <View style={styles.fab}>
              <Plus size={26} color="#ffffff" strokeWidth={2.5} />
            </View>
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
    borderTopColor: '#e2e8f0',
    shadowColor: '#0b1c30',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.05,
    shadowRadius: 12,
    elevation: 8,
    zIndex: 40,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 64,
    paddingHorizontal: 8,
  },
  navItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    paddingVertical: 6,
    paddingHorizontal: 4,
    borderRadius: 12,
    minWidth: 0,
  },
  navItemActive: {
    backgroundColor: '#eff4ff',
  },
  navItemPressed: {
    backgroundColor: '#f8f9ff',
  },
  navLabel: {
    fontSize: 11,
    fontWeight: '500',
    fontFamily: 'Inter_400Regular',
    color: '#737686',
    letterSpacing: 0.01,
  },
  navLabelActive: {
    fontSize: 11,
    fontWeight: '700',
    fontFamily: 'Inter_600SemiBold',
    color: '#2563eb',
    letterSpacing: 0.01,
  },
  fabWrapper: {
    width: 68,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: -22,
  },
  fabOuter: {
    borderRadius: 28,
    borderWidth: 3,
    borderColor: '#ffffff',
    shadowColor: '#2563eb',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.28,
    shadowRadius: 10,
    elevation: 8,
  },
  fab: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#2563eb',
    alignItems: 'center',
    justifyContent: 'center',
  },
  fabPressed: {
    transform: [{ scale: 0.94 }],
    opacity: 0.9,
  },
});
