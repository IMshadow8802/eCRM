import { useState } from "react";
import dayjs from "dayjs";
import { useTheme } from "@mui/material/styles";
import { ChevronDown, ChevronUp, Clock, X } from "lucide-react";

import TextInput from "./TextInput";
import Popover from "./Popover";
import Tabs from "./Tabs";
import { rem } from "../../utils/rem";

const range = (fromH, toH) => {
  const out = [];
  for (let m = fromH * 60; m <= toH * 60; m += 30) {
    out.push(`${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`);
  }
  return out;
};
const PARTS = {
  morning: { label: "Morning", slots: range(8, 11.5) },
  afternoon: { label: "Afternoon", slots: range(12, 16.5) },
  evening: { label: "Evening", slots: range(17, 21) },
};
const TABS = Object.entries(PARTS).map(([value, { label }]) => ({ value, label }));

/** "13:05" -> "1:05 pm" */
export const formatTime = (hhmm) => {
  if (!hhmm) return "";
  const [h, m] = hhmm.split(":").map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`;
};

const partOf = (hhmm) => {
  const h = Number((hhmm || "08").slice(0, 2));
  return h < 12 ? "morning" : h < 17 ? "afternoon" : "evening";
};

/**
 * In-app time picker: read-only field + popover of Morning/Afternoon/Evening
 * half-hour slots, an exact custom time and Clear. Emits "HH:mm" or "".
 * `date` ("YYYY-MM-DD") disables slots already past when it is today.
 */
export default function TimeSlotPicker({ label, value, date, onChange, error, disabled, "data-testid": testId }) {
  const theme = useTheme();
  const p = theme.tokens;
  const [anchor, setAnchor] = useState(null);
  const [part, setPart] = useState("morning");
  const [hour, setHour] = useState(9);
  const [minute, setMinute] = useState(0);

  const open = (e) => {
    setPart(partOf(value));
    if (value) {
      const [h, m] = value.split(":").map(Number);
      setHour(h);
      setMinute(m - (m % 5));
    }
    setAnchor(e.currentTarget);
  };
  const close = () => setAnchor(null);
  const emit = (v) => {
    onChange(v);
    close();
  };
  const now = dayjs().startOf("minute");
  const isPast = (hhmm) => date && dayjs(`${date}T${hhmm}`).isBefore(now);

  return (
    <>
      <TextInput
        label={label}
        value={formatTime(value)}
        placeholder="Select time"
        readOnly
        disabled={disabled || !date}
        error={error}
        onClick={open}
        leftAdornment={<Clock size={14} />}
        style={{ cursor: disabled ? "default" : "pointer" }}
        data-testid={testId}
      />
      <Popover open={Boolean(anchor)} anchorEl={anchor} onClose={close} data-testid={testId ? `${testId}-popover` : undefined}>
        <div style={{ width: rem(300), padding: rem(12), display: "flex", flexDirection: "column", gap: rem(12) }}>
          <Tabs value={part} onChange={setPart} items={TABS} size="sm" data-testid={testId ? `${testId}-tabs` : undefined} />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: rem(8) }}>
            {PARTS[part].slots.map((s) => {
              const selected = s === value;
              const off = isPast(s);
              return (
                <button
                  key={s}
                  type="button"
                  disabled={off}
                  onClick={() => emit(s)}
                  data-testid={testId ? `${testId}-slot-${s}` : undefined}
                  style={{
                    height: rem(32),
                    borderRadius: theme.radii.full,
                    border: `1px solid ${selected ? p.primary.main : p.border.default}`,
                    backgroundColor: selected ? p.primary.main : p.surface.card,
                    color: selected ? "#FFFFFF" : off ? p.text.tertiary : p.text.primary,
                    fontFamily: "inherit",
                    fontSize: rem(12),
                    fontWeight: 600,
                    cursor: off ? "not-allowed" : "pointer",
                  }}
                >
                  {formatTime(s)}
                </button>
              );
            })}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: rem(8) }}>
            <span style={{ fontSize: rem(12), fontWeight: 600, color: p.text.secondary }}>Custom time</span>
            <Stepper label="Hour" text={String(hour).padStart(2, "0")} onStep={(d) => setHour((h) => (h + d + 24) % 24)} testId={testId && `${testId}-hour`} p={p} theme={theme} />
            <Stepper label="Minute" text={String(minute).padStart(2, "0")} onStep={(d) => setMinute((m) => (m + d * 5 + 60) % 60)} testId={testId && `${testId}-minute`} p={p} theme={theme} />
            <button
              type="button"
              onClick={() => emit(`${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`)}
              data-testid={testId ? `${testId}-custom-set` : undefined}
              style={{ height: rem(34), padding: `0 ${rem(12)}`, border: "none", borderRadius: theme.radii.md, backgroundColor: p.primary.main, color: "#FFFFFF", fontFamily: "inherit", fontSize: rem(12), fontWeight: 600, cursor: "pointer" }}
            >
              Set
            </button>
          </div>
          <button
            type="button"
            onClick={() => emit("")}
            data-testid={testId ? `${testId}-clear` : undefined}
            style={{ alignSelf: "flex-start", display: "inline-flex", alignItems: "center", gap: rem(4), border: "none", background: "transparent", color: p.text.secondary, fontFamily: "inherit", fontSize: rem(12), fontWeight: 600, cursor: "pointer", padding: 0 }}
          >
            <X size={12} /> Clear
          </button>
        </div>
      </Popover>
    </>
  );
}

/** Up / value / down column; steps wrap around. Buttons: `<testId>-up` / `-down`, value: `<testId>`. */
function Stepper({ label, text, onStep, testId, p, theme }) {
  const btn = {
    display: "inline-flex", alignItems: "center", justifyContent: "center",
    width: rem(40), height: rem(18), border: "none", background: "transparent",
    color: p.text.secondary, cursor: "pointer", padding: 0,
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", border: `1px solid ${p.border.default}`, borderRadius: theme.radii.md, backgroundColor: p.surface.card }}>
      <button type="button" aria-label={`${label} up`} onClick={() => onStep(1)} data-testid={testId && `${testId}-up`} style={btn}><ChevronUp size={14} /></button>
      <span data-testid={testId} aria-label={label} style={{ fontSize: rem(14), fontWeight: 600, color: p.text.primary, lineHeight: 1 }}>{text}</span>
      <button type="button" aria-label={`${label} down`} onClick={() => onStep(-1)} data-testid={testId && `${testId}-down`} style={btn}><ChevronDown size={14} /></button>
    </div>
  );
}
