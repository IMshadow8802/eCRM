import { Box, Typography } from "@mui/material";

/**
 * What a chart shows when it has nothing real to draw. Charts used to fall
 * back to a hard-coded demo series here; a client read those as their own
 * numbers, so a chart without data now says so and draws nothing.
 */
export default function ChartEmpty({ height }) {
  return (
    <Box
      sx={{
        height,
        minHeight: "calc(64rem / 15)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Typography sx={{ fontSize: "0.8rem", color: "text.tertiary" }}>No data yet</Typography>
    </Box>
  );
}
