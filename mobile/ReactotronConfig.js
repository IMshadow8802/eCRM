// Reactotron — dev-only API inspector. Every request/response to the CRM
// backend shows up in the Reactotron desktop app, which is the fastest way to
// catch a payload that drifted from what the controller expects.
//
// OPT-IN, and defensive. Two reasons:
//
//  1. It runs before anything else in index.js, so a throw in here surfaces as
//     "[runtime not ready]: TypeError: undefined is not a function" with no
//     usable stack — indistinguishable from a real app bug. It must never be
//     able to take the app down.
//  2. It patches global XMLHttpRequest and reaches into RN internals, which is
//     exactly the kind of code that breaks across a React Native major.
//
// Enable by putting this in mobile/.env.local:
//   EXPO_PUBLIC_REACTOTRON=1
// then restart Metro with --clear.
export function startReactotron() {
  if (!__DEV__ || process.env.EXPO_PUBLIC_REACTOTRON !== "1") return;

  try {
    const AsyncStorage =
      require("@react-native-async-storage/async-storage").default;
    const Reactotron = require("reactotron-react-native").default;
    const {
      reactotronReactQuery,
      QueryClientManager,
    } = require("reactotron-react-query");
    const { queryClient } = require("./src/api/queryClient");

    // reactotronReactQuery takes a QueryClientManager, NOT a QueryClient. It
    // calls .subscribe() on whatever it is handed, and QueryClient has no such
    // method — passing the client directly throws
    // "TypeError: undefined is not a function" at module init, which surfaces
    // as "[runtime not ready]" with no usable stack.
    const queryClientManager = new QueryClientManager({ queryClient });

    const reactotron = Reactotron.setAsyncStorageHandler(AsyncStorage)
      .configure({ name: "Nexus CRM Mobile" })
      .useReactNative({
        networking: {
          // Metro's own chatter would drown out the API calls we care about.
          ignoreUrls: /symbolicate|logs|generate_204/,
        },
      })
      .use(reactotronReactQuery(queryClientManager))
      .connect();

    reactotron.clear();
    console.tron = reactotron;
  } catch (err) {
    console.warn(
      "[reactotron] failed to start; continuing without it:",
      err?.message ?? err,
    );
  }
}
