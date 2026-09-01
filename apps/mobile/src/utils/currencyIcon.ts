import { Banknote, DollarSign, Euro, IndianRupee, JapaneseYen, PoundSterling } from 'lucide-react-native';

// Both CreateTripScreen.tsx and TripSettingsScreen.tsx hardcoded an IndianRupee icon next
// to their budget field regardless of which currency was actually selected -- harmless
// when the trip really is in INR, wrong and confusing otherwise. AUD/CAD/SGD/AED have no
// dedicated lucide icon; the first three are conventionally $-denominated in practice, and
// AED falls back to a currency-agnostic Banknote rather than a misleading $ symbol.
const CURRENCY_ICONS: Record<string, typeof IndianRupee> = {
  INR: IndianRupee,
  USD: DollarSign,
  AUD: DollarSign,
  CAD: DollarSign,
  SGD: DollarSign,
  EUR: Euro,
  GBP: PoundSterling,
  JPY: JapaneseYen,
};

export function currencyIcon(currency: string | null | undefined) {
  return (currency && CURRENCY_ICONS[currency]) || Banknote;
}
