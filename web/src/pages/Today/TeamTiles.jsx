import { useTheme } from "@mui/material/styles";

import { AlertTriangle, Gavel, Hourglass, Plane, Timer, UserX, Wifi } from "lucide-react";

import { IconBadge, Tooltip } from "../../components/ui";
import { LIVE_TILES, TILES, durationText } from "./todayWords";

const NOT_EXPECTED = ["leave", "on_duty", "holiday", "not_tracked"];
// no shift that day (day off) is not expected, unless they signed in anyway
const expected = (p) => !NOT_EXPECTED.includes(p.status?.code) && Boolean(p.ShiftStart || p.FirstSignInAt);
const across = (n) => `across ${n} ${n === 1 ? "person" : "people"}`;
const sum = (people, k) => people.reduce((s, p) => s + (p.counts?.[k] ?? 0), 0);

// Per tile: the icon badge (and its hue), the big number, the line under it, a hint.
const BADGE = {
  in: [Wifi, "success"],
  notIn: [UserX, "error"],
  late: [Timer, "warning"],
  away: [Plane, "info"],
  overdue: [AlertTriangle, "error"],
  atRisk: [Hourglass, "warning"],
  toRule: [Gavel, "error"],
};

const SPEC = {
  in: { value: (ps, hit) => hit.length, sub: (ps) => `of ${ps.filter(expected).length} expected`, hint: "People with the app open right now." },
  notIn: { tone: "error", value: (ps, hit) => hit.length, sub: () => "work time has started", hint: "Work time has started and the person has not signed in." },
  late: { tone: "warning", value: (ps, hit) => hit.length, sub: (ps, hit) => `total ${durationText(hit.reduce((s, p) => s + (p.LateMinutes ?? 0), 0))}`, hint: "Signed in after the 'count as late after' minutes that start when the shift starts." },
  away: { value: (ps, hit) => hit.length, sub: (ps, hit) => hit.slice(0, 2).map((p) => p.FullName).join(", "), hint: "A manager marked the day as leave, or working away from the office (on duty)." },
  overdue: { tone: "error", value: (ps, hit) => sum(hit, "overdue"), sub: (ps, hit) => across(hit.length), hint: "Tasks that have already gone past their deadline." },
  atRisk: { tone: "warning", value: (ps, hit) => sum(hit, "atRisk"), sub: (ps, hit) => across(hit.length), hint: "Open tasks where most of the allowed time is used up. They will miss the deadline if not finished soon." },
  toRule: { tone: "error", value: (ps, hit) => sum(hit, "toRule"), sub: () => "missed deadlines", hint: "Missed deadlines where the person gave a reason and you have not yet decided." },
};

/** The seven tiles over My team (spec §2.2). A click filters the people; the active tile again clears. */
export default function TeamTiles({ people, live, active, onPick }) {
  const p = useTheme().tokens;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, calc(140rem / 15)), 1fr))", gap: "calc(12rem / 15)" }}>
      {TILES.map((t) => {
        const s = SPEC[t.key];
        const off = !live && LIVE_TILES.has(t.key);
        const hit = people.filter(t.test);
        const value = off ? "—" : s.value(people, hit);
        const on = active === t.key;
        const hot = !off && value > 0 && s.tone;
        const color = hot ? p[s.tone].hover : p.text.primary;
        return (
          <Tooltip key={t.key} title={s.hint}>
            <span style={{ display: "flex" }}>
              <button type="button" data-testid={`tile-${t.key}`} aria-pressed={on} disabled={off} onClick={() => onPick(on ? null : t.key)}
                className="nx-raised nx-lift"
                style={{
                  flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: "calc(2rem / 15)", padding: "calc(12rem / 15) calc(14rem / 15)", textAlign: "left", fontFamily: "inherit",
                  borderRadius: "calc(12rem / 15)", cursor: off ? "default" : "pointer", background: on ? p.primary.subtle : p.surface.card,
                  // Neutral edge; only the picked tile (a state, not a decoration) shows indigo.
                  border: `1px solid ${on ? p.primary.main : p.border.default}`,
                }}>
                <span style={{ display: "flex", alignItems: "center", gap: "calc(8rem / 15)", fontSize: "calc(12rem / 15)", fontWeight: 600, color: p.text.secondary }}>
                  <IconBadge icon={BADGE[t.key][0]} tone={BADGE[t.key][1]} size="sm" data-testid={`tile-badge-${t.key}`} />
                  {t.label}
                </span>
                <span style={{ fontSize: "calc(26rem / 15)", fontWeight: 700, letterSpacing: "-0.02em", fontVariantNumeric: "tabular-nums", color }}>{value}</span>
                <span style={{ fontSize: "calc(12rem / 15)", color: p.text.tertiary, minHeight: "1.2em" }}>{off ? "today only" : s.sub(people, hit)}</span>
              </button>
            </span>
          </Tooltip>
        );
      })}
    </div>
  );
}
