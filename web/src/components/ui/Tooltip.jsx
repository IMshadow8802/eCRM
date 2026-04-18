import MuiTooltip from "@mui/material/Tooltip";

/**
 * Theme-themed Tooltip. Thin wrapper over MUI Tooltip using token colors.
 * Defaults to arrow, 200ms enter delay.
 */
export default function Tooltip({
  title,
  children,
  placement = "top",
  arrow = true,
  delayEnter = 200,
  delayLeave = 0,
  ...rest
}) {
  if (!title) return children;
  return (
    <MuiTooltip
      title={title}
      placement={placement}
      arrow={arrow}
      enterDelay={delayEnter}
      leaveDelay={delayLeave}
      {...rest}
    >
      {children}
    </MuiTooltip>
  );
}
