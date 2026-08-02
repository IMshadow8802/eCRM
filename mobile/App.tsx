import { useEffect } from "react";
import { AppState, type AppStateStatus, Platform, StyleSheet } from "react-native";
import { StatusBar } from "expo-status-bar";
import * as SplashScreen from "expo-splash-screen";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { QueryClientProvider, focusManager } from "@tanstack/react-query";
import { BottomSheetModalProvider } from "@gorhom/bottom-sheet";

import { queryClient } from "./src/api/queryClient";
import RootNavigator from "./src/navigation/RootNavigator";
import { useAppFonts } from "./src/theme";

SplashScreen.preventAutoHideAsync();

export default function App() {
  const fontsLoaded = useAppFonts();

  // No sockets in Phase A (spec §5.2). Freshness comes from refetching when
  // the app returns to the foreground — React Query's focusManager is built for
  // browser focus events, so on native it has to be driven from AppState.
  useEffect(() => {
    const onChange = (status: AppStateStatus) => {
      if (Platform.OS !== "web") focusManager.setFocused(status === "active");
    };
    const sub = AppState.addEventListener("change", onChange);
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (fontsLoaded) SplashScreen.hideAsync();
  }, [fontsLoaded]);

  if (!fontsLoaded) return null;

  return (
    <QueryClientProvider client={queryClient}>
      <SafeAreaProvider>
        <GestureHandlerRootView style={styles.root}>
          {/* Required by @gorhom/bottom-sheet — every Sheet is presented
              imperatively through this provider, so it must wrap the navigator. */}
          <BottomSheetModalProvider>
            <RootNavigator />
            <StatusBar style="dark" />
          </BottomSheetModalProvider>
        </GestureHandlerRootView>
      </SafeAreaProvider>
    </QueryClientProvider>
  );
}

const styles = StyleSheet.create({ root: { flex: 1 } });
