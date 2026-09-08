import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ArrowLeftRight, Home, List, Plus, Settings } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export type TripTab = 'home' | 'expenses' | 'settle' | 'settings';

// Five equal-flex slots in one row: Home, Expenses, Add, Settle, Settings. Giving
// every slot -- including Add -- the same flex: 1 width is what guarantees genuine
// even horizontal distribution; it doesn't depend on how any one slot's *contents*
// are drawn. Add's circle is then visually raised above the row via a negative
// margin on just the circle itself (not the slot), with its own shadow for a real
// elevated/floating look -- that negative margin shifts the icon upward without
// changing the slot's width or its participation in the row's flex layout, so it
// can't pull the other slots off-center the way a separate fixed-width wrapper did
// in an earlier version of this file.
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

        <View style={styles.navItem}>
          <Pressable
            onPress={onAddExpense}
            style={({ pressed }) => [styles.addIconWrap, pressed && styles.addIconWrapPressed]}
            accessibilityRole="button"
            accessibilityLabel="Add expense"
            hitSlop={8}
          >
            <Plus size={24} color="#ffffff" strokeWidth={2.5} />
          </Pressable>
        </View>

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
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: '#2563eb',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: -26,
    borderWidth: 4,
    borderColor: '#ffffff',
    // The actual "elevating" effect: a real shadow directly under the circle,
    // separate from the bar's own shadow, so it reads as a raised object sitting
    // on top of the bar rather than just a bigger flat icon.
    shadowColor: '#2563eb',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 10,
  },
  addIconWrapPressed: {
    backgroundColor: '#1d4ed8',
    transform: [{ scale: 0.96 }],
  },
});
