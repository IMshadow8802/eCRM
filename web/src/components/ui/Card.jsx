import { forwardRef } from "react";
import { useTheme } from "@mui/material/styles";

/**
 * Card — container surface. Defaults to padding, rounded-lg, elevation 1.
 * `interactive`/`onClick` add the hover lift (elevation 2, 1px up).
 * Always neutral: hairline border + soft shadow. No coloured strips or edges —
 * semantic colour belongs to the content (a number, a dot, a tinted cell).
 * `variant=flat|outlined` removes shadow; `ghost`
 * removes border + shadow for subtle grouping.
 *
 * Shadow and lift come from the `.nx-raised` / `.nx-lift` classes in the
 * theme's CssBaseline — an inline style cannot carry :hover.
 */
const Card = forwardRef(function Card(
  {
    children,
    variant = "default", // default | flat | ghost | outlined
    interactive = false,
    padding = "lg",
    onClick,
    className,
    sx,
    "data-testid": testId,
    ...rest
  },
  ref,
) {
  const theme = useTheme();
  const p = theme.tokens;

  const padMap = { none: 0, sm: 12, md: 16, lg: 20, xl: 28 };
  const pad = padMap[padding] ?? padMap.lg;

  let bg = p.surface.card;
  let border = `1px solid ${p.border.default}`;
  let raised = true;

  if (variant === "flat" || variant === "outlined") {
    raised = false;
  } else if (variant === "ghost") {
    border = "none";
    raised = false;
    bg = p.surface.subtle;
  }

  const clickable = Boolean(onClick) || interactive;
  const classes = [raised && "nx-raised", clickable && "nx-lift", className].filter(Boolean).join(" ");

  return (
    <div
      ref={ref}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={(e) => {
        if (!onClick) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick(e);
        }
      }}
      className={classes || undefined}
      data-testid={testId}
      // Lets a page assert that everything claiming to be a card really is one
      // — see the surface test in Dashboard.test.jsx.
      data-card-surface=""
      style={{
        position: "relative",
        padding: pad,
        borderRadius: theme.radii.lg,
        // ONE key, not two. This was `backgroundColor: bg` followed by
        // `background: gradient ? bg : undefined` — and `background` is the
        // shorthand for `background-color`, so the second key won and every
        // non-gradient card rendered with no background at all. `background`
        // takes a flat colour and a gradient equally, so one key covers both.
        background: bg,
        border,
        ...(!raised && { boxShadow: "none" }),
        cursor: clickable ? "pointer" : "default",
        color: p.text.primary,
        // No `outline: none` here: it beat the global :focus-visible ring and
        // left a keyboard user on a clickable card with no visible focus.
        ...(typeof sx === "object" ? sx : {}),
      }}
      {...rest}
    >
      {children}
    </div>
  );
});

export default Card;
