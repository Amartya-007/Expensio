import './global.css';
import { useEffect, useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
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
        if (!cancelled) setError(String(err));
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

  if (!ready || !fontsLoaded) {
    return (
      <SafeAreaView style={styles.centered}>
        <Text style={styles.status}>{fontsLoaded ? status : 'loading…'}</Text>
        {error && <Text style={styles.error}>{error}</Text>}
      </SafeAreaView>
    );
  }

  // GestureHandlerRootView: required at the app root by react-native-gesture-handler,
  // a peer dependency of @react-navigation/native-stack. SafeAreaProvider: what
  // react-native-safe-area-context (also a navigation peer dependency) expects wrapping
  // the app, replacing the plain react-native SafeAreaView the loading state above still
  // uses (that one doesn't need the provider, so left as-is).
  return (
    <GestureHandlerRootView style={styles.flex}>
      <SafeAreaProvider>
        <StatusBar style="auto" />
        <NavigationContainer>
          <RootNavigator />
        </NavigationContainer>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: '#fff' },
  centered: { flex: 1, backgroundColor: '#fff', justifyContent: 'center', alignItems: 'center' },
  status: { color: '#666' },
  error: { color: '#b00020', marginTop: 8, paddingHorizontal: 20, textAlign: 'center' },
});
