import { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { WifiOff } from "lucide-react-native";

import { colors, spacing } from "../theme";
import { Button } from "./Button";
import { Text } from "./Text";

/**
 * How long a spinner may spin before it stops being reassuring and starts
 * looking frozen. Comfortably longer than any healthy request on a phone
 * connection, short enough that nobody force-quits the app first.
 */
const PATIENCE_MS = 6000;

export interface ScreenLoaderProps {
  /** Retry the query behind this screen. Omit and no button is offered. */
  onRetry?: () => void;
  /** True once the query has actually failed, as opposed to still trying. */
  failed?: boolean;
  message?: string;
}

/**
 * The full-screen loading state, with a way out.
 *
 * A bare `<ActivityIndicator/>` is indistinguishable from a hung app, and the
 * screens that used one rendered no header either — so a slow request left the
 * user with no back button and no retry, and force-quitting was genuinely the
 * only option. That is the bug this exists to kill.
 *
 * The spinner still shows first, because most loads are quick and a
 * "something's wrong" message flashing on every navigation would be worse.
 * After PATIENCE_MS it admits the request is not going well and offers a retry.
 */
export function ScreenLoader({ onRetry, failed = false, message }: ScreenLoaderProps) {
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    if (failed) return;
    const timer = setTimeout(() => setSlow(true), PATIENCE_MS);
    return () => clearTimeout(timer);
  }, [failed]);

  const stalled = failed || slow;

  return (
    <View style={styles.centre}>
      {failed ? (
        <WifiOff size={30} color={colors.textMuted} />
      ) : (
        <ActivityIndicator color={colors.primary} />
      )}

      {stalled ? (
        <>
          <Text variant="h3" align="center">
            {failed ? "Could not load this" : "Still trying…"}
          </Text>
          <Text variant="secondary" align="center">
            {message ??
              "Check your connection. Nothing has been lost — you can go back and try again."}
          </Text>
          {onRetry ? (
            <Button title="Try again" size="sm" onPress={onRetry} />
          ) : null}
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  centre: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing[3],
    padding: spacing[6],
  },
});

export default ScreenLoader;
