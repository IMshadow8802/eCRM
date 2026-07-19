import MuiMenu from "@mui/material/Menu";
import MuiMenuItem from "@mui/material/MenuItem";
import ListSubheader from "@mui/material/ListSubheader";
import { useTheme } from "@mui/material/styles";
import { MoreVertical } from "lucide-react";

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
                  color: item.destructive
                    ? p.error.main
                    : item.muted
                      ? p.text.tertiary
                      : p.text.primary,
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
                {item.onSecondary && (
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={(e) => {
                      e.stopPropagation();
                      onClose?.(e);
                      item.onSecondary(e);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        e.stopPropagation();
                        onClose?.(e);
                        item.onSecondary(e);
                      }
                    }}
                    data-testid={
                      testId && item.id
                        ? `${testId}-${item.id}-${item.secondaryKey ?? "settings"}`
                        : undefined
                    }
                    aria-label={item.secondaryLabel ?? "Workspace settings"}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      width: 22,
                      height: 22,
                      borderRadius: theme.radii.sm,
                      color: p.text.tertiary,
                      cursor: "pointer",
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.backgroundColor = p.surface.subtle;
                      e.currentTarget.style.color = p.primary.main;
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.backgroundColor = "transparent";
                      e.currentTarget.style.color = p.text.tertiary;
                    }}
                  >
                    {item.secondaryIcon ?? <MoreVertical size={14} />}
                  </span>
                )}
              </MuiMenuItem>
            ),
          )
        : children}
    </MuiMenu>
  );
}
