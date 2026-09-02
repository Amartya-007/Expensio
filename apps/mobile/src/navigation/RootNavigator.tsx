import { ActivityIndicator, Text, View } from 'react-native';
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

// Replaces App.tsx's old hand-rolled `Screen` state union (see git history) with real
// React Navigation -- the comment that used to sit on that type said to swap it in
// "whenever screen count or transition needs... outgrow it"; porting TripSpend's UI is
// that moment, since TripSpend's own BottomNav.tsx assumes a real navigator underneath it.
//
// TripDetail now renders the persistent Home/Expenses/Settle/Settings tab bar (see
// TripDetailScreen.tsx's own header comment for the full history of why this was
// blocked, then unblocked once the budget schema landed) rather than the old in-page
// Expenses/Log/Members/Settle tab row. Members and Activity Log moved out of that in-page
// row into their own routes here (reached from the new Settings tab), since TripSpend's
// BottomNav.tsx has no tab for either of them.
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
      onBack={() => navigation.navigate('Trips')}
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
  return <AddExpenseScreen tripId={tripId} currency={currency} onDone={() => navigation.goBack()} onCancel={() => navigation.goBack()} />;
}

function AddParticipantRoute({ navigation, route }: NativeStackScreenProps<RootStackParamList, 'AddParticipant'>) {
  const { tripId } = route.params;
  return <AddParticipantScreen tripId={tripId} onDone={() => navigation.goBack()} onCancel={() => navigation.goBack()} />;
}

function ExpenseDetailRoute({ navigation, route }: NativeStackScreenProps<RootStackParamList, 'ExpenseDetail'>) {
  return <ExpenseDetailScreen expenseId={route.params.expenseId} onBack={() => navigation.goBack()} />;
}

function VerifyPhoneRoute({ navigation }: NativeStackScreenProps<RootStackParamList, 'VerifyPhone'>) {
  return <PhoneVerificationScreen onDone={() => navigation.goBack()} onCancel={() => navigation.goBack()} />;
}

function InviteRoute({ navigation, route }: NativeStackScreenProps<RootStackParamList, 'Invite'>) {
  return (
    <InviteScreen
      tripId={route.params.tripId}
      onRequireVerification={() => navigation.navigate('VerifyPhone')}
      onJoined={() => navigation.navigate('Trips')}
      onDone={() => navigation.goBack()}
    />
  );
}

function RecurringRoute({ navigation, route }: NativeStackScreenProps<RootStackParamList, 'Recurring'>) {
  return <RecurringScreen tripId={route.params.tripId} currency={route.params.currency} onBack={() => navigation.goBack()} />;
}

export default function RootNavigator({
  ready = true,
  status = 'loading…',
  error = null,
}: {
  ready?: boolean;
  status?: string;
  error?: string | null;
}) {
  if (!ready) {
    return (
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        <Stack.Screen name="Loading" options={{ headerShown: false }}>
          {() => (
            <View className="flex-1 bg-white items-center justify-center p-6">
              <ActivityIndicator size="large" color="#2563eb" />
              <Text className="text-sm font-semibold text-slate-500 mt-4">{status}</Text>
              {error && (
                <View className="mt-4 p-4 rounded-2xl bg-red-50 border border-red-200 max-w-xs">
                  <Text className="text-xs font-bold text-red-700 text-center">{error}</Text>
                </View>
              )}
            </View>
          )}
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
