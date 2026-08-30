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

export function colorFor(id: string) {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}
