import { registerRootComponent } from 'expo';

import App from './App';

// Dev-only network/query inspector. `require` inside the guard rather than a
// top-level import is what lets Metro dead-code-eliminate Reactotron out of
// release bundles — __DEV__ inlines to false there, so neither this call nor
// the packages it pulls in reach production, which is why they stay
// devDependencies. It runs before registerRootComponent, so XHR is patched
// before anything mounts and before the first API call fires.
if (__DEV__) {
  require('./ReactotronConfig');
}

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
