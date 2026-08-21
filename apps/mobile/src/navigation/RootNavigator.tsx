import { createNativeStackNavigator, NativeStackScreenProps } from '@react-navigation/native-stack';
import TripsListScreen from '../screens/TripsListScreen';
import CreateTripScreen from '../screens/CreateTripScreen';
import TripDetailScreen from '../screens/TripDetailScreen';
import AddExpenseScreen from '../screens/AddExpenseScreen';
import AddParticipantScreen from '../screens/AddParticipantScreen';
import ExpenseDetailScreen from '../screens/ExpenseDetailScreen';
import PhoneVerificationScreen from '../screens/PhoneVerificationScreen';
import InviteScreen from '../screens/InviteScreen';
import SettlementScreen from '../screens/SettlementScreen';
import RecurringScreen from '../screens/RecurringScreen';

// Replaces App.tsx's old hand-rolled `Screen` state union (see git history) with real
// React Navigation -- the comment that used to sit on that type said to swap it in
// "whenever screen count or transition needs... outgrow it"; porting TripSpend's UI is
// that moment, since TripSpend's own BottomNav.tsx assumes a real navigator underneath it.
// Every route below maps 1:1 onto the old screen union -- same screens, same callback
// props, just invoked via navigation.navigate()/goBack() instead of setScreen(). No
// screen's own prop contract changed, only how it's reached.
//
// The bottom-tab shell (Home/Expenses/Settle/Settings + center FAB, mirroring TripSpend's
// BottomNav.tsx) isn't wired in yet -- see docs/architecture/expensio-ui-port-plan.md's
// "Navigation shape" section for why: three of those four tabs point at screens
// (ExpenseList/Settlement equivalents) that don't exist on the Expensio side yet. This
// stack is the foundation that shell will sit on top of once they do.
export type RootStackParamList = {
  Trips: undefined;
  CreateTrip: undefined;
  TripDetail: { tripId: string; currency: string };
  AddExpense: { tripId: string; currency: string };
  AddParticipant: { tripId: string; currency: string };
  ExpenseDetail: { expenseId: string; tripId: string; currency: string };
  VerifyPhone: undefined;
  Invite: { tripId: string };
  Settlement: { tripId: string };
  Recurring: { tripId: string; currency: string };
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
      onAddParticipant={() => navigation.navigate('AddParticipant', { tripId, currency })}
      onOpenInvite={() => navigation.navigate('Invite', { tripId })}
      onOpenSettlement={() => navigation.navigate('Settlement', { tripId })}
      onOpenRecurring={() => navigation.navigate('Recurring', { tripId, currency })}
      onOpenExpense={(expenseId) => navigation.navigate('ExpenseDetail', { expenseId, tripId, currency })}
    />
  );
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

function SettlementRoute({ navigation, route }: NativeStackScreenProps<RootStackParamList, 'Settlement'>) {
  return <SettlementScreen tripId={route.params.tripId} onBack={() => navigation.goBack()} />;
}

function RecurringRoute({ navigation, route }: NativeStackScreenProps<RootStackParamList, 'Recurring'>) {
  return <RecurringScreen tripId={route.params.tripId} currency={route.params.currency} onBack={() => navigation.goBack()} />;
}

export default function RootNavigator() {
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
      <Stack.Screen name="Settlement" component={SettlementRoute} />
      <Stack.Screen name="Recurring" component={RecurringRoute} />
    </Stack.Navigator>
  );
}
