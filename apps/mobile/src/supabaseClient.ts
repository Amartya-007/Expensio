import * as SecureStore from 'expo-secure-store';
import { createClient } from '@supabase/supabase-js';
import { env } from './env';

// Supabase's React Native client needs an explicit async storage adapter. Keep
// the access token and refresh token in Keychain/Keystore rather than the
// unencrypted app preferences used by AsyncStorage. The session is still
// short-lived and revocable server-side; this adapter only protects local
// persistence at rest.
const secureStorage = {
  getItem: (key: string) => SecureStore.getItemAsync(key),
  setItem: (key: string, value: string) =>
    SecureStore.setItemAsync(key, value, {
      keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
    }),
  removeItem: (key: string) => SecureStore.deleteItemAsync(key),
};

export const supabase = createClient(env.supabaseUrl, env.supabaseAnonKey, {
  auth: {
    storage: secureStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
