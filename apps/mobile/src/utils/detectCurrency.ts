// A real smart default, not the kind flagged and rejected in
// docs/architecture/expensio-ui-port-plan.md's onboarding discussion: this doesn't fake
// progress or manufacture urgency, it just saves a genuinely unnecessary tap for the
// common case by reading the device's own locale (Hermes has adequate Intl support for
// this -- already relied on elsewhere, e.g. ActivityLogScreen.tsx's toLocaleString). Still
// fully overridable in the UI; never silently assumed.
const REGION_CURRENCY: Record<string, string> = {
  IN: 'INR',
  US: 'USD',
  GB: 'GBP',
  AU: 'AUD',
  CA: 'CAD',
  JP: 'JPY',
  SG: 'SGD',
  AE: 'AED',
  DE: 'EUR',
  FR: 'EUR',
  ES: 'EUR',
  IT: 'EUR',
  NL: 'EUR',
};

export function detectCurrency(): string {
  try {
    const locale = Intl.DateTimeFormat().resolvedOptions().locale;
    const region = new Intl.Locale(locale).region;
    if (region && REGION_CURRENCY[region]) return REGION_CURRENCY[region];
  } catch {
    // Intl.Locale or region resolution unavailable — fall through to the default below
    // rather than let a rare locale-parsing failure block trip creation entirely.
  }
  return 'INR';
}
