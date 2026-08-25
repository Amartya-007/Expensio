import { Pressable, Text } from 'react-native';

// Shared selectable-chip pattern (paid-by/category/split-type/recurrence pickers) --
// pulled out once it was needed in a second screen (RecurringScreen.tsx) rather than
// staying duplicated from where it started (AddExpenseScreen.tsx).
export default function Chip({ selected, label, onPress }: { selected: boolean; label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      className={`px-4 py-2 rounded-full border ${selected ? 'bg-blue-600 border-blue-600' : 'bg-white border-slate-200'}`}
    >
      <Text className={`text-sm font-semibold ${selected ? 'text-white' : 'text-slate-600'}`}>{label}</Text>
    </Pressable>
  );
}
