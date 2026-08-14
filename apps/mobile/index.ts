// Required for PowerSync's watched queries (Async Iterator response format)
// — must be imported before anything that uses PowerSync. See
// docs/architecture/expensio-react-native-setup.md.
import '@azure/core-asynciterator-polyfill';

import { registerRootComponent } from 'expo';

import App from './App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
