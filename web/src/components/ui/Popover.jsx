import MuiPopover from "@mui/material/Popover";
import { useTheme } from "@mui/material/styles";

/**
 * Themed Popover. Consumers pass `anchorEl`, `open`, `onClose`, content.
 */
export default function Popover({
  anchorEl,
  open,
  onClose,
  anchorOrigin = { vertical: "bottom", horizontal: "left" },
  transformOrigin = { vertical: "top", horizontal: "left" },
  children,
  "data-testid": testId,
  ...rest
}) {
  const theme = useTheme();
  const p = theme.tokens;

  return (
    <MuiPopover
      open={open}
      anchorEl={anchorEl}
      onClose={onClose}
      anchorOrigin={anchorOrigin}
      transformOrigin={transformOrigin}
      data-testid={testId}
      slotProps={{
        paper: {
          sx: {
            borderRadius: `${theme.radii.md}px`,
            border: `1px solid ${p.border.default}`,
            boxShadow: p.shadow.lg,
            marginTop: "6px",
            backgroundColor: p.surface.card,
          },
        },
      }}
      {...rest}
    >
      {children}
    </MuiPopover>
  );
}
