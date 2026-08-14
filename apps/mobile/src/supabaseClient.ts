import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { env } from './env';

// React Native has no URL bar to catch an OAuth redirect in, and needs an
// explicit storage adapter for session persistence — AsyncStorage here,
// vs. the browser's own localStorage that the web/Capacitor client used.
//
// Spike-only simplification: expensio-onboarding-auth.md §8 specifies
// expo-secure-store (Keychain/Keystore) for the real app, same tier as the
// refresh token deserves. Plain AsyncStorage is fine for this throwaway
// anonymous-session spike — same "test sync, not security" scope as
// spike_items' wide-open RLS policy — but swap it in before any real auth
// flow (phone OTP, Google) is built on top of this.
export const supabase = createClient(env.supabaseUrl, env.supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
