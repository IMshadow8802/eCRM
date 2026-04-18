// src/components/ConfirmationDialog.jsx
import { useTheme } from "@mui/material/styles";
import {
  AlertTriangle,
  Trash2,
  Info,
  CheckCircle2,
  CircleAlert,
} from "lucide-react";

import { Modal, Button } from "./ui";
import { palettes, radii } from "../styles/tokens";

const TYPE_MAP = {
  danger: { tone: "error", iconEl: <Trash2 size={22} /> },
  warning: { tone: "warning", iconEl: <AlertTriangle size={22} /> },
  info: { tone: "info", iconEl: <Info size={22} /> },
  success: { tone: "success", iconEl: <CheckCircle2 size={22} /> },
};

const ConfirmationDialog = ({
  open,
  onClose,
  onConfirm,
  title,
  message,
  confirmText = "Confirm",
  cancelText = "Cancel",
  type = "warning",
  icon,
  isLoading = false,
  maxWidth = "sm",
}) => {
  const theme = useTheme();
  const p = theme.tokens ?? palettes.light;
  const r = theme.radii ?? radii;
  const config = TYPE_MAP[type] ?? {
    tone: "primary",
    iconEl: <CircleAlert size={22} />,
  };
  const tone = p[config.tone] ?? p.primary;

  const handleConfirm = () => {
    if (!isLoading && onConfirm) onConfirm();
  };
  const handleClose = () => {
    if (!isLoading && onClose) onClose();
  };

  return (
    <Modal
      open={open}
      onClose={handleClose}
      size={maxWidth === "xs" ? "sm" : maxWidth}
      data-testid="confirmation-dialog"
    >
      <div style={{ padding: "28px 24px 8px", textAlign: "center" }}>
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 56,
            height: 56,
            borderRadius: r.full,
            backgroundColor: tone.subtle,
            color: tone.main,
            marginBottom: 16,
          }}
        >
          {icon ?? config.iconEl}
        </div>
        <div
          style={{
            fontSize: 18,
            fontWeight: 700,
            color: p.text.primary,
            marginBottom: 8,
            letterSpacing: "-0.01em",
          }}
        >
          {title}
        </div>
        <div
          style={{
            fontSize: 14,
            fontWeight: 500,
            color: p.text.secondary,
            lineHeight: 1.5,
            maxWidth: 420,
            margin: "0 auto",
          }}
        >
          {message}
        </div>
      </div>
      <Modal.Footer align="between">
        <Button
          variant="ghost"
          onClick={handleClose}
          disabled={isLoading}
          fullWidth
        >
          {cancelText}
        </Button>
        <Button
          variant={type === "danger" ? "destructive" : "primary"}
          onClick={handleConfirm}
          loading={isLoading}
          fullWidth
        >
          {confirmText}
        </Button>
      </Modal.Footer>
    </Modal>
  );
};

export default ConfirmationDialog;
