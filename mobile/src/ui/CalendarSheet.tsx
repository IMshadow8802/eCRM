import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { ChevronLeft, ChevronRight } from "lucide-react-native";

import { colors, HIT_TARGET, metrics, radius, spacing } from "../theme";
import { Text } from "./Text";

const pad2 = (n: number) => String(n).padStart(2, "0");

export const toISODate = (d: Date) =>
  // Local Y/M/D, NOT toISOString() — that converts to UTC and rolls the date
  // back a day for anyone east of Greenwich, which is every user here (IST).
  `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const WEEKDAYS = ["M", "T", "W", "T", "F", "S", "S"];

/** 6 weeks × 7 days, Monday first: the month's ISO days, null outside it. */
export function monthGrid(year: number, month: number): (string | null)[] {
  const lead = (new Date(year, month, 1).getDay() + 6) % 7;
  return Array.from({ length: 42 }, (_, i) => {
    // Date rolls day overflow into the next month on its own, in local time.
    const d = new Date(year, month, i - lead + 1);
    return d.getMonth() === month ? toISODate(d) : null;
  });
}

export interface CalendarSheetProps {
  /** yyyy-MM-dd or null. */
  value: string | null;
  minimumDate?: Date;
  now?: Date;
  onPick: (iso: string) => void;
}

/** The in-app month calendar shown in DateField's sheet. Tap a day = pick. */
export function CalendarSheet({ value, minimumDate, now = new Date(), onPick }: CalendarSheetProps) {
  const start = value ? new Date(`${value}T00:00:00`) : now;
  const [cursor, setCursor] = useState({ y: start.getFullYear(), m: start.getMonth() });
  const today = toISODate(now);
  const min = minimumDate ? toISODate(minimumDate) : null;
  const monthKey = `${cursor.y}-${pad2(cursor.m + 1)}`;
  const canPrev = !min || monthKey > min.slice(0, 7);
  const step = (d: number) => {
    const next = new Date(cursor.y, cursor.m + d, 1);
    setCursor({ y: next.getFullYear(), m: next.getMonth() });
  };
  const cells = monthGrid(cursor.y, cursor.m);

  return (
    <View>
      <View style={styles.header}>
        <Pressable
          onPress={() => step(-1)}
          disabled={!canPrev}
          accessibilityRole="button"
          accessibilityLabel="Previous month"
          style={styles.nav}
        >
          <ChevronLeft size={20} color={canPrev ? colors.textOnBrand : colors.onBandMuted} />
        </Pressable>
        <Text testID={`calendar-month-${monthKey}`} variant="cardTitle" color="textOnBrand" accessibilityRole="header">
          {`${MONTHS[cursor.m]} ${cursor.y}`}
        </Text>
        <Pressable onPress={() => step(1)} accessibilityRole="button" accessibilityLabel="Next month" style={styles.nav}>
          <ChevronRight size={20} color={colors.textOnBrand} />
        </Pressable>
      </View>

      <View style={styles.row}>
        {WEEKDAYS.map((d, i) => (
          <Text key={i} variant="label" color="textMuted" align="center" style={styles.cell}>{d}</Text>
        ))}
      </View>

      {[0, 1, 2, 3, 4, 5].map((w) => (
        <View key={w} style={styles.row}>
          {cells.slice(w * 7, w * 7 + 7).map((iso, i) => {
            if (!iso) return <View key={i} style={styles.cell} />;
            const off = !!min && iso < min;
            const on = iso === value;
            return (
              <View key={iso} style={styles.cell}>
                <Pressable
                  testID={`calendar-day-${iso}`}
                  onPress={() => onPick(iso)}
                  disabled={off}
                  accessibilityRole="button"
                  accessibilityLabel={`${Number(iso.slice(8))} ${MONTHS[cursor.m]} ${cursor.y}`}
                  accessibilityState={{ selected: on, disabled: off }}
                  style={({ pressed }) => [
                    styles.day,
                    iso === today && styles.today,
                    pressed && styles.pressed,
                    on && styles.selected,
                  ]}
                >
                  <Text
                    variant={on || iso === today ? "rowTitle" : "text"}
                    tabular
                    color={on ? "textOnBrand" : off ? "iconFaint" : "text"}
                  >
                    {Number(iso.slice(8))}
                  </Text>
                </Pressable>
              </View>
            );
          })}
        </View>
      ))}
    </View>
  );
}

const DAY = metrics.iconButton;

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    height: metrics.bandRow,
    paddingHorizontal: spacing[1],
    marginBottom: spacing[2],
    borderRadius: radius.card,
    backgroundColor: colors.band,
  },
  nav: { width: HIT_TARGET, height: HIT_TARGET, alignItems: "center", justifyContent: "center" },
  row: { flexDirection: "row" },
  cell: { flex: 1, height: HIT_TARGET, alignItems: "center", justifyContent: "center" },
  day: { width: DAY, height: DAY, borderRadius: DAY / 2, alignItems: "center", justifyContent: "center" },
  today: { borderWidth: 2, borderColor: colors.primary },
  pressed: { backgroundColor: colors.surfacePressed },
  selected: { backgroundColor: colors.primary },
});
