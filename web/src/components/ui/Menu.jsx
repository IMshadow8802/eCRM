import MuiMenu from "@mui/material/Menu";
import MuiMenuItem from "@mui/material/MenuItem";
import ListSubheader from "@mui/material/ListSubheader";
import { useTheme } from "@mui/material/styles";

/**
 * Themed dropdown Menu. Accepts `items` or children.
 * Item shape: { id, label, icon?, onClick?, disabled?, destructive?, sectionAfter? }.
 */
export default function Menu({
  anchorEl,
  open,
  onClose,
  items = [],
  children,
  "data-testid": testId,
  ...rest
}) {
  const theme = useTheme();
  const p = theme.tokens;

  return (
    <MuiMenu
      anchorEl={anchorEl}
      open={open}
      onClose={onClose}
      data-testid={testId}
      slotProps={{
        paper: {
          sx: {
            borderRadius: `${theme.radii.md}px`,
            border: `1px solid ${p.border.default}`,
            boxShadow: p.shadow.lg,
            marginTop: "6px",
            minWidth: 200,
          },
        },
      }}
      {...rest}
    >
      {items.length > 0
        ? items.map((item, idx) =>
            item.header ? (
              <ListSubheader
                key={`h-${idx}`}
                sx={{
                  bgcolor: "transparent",
                  fontSize: 11,
                  fontWeight: 600,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  color: p.text.tertiary,
                  lineHeight: "28px",
                }}
              >
                {item.header}
              </ListSubheader>
            ) : (
              <MuiMenuItem
                key={item.id ?? idx}
                disabled={item.disabled}
                onClick={(e) => {
                  item.onClick?.(e);
                  onClose?.(e);
                }}
                data-testid={testId ? `${testId}-${item.id ?? idx}` : undefined}
                sx={{
                  gap: 1.25,
                  fontSize: 14,
                  fontWeight: 500,
                  color: item.destructive ? p.error.main : p.text.primary,
                  "&:hover": {
                    backgroundColor: item.destructive
                      ? p.error.subtle
                      : p.primary.subtle,
                  },
                }}
              >
                {item.icon && (
                  <span style={{ display: "inline-flex" }}>{item.icon}</span>
                )}
                <span style={{ flex: 1 }}>{item.label}</span>
                {item.shortcut && (
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 500,
                      color: p.text.tertiary,
                    }}
                  >
                    {item.shortcut}
                  </span>
                )}
              </MuiMenuItem>
            ),
          )
        : children}
    </MuiMenu>
  );
}
