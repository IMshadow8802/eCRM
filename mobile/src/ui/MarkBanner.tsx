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

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "20 Nov" in the phone's local day: the server sends an instant ("…Z"), so never slice the string. */
const shortDay = (at: string) => {
  const d = new Date(at);
  return Number.isNaN(d.getTime()) ? "" : `${d.getDate()} ${MONTHS[d.getMonth()]}`;
};

/**
 * A number's do-not-call (red) or caution (amber) mark, on a call card, a lead
 * or a complaint. Solid surfaces, no tint over what is behind it.
 */
export function MarkBanner({ mark, note, by, at }: MarkBannerProps) {
  if (!mark) return null;
  const dnc = mark === "dnc";
  const Icon = dnc ? PhoneOff : TriangleAlert;
  const day = at ? shortDay(at) : "";
  const byline = by ? ` · marked by ${by}${day ? `, ${day}` : ""}` : "";
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
