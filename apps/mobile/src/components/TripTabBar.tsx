import { Pressable, Text, View } from 'react-native';
import { ArrowLeftRight, Home, List, Plus, Settings } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export type TripTab = 'home' | 'expenses' | 'settle' | 'settings';

const NAV_ITEMS: Array<{ key: TripTab; label: string; Icon: typeof Home }> = [
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
  const bottomPadding = Math.max(insets.bottom, 10);

  return (
    <View
      style={{ paddingBottom: bottomPadding }}
      className="absolute bottom-0 left-0 right-0 bg-white border-t border-slate-200/80 shadow-2xl z-40"
    >
      <View className="flex-row items-center justify-around px-3 h-16">
        <NavItem item={NAV_ITEMS[0]} active={active === NAV_ITEMS[0].key} onPress={() => onChange(NAV_ITEMS[0].key)} />
        <NavItem item={NAV_ITEMS[1]} active={active === NAV_ITEMS[1].key} onPress={() => onChange(NAV_ITEMS[1].key)} />

        {/* Center Add Expense Action Button */}
        <View className="items-center justify-center -mt-6">
          <Pressable
            onPress={onAddExpense}
            className="w-14 h-14 bg-blue-600 rounded-full shadow-lg shadow-blue-500/40 items-center justify-center border-4 border-white active:scale-95"
            style={{ elevation: 8 }}
          >
            <Plus size={26} color="#ffffff" strokeWidth={2.5} />
          </Pressable>
        </View>

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
    <Pressable onPress={onPress} className="items-center justify-center gap-1 py-1.5 px-3 rounded-2xl active:bg-slate-50">
      <View className={`p-1.5 rounded-xl ${active ? 'bg-blue-50' : 'bg-transparent'}`}>
        <item.Icon size={20} color={color} strokeWidth={active ? 2.5 : 2} />
      </View>
      <Text className={`text-[10px] font-bold tracking-tight ${active ? 'text-blue-600 font-black' : 'text-slate-500'}`}>
        {item.label}
      </Text>
    </Pressable>
  );
}
