import './global.css';
import { useEffect, useRef, useState } from 'react';
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

// ─── Why NavigationContainer is always mounted ────────────────────────────────
// NativeWind's jsxImportSource transform wraps every JSX element at compile time.
// After global.css is imported the wrapped primitives access NavigationStateContext
// on every render. NavigationContainer must therefore always be mounted before any
// component renders — no conditional branch around it, ever.
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

  // Track whether we have ever connected so React 18 Strict Mode's double-invoke
  // of effects doesn't open two PowerSync connections or call disconnect on a
  // connection that was already cleaned up.
  const connectedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    async function start() {
      // Guard against Strict Mode double-fire.
      if (connectedRef.current) return;
      connectedRef.current = true;

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

        // Mark ready immediately — don't let a failed flush block the app.
        setReady(true);
        setStatus('connected');

        // Replay queued offline actions best-effort; errors are logged but do
        // not surface to the user since the app is already usable at this point.
        flushPendingActions().catch((err) =>
          console.warn('[App] flushPendingActions failed on startup:', err)
        );
      } catch (err) {
        if (!cancelled) setError(formatError(err));
      }
    }

    start();
    return () => {
      cancelled = true;
      // Only disconnect if we actually connected — avoids a Strict Mode
      // double-disconnect that leaves the second mount with a dead db.
      if (connectedRef.current) {
        connectedRef.current = false;
        db.disconnect();
      }
    };
  }, []);

  useEffect(() => {
    if (!ready) return;

    // Initialise wasOffline from the actual current network state so that the
    // first NetInfo event (which may fire immediately with isConnected: true)
    // is handled correctly even when the app started offline.
    let wasOffline: boolean | null = null;

    const unsubscribe = NetInfo.addEventListener((state) => {
      const online = state.isConnected === true && state.isInternetReachable !== false;

      // On the very first event, just record the baseline.
      if (wasOffline === null) {
        wasOffline = !online;
        return;
      }

      if (online && wasOffline) {
        void flushPendingActions();
      }
      wasOffline = !online;
    });

    return unsubscribe;
  }, [ready]);

  const isReady = ready && fontsLoaded;

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
