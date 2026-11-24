import { StyleSheet, View } from "react-native";
import { PhoneOff, TriangleAlert } from "lucide-react-native";

import { colors, metrics, radius, spacing } from "../theme";
import type { PhoneMark } from "../types/api";
import { Text } from "./Text";

export interface MarkBannerProps {
  mark: PhoneMark | null | undefined;
  note?: string | null;
  by?: string | null;
  /** When it was marked (IST wall clock from the server). */
  at?: string | null;
}

/** "20 Nov" from "2026-11-20T…" — the day part only, so no zone can shift it. */
const shortDay = (at: string) => {
  const [y, m, d] = at.slice(0, 10).split("-").map(Number);
  return new Date(y!, m! - 1, d!).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
};

/**
 * A number's do-not-call (red) or caution (amber) mark, on a call card, a lead
 * or a complaint. Solid surfaces, no tint over what is behind it.
 */
export function MarkBanner({ mark, note, by, at }: MarkBannerProps) {
  if (!mark) return null;
  const dnc = mark === "dnc";
  const Icon = dnc ? PhoneOff : TriangleAlert;
  const byline = by ? ` · marked by ${by}${at ? `, ${shortDay(at)}` : ""}` : "";
  const text = `${dnc ? "Do not call" : "Call with caution"}${note ? ` — ${note}` : ""}${byline}`;
  return (
    <View accessible accessibilityRole="alert" style={[styles.box, { backgroundColor: dnc ? colors.dangerSoft : colors.warningSoft }]}>
      <Icon size={18} color={dnc ? colors.dangerText : colors.warningText} />
      <Text variant="meta" color={dnc ? "dangerText" : "warningText"} style={styles.text}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing[3],
    paddingVertical: spacing[3],
    paddingHorizontal: metrics.rowPadH,
    borderRadius: radius.card,
  },
  text: { flex: 1 },
});
