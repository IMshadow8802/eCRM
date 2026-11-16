import MuiPopover from "@mui/material/Popover";
import { useTheme } from "@mui/material/styles";
import { zIndex } from "../../styles/tokens";

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
      // MUI defaults to 1300, under ui/Modal (1400); same token Combobox/DateField use.
      sx={{ zIndex: zIndex.popover }}
      slotProps={{
        paper: {
          sx: {
            borderRadius: `${theme.radii.md}px`,
            border: `1px solid ${p.border.default}`,
            boxShadow: p.shadow.lg,
            marginTop: "calc(6rem / 15)",
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
