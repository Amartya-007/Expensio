import { StyleSheet, ActivityIndicator, View, Text } from 'react-native';
import { createNativeStackNavigator, NativeStackScreenProps } from '@react-navigation/native-stack';
import TripsListScreen from '../screens/TripsListScreen';
import CreateTripScreen from '../screens/CreateTripScreen';
import TripDetailScreen from '../screens/TripDetailScreen';
import AddExpenseScreen from '../screens/AddExpenseScreen';
import AddParticipantScreen from '../screens/AddParticipantScreen';
import ExpenseDetailScreen from '../screens/ExpenseDetailScreen';
import PhoneVerificationScreen from '../screens/PhoneVerificationScreen';
import InviteScreen from '../screens/InviteScreen';
import RecurringScreen from '../screens/RecurringScreen';
import MembersScreen from '../screens/MembersScreen';
import ActivityLogScreen from '../screens/ActivityLogScreen';

// ─── Why the loading screen lives here, not in App.tsx ───────────────────────
//
// NativeWind patches every RN primitive at module-load time (when global.css is
// imported). After that, every View/Text/Pressable reads from NavigationStateContext
// on render. So ANY component — even a plain StyleSheet View with no className —
// will crash with "Couldn't find a navigation context" if it renders outside a
// mounted NavigationContainer.
//
// The invariant: NavigationContainer must be mounted unconditionally and nothing
// may render outside it. The loading/error states are therefore a Stack.Screen
// inside this navigator, not a conditional branch in App.tsx.
// ─────────────────────────────────────────────────────────────────────────────

export type RootStackParamList = {
  Loading: undefined;
  Trips: undefined;
  CreateTrip: undefined;
  TripDetail: { tripId: string; currency: string };
  AddExpense: { tripId: string; currency: string };
  AddParticipant: { tripId: string; currency: string };
  ExpenseDetail: { expenseId: string; tripId: string; currency: string };
  VerifyPhone: undefined;
  Invite: { tripId: string };
  Recurring: { tripId: string; currency: string };
  Members: { tripId: string; currency: string };
  ActivityLog: { tripId: string };
};

const Stack = createNativeStackNavigator<RootStackParamList>();

// ── Loading screen — no hooks that touch navigation context, no className ──
function LoadingScreen({
  status,
  error,
}: {
  status: string;
  error: string | null;
}) {
  return (
    <View style={ls.shell}>
      <View style={ls.card}>
        <View style={ls.iconRing}>
          <View style={ls.iconDot} />
        </View>
        <Text style={ls.title}>Expensio</Text>
        {error ? (
          <>
            <Text style={ls.errorLabel}>Something went wrong</Text>
            <View style={ls.errorBox}>
              <Text style={ls.errorText}>{error}</Text>
            </View>
          </>
        ) : (
          <>
            <ActivityIndicator size="small" color="#2563eb" style={ls.spinner} />
            <Text style={ls.statusText}>{status}</Text>
          </>
        )}
      </View>
    </View>
  );
}

const ls = StyleSheet.create({
  shell: {
    flex: 1,
    backgroundColor: '#f8fafc',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  card: { alignItems: 'center', gap: 10 },
  iconRing: {
    width: 72,
    height: 72,
    borderRadius: 24,
    backgroundColor: '#eff6ff',
    borderWidth: 1,
    borderColor: '#bfdbfe',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  iconDot: {
    width: 28,
    height: 28,
    borderRadius: 10,
    backgroundColor: '#2563eb',
  },
  title: {
    fontSize: 28,
    fontWeight: '900',
    color: '#0f172a',
    letterSpacing: -0.5,
  },
  spinner: { marginTop: 4 },
  statusText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#94a3b8',
  },
  errorLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: '#be123c',
    marginTop: 4,
  },
  errorBox: {
    backgroundColor: '#fff1f2',
    borderWidth: 1,
    borderColor: '#fecdd3',
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 12,
    maxWidth: 280,
  },
  errorText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#be123c',
    textAlign: 'center',
  },
});

// ── Screen wrappers ──────────────────────────────────────────────────────────

function TripsRoute({ navigation }: NativeStackScreenProps<RootStackParamList, 'Trips'>) {
  return (
    <TripsListScreen
      onOpenTrip={(tripId, currency) => navigation.navigate('TripDetail', { tripId, currency })}
      onCreateTrip={() => navigation.navigate('CreateTrip')}
    />
  );
}

function CreateTripRoute({ navigation }: NativeStackScreenProps<RootStackParamList, 'CreateTrip'>) {
  return (
    <CreateTripScreen
      onCreated={(tripId, currency) =>
        tripId ? navigation.replace('TripDetail', { tripId, currency }) : navigation.goBack()
      }
      onCancel={() => navigation.goBack()}
    />
  );
}

function TripDetailRoute({ navigation, route }: NativeStackScreenProps<RootStackParamList, 'TripDetail'>) {
  const { tripId, currency } = route.params;
  return (
    <TripDetailScreen
      tripId={tripId}
      onBack={() => navigation.goBack()}
      onAddExpense={() => navigation.navigate('AddExpense', { tripId, currency })}
      onOpenExpense={(expenseId) => navigation.navigate('ExpenseDetail', { expenseId, tripId, currency })}
      onOpenMembers={() => navigation.navigate('Members', { tripId, currency })}
      onOpenActivityLog={() => navigation.navigate('ActivityLog', { tripId })}
      onOpenRecurring={() => navigation.navigate('Recurring', { tripId, currency })}
    />
  );
}

function MembersRoute({ navigation, route }: NativeStackScreenProps<RootStackParamList, 'Members'>) {
  const { tripId, currency } = route.params;
  return (
    <MembersScreen
      tripId={tripId}
      onBack={() => navigation.goBack()}
      onAddParticipant={() => navigation.navigate('AddParticipant', { tripId, currency })}
      onOpenInvite={() => navigation.navigate('Invite', { tripId })}
    />
  );
}

function ActivityLogRoute({ navigation, route }: NativeStackScreenProps<RootStackParamList, 'ActivityLog'>) {
  return <ActivityLogScreen tripId={route.params.tripId} onBack={() => navigation.goBack()} />;
}

function AddExpenseRoute({ navigation, route }: NativeStackScreenProps<RootStackParamList, 'AddExpense'>) {
  const { tripId, currency } = route.params;
  return (
    <AddExpenseScreen
      tripId={tripId}
      currency={currency}
      onDone={() => navigation.goBack()}
      onCancel={() => navigation.goBack()}
    />
  );
}

function AddParticipantRoute({ navigation, route }: NativeStackScreenProps<RootStackParamList, 'AddParticipant'>) {
  const { tripId } = route.params;
  return (
    <AddParticipantScreen
      tripId={tripId}
      onDone={() => navigation.goBack()}
      onCancel={() => navigation.goBack()}
    />
  );
}

function ExpenseDetailRoute({ navigation, route }: NativeStackScreenProps<RootStackParamList, 'ExpenseDetail'>) {
  return <ExpenseDetailScreen expenseId={route.params.expenseId} onBack={() => navigation.goBack()} />;
}

function VerifyPhoneRoute({ navigation }: NativeStackScreenProps<RootStackParamList, 'VerifyPhone'>) {
  return (
    <PhoneVerificationScreen
      onDone={() => navigation.goBack()}
      onCancel={() => navigation.goBack()}
    />
  );
}

function InviteRoute({ navigation, route }: NativeStackScreenProps<RootStackParamList, 'Invite'>) {
  return (
    <InviteScreen
      tripId={route.params.tripId}
      onRequireVerification={() => navigation.navigate('VerifyPhone')}
      onJoined={(joinedTripId) => navigation.replace('TripDetail', { tripId: joinedTripId, currency: 'USD' })}
      onDone={() => navigation.goBack()}
    />
  );
}

function RecurringRoute({ navigation, route }: NativeStackScreenProps<RootStackParamList, 'Recurring'>) {
  return (
    <RecurringScreen
      tripId={route.params.tripId}
      currency={route.params.currency}
      onBack={() => navigation.goBack()}
    />
  );
}

// ── Navigator ────────────────────────────────────────────────────────────────

export default function RootNavigator({
  ready = false,
  status = 'loading…',
  error = null,
}: {
  ready?: boolean;
  status?: string;
  error?: string | null;
}) {
  if (!ready) {
    // Still inside NavigationContainer — safe to render NativeWind-patched
    // components. This Stack wraps a single loading screen so nothing tries
    // to use navigation hooks while the app is booting.
    return (
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        <Stack.Screen name="Loading">
          {() => <LoadingScreen status={status} error={error} />}
        </Stack.Screen>
      </Stack.Navigator>
    );
  }

  return (
    <Stack.Navigator screenOptions={{ headerShown: false }} initialRouteName="Trips">
      <Stack.Screen name="Trips" component={TripsRoute} />
      <Stack.Screen name="CreateTrip" component={CreateTripRoute} />
      <Stack.Screen name="TripDetail" component={TripDetailRoute} />
      <Stack.Screen name="AddExpense" component={AddExpenseRoute} />
      <Stack.Screen name="AddParticipant" component={AddParticipantRoute} />
      <Stack.Screen name="ExpenseDetail" component={ExpenseDetailRoute} />
      <Stack.Screen name="VerifyPhone" component={VerifyPhoneRoute} />
      <Stack.Screen name="Invite" component={InviteRoute} />
      <Stack.Screen name="Recurring" component={RecurringRoute} />
      <Stack.Screen name="Members" component={MembersRoute} />
      <Stack.Screen name="ActivityLog" component={ActivityLogRoute} />
    </Stack.Navigator>
  );
}
