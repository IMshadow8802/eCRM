import { Typography } from "@mui/material";

/**
 * Tiny "Sample data" hint shown while a chart renders its demo fallback,
 * so nobody mistakes the placeholder visuals for real numbers.
 * Parent must be position:relative unless `inline` is set.
 */
export default function SampleBadge({ inline = false }) {
  return (
    <Typography
      component="span"
      sx={{
        ...(inline
          ? {}
          : { position: "absolute", top: 0, right: 0, zIndex: 1 }),
        px: 0.75,
        py: 0.25,
        borderRadius: 999,
        fontSize: "0.65rem",
        fontWeight: 600,
        letterSpacing: "0.03em",
        color: "text.tertiary",
        backgroundColor: "action.hover",
        whiteSpace: "nowrap",
        alignSelf: "center",
      }}
    >
      Sample data
    </Typography>
  );
}
