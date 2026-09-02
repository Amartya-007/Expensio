import './global.css';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
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

export default function App() {
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState('starting…');
  const [error, setError] = useState<string | null>(null);
  const [fontsLoaded] = useFonts({ Inter_400Regular, Inter_600SemiBold, Inter_700Bold, Inter_900Black });

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

        // Replay anything queued from a previous offline session, now that we have a
        // connection. Not automatic on reconnect (no NetInfo listener installed — see
        // rpc.ts) — this covers app-launch; TripsListScreen's pull-to-refresh covers
        // "came back online while still in the app."
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

  // Always render the full provider tree — NavigationContainer must wrap everything
  // because NativeWind's react-native-css-interop globally patches RN components and
  // its renderComponent accesses NavigationStateContext. Rendering any NativeWind-patched
  // component (View, Text, SafeAreaView, etc.) OUTSIDE NavigationContainer causes the
  // "Couldn't find a navigation context" crash.
  return (
    <SafeAreaProvider>
      <GestureHandlerRootView style={styles.flex}>
        <StatusBar style="auto" />
        <NavigationContainer>
          <RootNavigator
            ready={ready && fontsLoaded}
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
