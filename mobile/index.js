import { registerRootComponent } from 'expo';

import { startReactotron } from './ReactotronConfig';
import App from './App';

// No-op unless EXPO_PUBLIC_REACTOTRON=1. Runs before registerRootComponent so
// XHR is patched before the first API call, and it swallows its own errors —
// a dev tool must never be able to stop the app booting.
startReactotron();

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
