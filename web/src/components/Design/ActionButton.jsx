// src/components/Design/ActionButton.jsx
import React from "react";

import Button from "../ui/Button";
import Tooltip from "../ui/Tooltip";

/**
 * Legacy ActionButton — now a thin shim over the design-system Button so
 * Master pages get modern styling without call-site changes.
 *
 * Props preserved for compatibility; most styling props are ignored now
 * that variant/color is resolved from `actionType`.
 */

const ACTION_VARIANT = {
  create: "primary",
  update: "primary",
  save: "primary",
  confirm: "primary",
  search: "primary",
  view: "tonal",
  refresh: "ghost",
  filter: "tonal",
  upload: "tonal",
  exportCSV: "secondary",
  exportPDF: "secondary",
  print: "ghost",
  delete: "destructive",
  cancel: "ghost",
};

const ACTION_LABEL = {
  create: "Create",
  update: "Update",
  save: "Save",
  confirm: "Confirm",
  search: "Search",
  view: "View",
  refresh: "Refresh",
  filter: "Filter",
  upload: "Upload",
  exportCSV: "Export CSV",
  exportPDF: "Export PDF",
  print: "Print",
  delete: "Delete",
  cancel: "Cancel",
};

const ActionButton = ({
  actionType = "create",
  onClick,
  isLoading = false,
  disabled = false,
  tooltip = "",
  size = "md",
  label,
  iconOnly = false,
  leftIcon,
  rightIcon,
  "data-testid": testId,
  ...rest
}) => {
  const variant = ACTION_VARIANT[actionType] ?? "primary";
  const displayText = label ?? ACTION_LABEL[actionType] ?? "Action";

  const btn = (
    <Button
      variant={variant}
      size={size}
      onClick={onClick}
      disabled={disabled}
      loading={isLoading}
      leftIcon={leftIcon}
      rightIcon={rightIcon}
      data-testid={testId}
      {...rest}
    >
      {!iconOnly && displayText}
    </Button>
  );

  return tooltip ? <Tooltip title={tooltip}>{btn}</Tooltip> : btn;
};

export default ActionButton;
