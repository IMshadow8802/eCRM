import { cloneElement, isValidElement } from "react";
import { useTheme } from "@mui/material/styles";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";

import { Card } from "./ui";

const TONE_MAP = {
  primary: "primary",
  blue: "primary",
  accent: "accent",
  pink: "accent",
  green: "success",
  success: "success",
  amber: "warning",
  warning: "warning",
  red: "error",
  error: "error",
  info: "info",
  default: "primary",
};

export function StatisticsCard({
  color = "primary",
  icon,
  title,
  value,
  footer = null,
  trend = null,
  gradient = false,
}) {
  const theme = useTheme();
  const p = theme.tokens;
  const toneKey = TONE_MAP[color] ?? "primary";
  const tone = p[toneKey] ?? p.primary;

  const sizedIcon = isValidElement(icon)
    ? cloneElement(icon, { size: 18, ...(icon.props ?? {}) })
    : icon;

  return (
    <Card variant={gradient ? "gradient" : "default"} padding="lg">
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          marginBottom: 14,
        }}
      >
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 32,
            height: 32,
            flexShrink: 0,
            borderRadius: theme.radii.md,
            backgroundColor: gradient
              ? "rgba(255,255,255,0.15)"
              : tone.subtle,
            color: gradient ? "#FFFFFF" : tone.main,
          }}
        >
          {sizedIcon}
        </span>
        <span
          style={{
            fontSize: 13,
            fontWeight: 500,
            color: gradient ? "rgba(255,255,255,0.88)" : p.text.secondary,
            lineHeight: 1.2,
            textTransform: "uppercase",
            letterSpacing: "0.05em",
            // "TODAY'S FOLLOW-UPS" breaks at the hyphen into three lines in a
            // narrow tile, and "FOLLOW-" alone is wider than the content box.
            minWidth: 0,
            overflowWrap: "anywhere",
          }}
        >
          {title}
        </span>
      </div>

      <div
        style={{
          // A money KPI like ₹45,23,180.00 is 13 tabular digits — wider than
          // a two-up tile on a phone, and one unbreakable "word", so it spilled
          // into the neighbouring card. Let it shrink, then break.
          fontSize: "clamp(22px, 6vw, 30px)",
          fontWeight: 700,
          color: gradient ? "#FFFFFF" : p.text.primary,
          lineHeight: 1.1,
          letterSpacing: "-0.02em",
          fontFeatureSettings: "'tnum'",
          overflowWrap: "anywhere",
        }}
      >
        {value}
      </div>

      {(trend || footer) && (
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: 6,
            marginTop: 10,
          }}
        >
          {trend && (
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                fontSize: 12,
                fontWeight: 600,
                color: gradient
                  ? "#FFFFFF"
                  : trend.direction === "up"
                    ? p.success.main
                    : trend.direction === "down"
                      ? p.error.main
                      : p.text.secondary,
              }}
            >
              {trend.direction === "up" ? (
                <TrendingUp size={12} />
              ) : trend.direction === "down" ? (
                <TrendingDown size={12} />
              ) : (
                <Minus size={12} />
              )}
              {trend.value}
            </span>
          )}
          {footer && (
            <span
              style={{
                fontSize: 12,
                fontWeight: 500,
                color: gradient ? "rgba(255,255,255,0.85)" : p.text.secondary,
              }}
            >
              {footer}
            </span>
          )}
        </div>
      )}
    </Card>
  );
}

export default StatisticsCard;
