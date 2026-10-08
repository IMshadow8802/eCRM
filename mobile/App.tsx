import { useEffect } from "react";
import { AppState, type AppStateStatus, Platform, StyleSheet } from "react-native";
import { StatusBar } from "expo-status-bar";
import * as SplashScreen from "expo-splash-screen";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { QueryClientProvider, focusManager } from "@tanstack/react-query";
import { BottomSheetModalProvider } from "@gorhom/bottom-sheet";
import { LucideProvider } from "lucide-react-native";

import { queryClient } from "./src/api/queryClient";
import { heartbeat } from "./src/api/presenceQueries";
import PresenceNoticeDialog from "./src/features/auth/PresenceNoticeDialog";
import useAuthStore from "./src/stores/useAuthStore";
import RootNavigator from "./src/navigation/RootNavigator";
import { useAppFonts } from "./src/theme";
import { ToastProvider } from "./src/ui";

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

  // Presence heartbeat: on foreground and every 2 minutes while active. Errors
  // are ignored; a dead session surfaces as a 401 on the next real request.
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  useEffect(() => {
    if (!isAuthenticated) return;
    let timer: ReturnType<typeof setInterval> | null = null;
    const beat = () => void heartbeat().catch(() => {});
    const start = () => {
      beat();
      timer ??= setInterval(beat, 120_000);
    };
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = null;
    };
    if (AppState.currentState === "active") start();
    const sub = AppState.addEventListener("change", (s) => (s === "active" ? start() : stop()));
    return () => {
      sub.remove();
      stop();
    };
  }, [isAuthenticated]);

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
                <RootNavigator />
                <PresenceNoticeDialog />
                <StatusBar style="dark" />
              </ToastProvider>
            </BottomSheetModalProvider>
          </GestureHandlerRootView>
        </SafeAreaProvider>
      </LucideProvider>
    </QueryClientProvider>
  );
}

const styles = StyleSheet.create({ root: { flex: 1 } });
