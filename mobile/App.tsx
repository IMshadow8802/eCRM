import { useEffect } from "react";
import { AppState, type AppStateStatus, KeyboardAvoidingView, Platform, StyleSheet } from "react-native";
import { StatusBar } from "expo-status-bar";
import * as SplashScreen from "expo-splash-screen";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { QueryClientProvider, focusManager } from "@tanstack/react-query";
import { BottomSheetModalProvider } from "@gorhom/bottom-sheet";
import { LucideProvider } from "lucide-react-native";

import { queryClient } from "./src/api/queryClient";
import PresenceNoticeDialog from "./src/features/auth/PresenceNoticeDialog";
import ReauthDialog from "./src/features/auth/ReauthDialog";
import { useAccessRefresh } from "./src/features/auth/useAccess";
import RootNavigator from "./src/navigation/RootNavigator";
import { useAppFonts } from "./src/theme";
import { SheetBackHandler, ToastProvider } from "./src/ui";

SplashScreen.preventAutoHideAsync();

export default function App() {
  const fontsLoaded = useAppFonts();
  useAccessRefresh();

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

  // The presence heartbeat lives in the navigation Shell (hooks/useHeartbeat).

  useEffect(() => {
    if (fontsLoaded) SplashScreen.hideAsync();
  }, [fontsLoaded]);

  if (!fontsLoaded) return null;

  return (
    <QueryClientProvider client={queryClient}>
      {/*
        Every icon in the app, thicker and at a CONSTANT stroke.

        lucide scales its whole 24px viewBox, so the default `strokeWidth: 2`
        becomes ~1.1px once an icon is drawn at 13px — which is most of them,
        on cards and stat rows. That is why the small ones read as grey noise
        until you bring the phone closer. `absoluteStrokeWidth` pins the stroke
        in real pixels instead of scaling it down, so a 13px icon is drawn as
        heavily as a 24px one.
      */}
      <LucideProvider strokeWidth={2} absoluteStrokeWidth>
        <SafeAreaProvider>
          <GestureHandlerRootView style={styles.root}>
            {/* Required by @gorhom/bottom-sheet — every Sheet is presented
                imperatively through this provider, so it must wrap the navigator. */}
            <BottomSheetModalProvider>
              {/* Outside the navigator so a toast survives the screen that
                  raised it — a refused delete often closes its own sheet. */}
              <ToastProvider>
                {/* Android edge-to-edge (forced from API 35) ignores adjustResize, so
                    nothing resized the screens: the lowest field and the submit bar
                    sat under the keyboard. This is adjustResize, done in JS, once.
                    Sheets render in the provider's host, outside it, and lift
                    themselves (Sheet keyboardAware); Dialog has its own. */}
                <KeyboardAvoidingView testID="app-keyboard" behavior="padding" style={styles.root}>
                  <RootNavigator />
                </KeyboardAvoidingView>
                {/* After the navigator: the newest Back listener runs first, so
                    Back closes an open sheet before it can pop the screen. */}
                <SheetBackHandler />
                <PresenceNoticeDialog />
                {/* Above the navigator: a closed session is answered in place, the screen kept. */}
                <ReauthDialog />
                {/* Light: every screen opens on the navy band. RN's StatusBar is
                    last-mounted-wins and this one mounts after the navigator, so a
                    "dark" here overrode every Band's light entry (dark icons on navy). */}
                <StatusBar style="light" />
              </ToastProvider>
            </BottomSheetModalProvider>
          </GestureHandlerRootView>
        </SafeAreaProvider>
      </LucideProvider>
    </QueryClientProvider>
  );
}

const styles = StyleSheet.create({ root: { flex: 1 } });
