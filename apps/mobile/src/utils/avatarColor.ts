// Extracted from TripDetailScreen.tsx once MembersScreen.tsx needed the same
// colored-initial-badge device it already used for participant avatars there (and
// ExpenseDetailScreen/TripDetailScreen use it for paid-by avatars) -- same pattern as
// Chip.tsx being pulled out once a second screen needed it.
export const AVATAR_COLORS = [
  { bg: 'bg-blue-50', border: 'border-blue-100', text: 'text-blue-700' },
  { bg: 'bg-emerald-50', border: 'border-emerald-100', text: 'text-emerald-700' },
  { bg: 'bg-amber-50', border: 'border-amber-100', text: 'text-amber-700' },
  { bg: 'bg-rose-50', border: 'border-rose-100', text: 'text-rose-700' },
  { bg: 'bg-violet-50', border: 'border-violet-100', text: 'text-violet-700' },
];

// Raw hex equivalents for use in StyleSheet.create (NativeWind className strings can't
// be used inside StyleSheet objects).
const AVATAR_COLORS_HEX = [
  { rawBg: '#eff6ff', rawBorder: '#dbeafe', rawText: '#1d4ed8' }, // blue
  { rawBg: '#ecfdf5', rawBorder: '#d1fae5', rawText: '#065f46' }, // emerald
  { rawBg: '#fffbeb', rawBorder: '#fef3c7', rawText: '#b45309' }, // amber
  { rawBg: '#fff1f2', rawBorder: '#ffe4e6', rawText: '#be123c' }, // rose
  { rawBg: '#f5f3ff', rawBorder: '#ede9fe', rawText: '#6d28d9' }, // violet
];

export function colorFor(id: string) {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  const idx = hash % AVATAR_COLORS.length;
  return { ...AVATAR_COLORS[idx], ...AVATAR_COLORS_HEX[idx] };
}
