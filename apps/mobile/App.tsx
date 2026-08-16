import { useEffect, useState } from 'react';
import { SafeAreaView, StyleSheet, Text } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { supabase } from './src/supabaseClient';
import { db, connectPowerSync } from './src/powersync/db';
import { flushPendingActions } from './src/rpc';
import TripsListScreen from './src/screens/TripsListScreen';
import CreateTripScreen from './src/screens/CreateTripScreen';
import TripDetailScreen from './src/screens/TripDetailScreen';
import AddExpenseScreen from './src/screens/AddExpenseScreen';
import AddParticipantScreen from './src/screens/AddParticipantScreen';

// No navigation library — just enough state to move between five screens without
// adding React Navigation's setup surface to what's already a lot of new plumbing
// (PowerSync, RPC-vs-CRUD-queue, offline queueing) for one pass. Swap this for real
// navigation whenever screen count or transition needs (deep links, native back gestures
// beyond Android's hardware back) outgrow it — nothing about the screens themselves
// assumes this particular router shape.
type Screen =
  | { name: 'trips' }
  | { name: 'createTrip' }
  | { name: 'tripDetail'; tripId: string; currency: string }
  | { name: 'addExpense'; tripId: string; currency: string }
  | { name: 'addParticipant'; tripId: string; currency: string };

export default function App() {
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState('starting…');
  const [error, setError] = useState<string | null>(null);
  const [screen, setScreen] = useState<Screen>({ name: 'trips' });

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

  if (!ready) {
    return (
      <SafeAreaView style={styles.centered}>
        <Text style={styles.status}>{status}</Text>
        {error && <Text style={styles.error}>{error}</Text>}
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.flex}>
      <StatusBar style="auto" />
      {screen.name === 'trips' && (
        <TripsListScreen
          onOpenTrip={(tripId, currency) => setScreen({ name: 'tripDetail', tripId, currency })}
          onCreateTrip={() => setScreen({ name: 'createTrip' })}
        />
      )}
      {screen.name === 'createTrip' && (
        <CreateTripScreen
          onCreated={(tripId, currency) =>
            setScreen(tripId ? { name: 'tripDetail', tripId, currency } : { name: 'trips' })
          }
          onCancel={() => setScreen({ name: 'trips' })}
        />
      )}
      {screen.name === 'tripDetail' && (
        <TripDetailScreen
          tripId={screen.tripId}
          onBack={() => setScreen({ name: 'trips' })}
          onAddExpense={() => setScreen({ name: 'addExpense', tripId: screen.tripId, currency: screen.currency })}
          onAddParticipant={() => setScreen({ name: 'addParticipant', tripId: screen.tripId, currency: screen.currency })}
        />
      )}
      {screen.name === 'addExpense' && (
        <AddExpenseScreen
          tripId={screen.tripId}
          currency={screen.currency}
          onDone={() => setScreen({ name: 'tripDetail', tripId: screen.tripId, currency: screen.currency })}
          onCancel={() => setScreen({ name: 'tripDetail', tripId: screen.tripId, currency: screen.currency })}
        />
      )}
      {screen.name === 'addParticipant' && (
        <AddParticipantScreen
          tripId={screen.tripId}
          onDone={() => setScreen({ name: 'tripDetail', tripId: screen.tripId, currency: screen.currency })}
          onCancel={() => setScreen({ name: 'tripDetail', tripId: screen.tripId, currency: screen.currency })}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: '#fff' },
  centered: { flex: 1, backgroundColor: '#fff', justifyContent: 'center', alignItems: 'center' },
  status: { color: '#666' },
  error: { color: '#b00020', marginTop: 8, paddingHorizontal: 20, textAlign: 'center' },
});
