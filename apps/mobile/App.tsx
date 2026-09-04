import './global.css';
import { useEffect, useState } from 'react';
import { StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import NetInfo from '@react-native-community/netinfo';
import {
  useFonts,
  Inter_400Regular,
  Inter_600SemiBold,
  Inter_700Bold,
  Inter_900Black,
} from '@expo-google-fonts/inter';
import { supabase } from './src/supabaseClient';
import { db, connectPowerSync } from './src/powersync/db';
import { flushPendingActions } from './src/rpc';
import { formatError } from './src/utils/errors';
import RootNavigator from './src/navigation/RootNavigator';

// ─── Root cause of the "Couldn't find a navigation context" crash ─────────────
//
// NativeWind's react-native-css-interop patches EVERY React Native primitive
// (View, Text, Pressable, ScrollView, …) at MODULE LOAD TIME when global.css is
// imported. After that patch is applied, every one of those components reads from
// NavigationStateContext on every render — even ones with no className prop and
// even ones inside plain StyleSheet views.
//
// The invariant is therefore: NavigationContainer MUST be mounted before ANY
// NativeWind-patched component is rendered, with NO exceptions. The loading
// state, error state, and everything else must live INSIDE NavigationContainer.
// Rendering anything — even a StyleSheet-only View — outside it after global.css
// has run will crash with the missing-context error.
//
// The solution: NavigationContainer is always mounted unconditionally. The
// ready/loading/error state is passed as props to RootNavigator which renders
// a static loading screen as its first stack route when not ready. That screen
// uses className-free Views backed by StyleSheet so it never causes a navigation
// hook call itself, but it IS inside NavigationContainer so the context is there.
// ─────────────────────────────────────────────────────────────────────────────

export default function App() {
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState('starting…');
  const [error, setError] = useState<string | null>(null);
  const [fontsLoaded] = useFonts({
    Inter_400Regular,
    Inter_600SemiBold,
    Inter_700Bold,
    Inter_900Black,
  });

  useEffect(() => {
    let cancelled = false;

    async function start() {
      try {
        const { data } = await supabase.auth.getSession();
        if (!data.session) {
          setStatus('signing in…');
          const { error: signInError } = await supabase.auth.signInAnonymously();
          if (signInError) throw signInError;
        }

        setStatus('connecting…');
        await connectPowerSync();
        if (cancelled) return;

        await flushPendingActions();
        setReady(true);
        setStatus('connected');
      } catch (err) {
        if (!cancelled) setError(formatError(err));
      }
    }

    start();
    return () => {
      cancelled = true;
      db.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!ready) return;
    let wasOffline = false;
    const unsubscribe = NetInfo.addEventListener((state) => {
      const online = state.isConnected === true && state.isInternetReachable !== false;
      if (online && wasOffline) void flushPendingActions();
      wasOffline = !online;
    });
    return unsubscribe;
  }, [ready]);

  const isReady = ready && fontsLoaded;

  // NavigationContainer is ALWAYS mounted — no conditional rendering around it.
  // RootNavigator receives ready/status/error and renders either a loading screen
  // (inside the stack, inside NavigationContainer) or the real app.
  return (
    <SafeAreaProvider>
      <GestureHandlerRootView style={styles.flex}>
        <StatusBar style="auto" />
        <NavigationContainer>
          <RootNavigator
            ready={isReady}
            status={fontsLoaded ? status : 'loading…'}
            error={error}
          />
        </NavigationContainer>
      </GestureHandlerRootView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: '#fff' },
});
