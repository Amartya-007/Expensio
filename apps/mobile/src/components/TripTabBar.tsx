import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ArrowLeftRight, Home, List, Plus, Settings } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export type TripTab = 'home' | 'expenses' | 'settle' | 'settings';

// Five equal-flex items in one row: Home, Expenses, Add, Settle, Settings. "Add" is
// an action rather than a navigable tab, so it's visually distinguished with a filled
// accent circle behind its icon -- but it sits at the exact same height and baseline
// as the other four (no raised/floating FAB, no negative margins). That's deliberate:
// a floating center button is a common pattern, but it puts that item at a different
// height than the rest of the bar, which reads as misaligned rather than intentional
// once you're looking for it.
const TABS: Array<{ key: TripTab; label: string; Icon: typeof Home }> = [
  { key: 'home', label: 'Home', Icon: Home },
  { key: 'expenses', label: 'Expenses', Icon: List },
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
    <View style={[styles.container, { paddingBottom: Math.max(insets.bottom, 20) }]}>
      <View style={styles.row}>
        <NavItem item={TABS[0]} active={active === TABS[0].key} onPress={() => onChange(TABS[0].key)} />
        <NavItem item={TABS[1]} active={active === TABS[1].key} onPress={() => onChange(TABS[1].key)} />

        <Pressable
          onPress={onAddExpense}
          style={({ pressed }) => [styles.navItem, pressed && styles.navItemPressed]}
          accessibilityRole="button"
          accessibilityLabel="Add expense"
        >
          <View style={styles.addIconWrap}>
            <Plus size={20} color="#ffffff" strokeWidth={2.5} />
          </View>
          <Text style={styles.navLabel}>Add</Text>
        </Pressable>

        <NavItem item={TABS[2]} active={active === TABS[2].key} onPress={() => onChange(TABS[2].key)} />
        <NavItem item={TABS[3]} active={active === TABS[3].key} onPress={() => onChange(TABS[3].key)} />
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
      accessibilityRole="button"
      accessibilityLabel={item.label}
      accessibilityState={{ selected: active }}
    >
      <item.Icon
        size={20}
        color={active ? '#2563eb' : '#94a3b8'}
        strokeWidth={active ? 2.4 : 1.8}
      />
      <Text style={[styles.navLabel, active && styles.navLabelActive]} numberOfLines={1}>
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
    shadowOpacity: 0.06,
    shadowRadius: 12,
    elevation: 8,
    zIndex: 40,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'stretch',
    height: 62,
    paddingHorizontal: 6,
    paddingTop: 6,
  },
  // Every one of the 5 items shares this exact shape: same flex, same internal
  // layout, same padding. Nothing here differs between "Add" and a regular tab --
  // only the icon/label colors and the accent-circle wrapper around Add's icon do.
  navItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    borderRadius: 14,
    marginHorizontal: 2,
  },
  navItemActive: {
    backgroundColor: '#eff4ff',
  },
  navItemPressed: {
    backgroundColor: '#f8fafc',
  },
  navLabel: {
    fontSize: 11,
    fontWeight: '500',
    color: '#64748b',
    letterSpacing: 0.1,
  },
  navLabelActive: {
    fontWeight: '700',
    color: '#2563eb',
  },
  addIconWrap: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#2563eb',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
