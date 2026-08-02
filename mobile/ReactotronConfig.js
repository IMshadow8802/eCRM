// Reactotron — dev-only inspector. Its main job here is watching API calls:
// every request/response to the CRM backend shows up in the Reactotron desktop
// app, which is the fastest way to catch a payload that drifted from what the
// controller expects.
//
// Only ever reached from index.js inside an `if (__DEV__)` require, so Metro
// drops this whole module (and both reactotron packages) from release bundles.
// That is why they can stay devDependencies.
import AsyncStorage from "@react-native-async-storage/async-storage";
import Reactotron from "reactotron-react-native";
import { reactotronReactQuery } from "reactotron-react-query";

import { queryClient } from "./src/api/queryClient";

const reactotron = Reactotron.setAsyncStorageHandler(AsyncStorage)
  .configure({ name: "Nexus CRM Mobile" })
  .useReactNative({
    networking: {
      // Metro's own chatter would drown out the API calls we care about.
      ignoreUrls: /symbolicate|logs|generate_204/,
    },
  })
  .use(reactotronReactQuery(queryClient))
  .connect();

reactotron.clear();
console.tron = reactotron;

export default reactotron;
