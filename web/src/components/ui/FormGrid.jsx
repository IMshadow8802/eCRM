import { Box } from "@mui/material";

/**
 * The field grid every form modal lays out on.
 *
 * `repeat(auto-fill, minmax(min, 1fr))` was written out by hand in four places
 * (lead create ×2, customer form, log follow-up), which meant the column width
 * that decides how tall every form modal gets was a magic number maintained in
 * four copies. It is one number now.
 *
 * Auto-fill is what makes widening a modal actually pay off: the grid takes as
 * many columns as the width allows, so bumping a Modal from `lg` to `xl` turns
 * three columns into four and drops a row off the form with no layout change.
 *
 * `span` makes a child take the full width — the notes box, a section heading,
 * an attachment list. Use it instead of a nested grid.
 */
export default function FormGrid({ min = 220, gap = 2, sx, children, ...rest }) {
  return (
    <Box
      sx={{
        display: "grid",
        gridTemplateColumns: `repeat(auto-fill, minmax(${min}px, 1fr))`,
        gap,
        ...sx,
      }}
      {...rest}
    >
      {children}
    </Box>
  );
}

/** A full-width row inside a FormGrid. */
export function FormGridSpan({ sx, children, ...rest }) {
  return (
    <Box sx={{ gridColumn: "1 / -1", ...sx }} {...rest}>
      {children}
    </Box>
  );
}
