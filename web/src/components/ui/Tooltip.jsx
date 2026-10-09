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
  describeChild = true, // text is a description; never replaces the control's own accessible name
  ...rest
}) {
  if (!title) return children;
  return (
    <MuiTooltip
      title={title}
      placement={placement}
      arrow={arrow}
      describeChild={describeChild}
      enterDelay={delayEnter}
      leaveDelay={delayLeave}
      {...rest}
    >
      {children}
    </MuiTooltip>
  );
}
