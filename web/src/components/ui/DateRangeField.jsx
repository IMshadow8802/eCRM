import { useState } from "react";
import { useTheme } from "@mui/material/styles";
import { Calendar, Check, ChevronDown, Info } from "lucide-react";

import Popover from "./Popover";
import DateField from "./DateField";
import Button from "./Button";
import { controlHeight } from "../../styles/tokens";
import { rem } from "../../utils/rem";
import { PRESETS, ANY, presetRange, rangeLabel, shortRangeLabel } from "../../utils/datePresets";

/**
 * The one date control of the sales reports and the Leads list: what the
 * dates mean ("Work done in"), the chosen range, a presets list and a Custom
 * pair of dates. Value { preset, from, to } with local 'YYYY-MM-DD' dates.
 */
export default function DateRangeField({
  value,
  onChange,
  means,
  heading = `${means}…`,
  allowAny = false,
  "data-testid": testId = "date-range",
}) {
  const theme = useTheme();
  const p = theme.tokens;
  const [anchor, setAnchor] = useState(null);
  const [custom, setCustom] = useState(false);
  const [draft, setDraft] = useState({ from: "", to: "" });

  const options = allowAny ? [ANY, ...PRESETS] : PRESETS;
  const chosen = custom ? "custom" : value.preset;
  const label = (options.find((o) => o.value === value.preset) ?? ANY).label;
  const shown = value.preset === ANY.value || !value.from ? label : `${label} · ${rangeLabel(value)}`;

  const open = (e) => {
    setCustom(value.preset === "custom");
    setDraft({ from: value.from ?? "", to: value.to ?? "" });
    setAnchor(e.currentTarget);
  };
  const close = () => setAnchor(null);
  const pick = (preset) => {
    if (preset === "custom") return setCustom(true);
    close();
    onChange(preset === ANY.value ? { preset, from: null, to: null } : { preset, ...presetRange(preset) });
  };

  const backwards = draft.from && draft.to && draft.to < draft.from;
  const ready = draft.from && draft.to && !backwards;

  return (
    <>
      <button
        type="button"
        onClick={open}
        aria-haspopup="listbox"
        aria-expanded={Boolean(anchor)}
        data-testid={`${testId}-button`}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "calc(8rem / 15)",
          height: rem(controlHeight.sm),
          padding: "0 calc(8rem / 15) 0 calc(12rem / 15)",
          border: `1px solid ${anchor ? p.border.focus : p.border.strong}`,
          boxShadow: anchor ? `0 0 0 1px ${p.border.focus}` : "none",
          borderRadius: `${theme.radii.md}px`,
          background: p.surface.card,
          color: p.text.primary,
          fontFamily: "inherit",
          fontSize: "calc(13rem / 15)",
          whiteSpace: "nowrap",
          flexShrink: 0,
          cursor: "pointer",
        }}
      >
        <span
          style={{
            display: "flex",
            alignItems: "center",
            gap: "calc(6rem / 15)",
            color: p.text.secondary,
            fontWeight: 500,
            paddingRight: "calc(8rem / 15)",
            borderRight: `1px solid ${p.border.default}`,
          }}
        >
          <Calendar size={14} color={p.primary.main} />
          {means}
        </span>
        <span style={{ fontWeight: 600 }}>{shown}</span>
        <ChevronDown size={14} color={p.text.secondary} />
      </button>

      <Popover open={Boolean(anchor)} anchorEl={anchor} onClose={close} data-testid={`${testId}-popover`}>
        <div style={{ display: "flex", gap: "calc(12rem / 15)", padding: "calc(8rem / 15)", fontSize: "calc(13rem / 15)" }}>
          <div style={{ width: "calc(232rem / 15)" }}>
            <div style={{ fontSize: "calc(12rem / 15)", color: p.text.secondary, padding: "calc(4rem / 15) calc(8rem / 15) calc(8rem / 15)" }}>
              {heading}
            </div>
            <div role="listbox" aria-label={means}>
              {options.map((o) => {
                const on = o.value === chosen;
                const range = presetRange(o.value);
                return (
                  <div
                    key={o.value}
                    role="option"
                    tabIndex={0}
                    aria-selected={on}
                    onClick={() => pick(o.value)}
                    onKeyDown={(e) => {
                      if (e.key !== "Enter" && e.key !== " ") return;
                      e.preventDefault();
                      pick(o.value);
                    }}
                    data-testid={`${testId}-option-${o.value}`}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "calc(8rem / 15)",
                      height: "calc(34rem / 15)",
                      padding: "0 calc(8rem / 15)",
                      borderRadius: "calc(8rem / 15)",
                      cursor: "pointer",
                      background: on ? p.primary.subtle : "transparent",
                      color: on ? p.primary.main : p.text.primary,
                    }}
                  >
                    <span style={{ width: "calc(14rem / 15)", display: "flex" }}>{on && <Check size={14} />}</span>
                    <span style={{ flex: 1, fontWeight: 600 }}>{o.label}</span>
                    {range && (
                      <span style={{ fontSize: "calc(12rem / 15)", color: on ? p.primary.main : p.text.secondary }}>
                        {shortRangeLabel(range)}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
            <hr style={{ border: 0, borderTop: `1px solid ${p.border.default}`, margin: "calc(4rem / 15) 0" }} />
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "calc(6rem / 15)",
                padding: "calc(4rem / 15) calc(8rem / 15)",
                fontSize: "calc(12rem / 15)",
                color: p.text.secondary,
              }}
            >
              <Info size={12} />
              Weeks run Monday to Sunday.
            </div>
          </div>

          {custom && (
            <div style={{ borderLeft: `1px solid ${p.border.default}`, paddingLeft: "calc(12rem / 15)", display: "flex", flexDirection: "column", gap: "calc(8rem / 15)" }}>
              <div style={{ fontSize: "calc(12rem / 15)", color: p.text.secondary, paddingTop: "calc(4rem / 15)" }}>
                Pick the first and last day
              </div>
              <div style={{ display: "flex", gap: "calc(12rem / 15)", width: "calc(312rem / 15)" }}>
                <DateField size="sm" label="From" value={draft.from} onChange={(from) => setDraft((d) => ({ ...d, from }))} data-testid={`${testId}-from`} />
                <DateField size="sm" label="To" value={draft.to} onChange={(to) => setDraft((d) => ({ ...d, to }))} error={backwards ? "To is before From" : undefined} data-testid={`${testId}-to`} />
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: "calc(8rem / 15)", marginTop: "auto" }}>
                <Button variant="ghost" size="sm" onClick={close} data-testid={`${testId}-cancel`}>
                  Cancel
                </Button>
                <Button
                  size="sm"
                  disabled={!ready}
                  onClick={() => {
                    close();
                    onChange({ preset: "custom", from: draft.from, to: draft.to });
                  }}
                  data-testid={`${testId}-apply`}
                >
                  {ready ? `Show ${shortRangeLabel(draft)}` : "Show"}
                </Button>
              </div>
            </div>
          )}
        </div>
      </Popover>
    </>
  );
}
