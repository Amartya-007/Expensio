// Expo inlines any EXPO_PUBLIC_* variable from .env into process.env at build
// time — no extra package needed (stable since Expo SDK 49). See
// docs/architecture/expensio-react-native-setup.md for what goes in .env.
const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const powersyncUrl = process.env.EXPO_PUBLIC_POWERSYNC_URL;
const apiUrl = process.env.EXPO_PUBLIC_API_URL;

if (!supabaseUrl || !supabaseAnonKey || !powersyncUrl) {
  throw new Error(
    'Missing EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY / EXPO_PUBLIC_POWERSYNC_URL — ' +
      'copy .env.example to .env and fill them in, then restart the Metro bundler (env vars are read at build time).'
  );
}

export const env = { supabaseUrl, supabaseAnonKey, powersyncUrl, apiUrl };
