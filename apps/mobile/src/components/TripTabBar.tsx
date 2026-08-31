import { Pressable, Text, View } from 'react-native';
import { ArrowLeftRight, Home, List, Plus, Settings } from 'lucide-react-native';

export type TripTab = 'home' | 'expenses' | 'settle' | 'settings';

const NAV_ITEMS: Array<{ key: TripTab; label: string; Icon: typeof Home }> = [
  { key: 'home', label: 'Home', Icon: Home },
  { key: 'expenses', label: 'Expenses', Icon: List },
  { key: 'settle', label: 'Settle', Icon: ArrowLeftRight },
  { key: 'settings', label: 'Settings', Icon: Settings },
];

// Ported from tripspend/src/components/BottomNav.tsx -- same 4 tabs in the same order
// with the same raised center FAB between Expenses and Settle. `fixed bottom-0` +
// `env(safe-area-inset-bottom)` (web/CSS) becomes `absolute` positioning from the parent
// plus RN's own SafeAreaView/insets handling one level up in the navigation shell; the
// active-tab underline dot and hover states have no RN equivalent and are dropped, same
// as everywhere else in this port (see global.css's header comment).
export default function TripTabBar({
  active,
  onChange,
  onAddExpense,
}: {
  active: TripTab;
  onChange: (tab: TripTab) => void;
  onAddExpense: () => void;
}) {
  return (
    <View className="absolute bottom-0 left-0 right-0 bg-white/95 border-t border-slate-200 shadow-xl">
      <View className="flex-row items-center justify-around px-2 h-16">
        <NavItem item={NAV_ITEMS[0]} active={active === NAV_ITEMS[0].key} onPress={() => onChange(NAV_ITEMS[0].key)} />
        <NavItem item={NAV_ITEMS[1]} active={active === NAV_ITEMS[1].key} onPress={() => onChange(NAV_ITEMS[1].key)} />

        <Pressable
          onPress={onAddExpense}
          className="w-14 h-14 bg-blue-600 rounded-full shadow-xl items-center justify-center border-4 border-white -mt-4 active:scale-95"
        >
          <Plus size={22} color="#fff" strokeWidth={2.5} />
        </Pressable>

        <NavItem item={NAV_ITEMS[2]} active={active === NAV_ITEMS[2].key} onPress={() => onChange(NAV_ITEMS[2].key)} />
        <NavItem item={NAV_ITEMS[3]} active={active === NAV_ITEMS[3].key} onPress={() => onChange(NAV_ITEMS[3].key)} />
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
  const color = active ? '#2563eb' : '#64748b';
  return (
    <Pressable onPress={onPress} className="items-center justify-center gap-1 rounded-xl py-2 px-3">
      <item.Icon size={20} color={color} />
      <Text className={`text-[9px] font-bold uppercase tracking-wide ${active ? 'text-blue-600' : 'text-slate-500'}`}>
        {item.label}
      </Text>
    </Pressable>
  );
}
