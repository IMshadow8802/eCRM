import { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";

import { spacing } from "../theme";
import { ErrorCard, SkeletonRows } from "./EmptyState";

/**
 * How long skeleton rows may stand before they stop being reassuring and
 * start looking frozen. Longer than any healthy request on a phone connection.
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
 * The full-screen loading state, with a way out — built on E's states:
 * skeleton rows first (most loads are quick), then after PATIENCE_MS the
 * error card admits it is slow and offers a retry; a failure says so at once.
 */
export function ScreenLoader({ onRetry, failed = false, message }: ScreenLoaderProps) {
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    if (failed) return;
    const timer = setTimeout(() => setSlow(true), PATIENCE_MS);
    return () => clearTimeout(timer);
  }, [failed]);

  return (
    <View style={styles.fill}>
      {failed || slow ? (
        <View style={styles.card}>
          <ErrorCard
            title={failed ? "Could not load this" : "Still trying…"}
            message={message ?? "Check your connection. Nothing has been lost — you can go back and try again."}
            onRetry={onRetry}
          />
        </View>
      ) : (
        <SkeletonRows rows={4} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, padding: spacing[4] },
  card: { paddingTop: 72 - spacing[4] },
});

export default ScreenLoader;
