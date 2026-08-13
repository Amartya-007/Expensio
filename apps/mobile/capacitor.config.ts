import type { CapacitorConfig } from '@capacitor/cli';

// appId is Android-first per docs/architecture/expensio-pre-code-checklist.md
// ("Still genuinely open" — Apple Sign-In / iOS is deferred, not decided
// against). Change this before any real release — reverse-DNS, matches the
// eventual Play Console package name.
const config: CapacitorConfig = {
  appId: 'app.expensio.mobile',
  appName: 'Expensio',
  webDir: 'dist',
};

export default config;
