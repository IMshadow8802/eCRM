import { useEffect, useRef } from "react";
import ReactDOM from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { useTheme } from "@mui/material/styles";

import IconButton from "./IconButton";
import { motion as motionTokens, zIndex } from "../../styles/tokens";

/**
 * Unified Modal with slotted Header / Body / Footer sub-components.
 *
 * <Modal open={...} onClose={...} size="md">
 *   <Modal.Header title="..." subtitle="..." icon={...} onClose={...} />
 *   <Modal.Body>...</Modal.Body>
 *   <Modal.Footer>...</Modal.Footer>
 * </Modal>
 */

const SIZE = {
  sm: 420,
  md: 560,
  lg: 720,
  xl: 960,
};

function Modal({
  open,
  onClose,
  size = "md",
  dismissOnBackdrop = true,
  dismissOnEscape = true,
  className,
  children,
  "data-testid": testId,
  "aria-label": ariaLabel,
}) {
  const theme = useTheme();
  const p = theme.tokens;
  const widthPx = SIZE[size] ?? SIZE.md;
  const containerRef = useRef(null);

  useEffect(() => {
    if (!open || !dismissOnEscape) return;
    const handler = (e) => {
      if (e.key === "Escape") onClose?.();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose, dismissOnEscape]);

  useEffect(() => {
    if (!open) return;
    const original = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = original;
    };
  }, [open]);

  if (typeof document === "undefined") return null;

  return ReactDOM.createPortal(
    <AnimatePresence>
      {open && (
        <div
          role="presentation"
          data-testid={testId ? `${testId}-root` : undefined}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: zIndex.modal,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
          }}
        >
          <motion.div
            aria-hidden="true"
            onClick={() => dismissOnBackdrop && onClose?.()}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{
              duration: motionTokens.duration.base / 1000,
              ease: [0.4, 0, 0.2, 1],
            }}
            data-testid={testId ? `${testId}-backdrop` : undefined}
            style={{
              position: "absolute",
              inset: 0,
              backgroundColor: p.overlay,
              backdropFilter: "blur(8px) saturate(180%)",
              WebkitBackdropFilter: "blur(8px) saturate(180%)",
            }}
          />
          <motion.div
            ref={containerRef}
            role="dialog"
            aria-modal="true"
            aria-label={ariaLabel}
            data-testid={testId}
            initial={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.98 }}
            transition={{
              duration: motionTokens.duration.slow / 1000,
              ease: [0.2, 0, 0, 1],
            }}
            className={className}
            style={{
              position: "relative",
              width: "100%",
              maxWidth: widthPx,
              maxHeight: "calc(100vh - 48px)",
              display: "flex",
              flexDirection: "column",
              backgroundColor: p.surface.card,
              border: `1px solid ${p.border.default}`,
              borderRadius: theme.radii.lg,
              boxShadow: p.shadow.xl,
              overflow: "hidden",
              color: p.text.primary,
            }}
          >
            {children}
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

function ModalHeader({ title, subtitle, icon, onClose, children }) {
  const theme = useTheme();
  const p = theme.tokens;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "16px 20px",
        borderBottom: `1px solid ${p.border.default}`,
        flexShrink: 0,
      }}
    >
      {icon && (
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 36,
            height: 36,
            borderRadius: theme.radii.md,
            backgroundColor: p.primary.subtle,
            color: p.primary.main,
            flexShrink: 0,
          }}
        >
          {icon}
        </div>
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        {title && (
          <div style={{ fontSize: 18, fontWeight: 700, color: p.text.primary, lineHeight: 1.3 }}>
            {title}
          </div>
        )}
        {subtitle && (
          <div style={{ fontSize: 13, fontWeight: 500, color: p.text.secondary, marginTop: 2 }}>
            {subtitle}
          </div>
        )}
        {children}
      </div>
      {onClose && (
        <IconButton
          size="sm"
          variant="ghost"
          onClick={onClose}
          aria-label="Close modal"
          data-testid="modal-close"
        >
          <X size={16} />
        </IconButton>
      )}
    </div>
  );
}

function ModalBody({ children, padded = true, scrollable = true }) {
  return (
    <div
      style={{
        padding: padded ? 20 : 0,
        overflowY: scrollable ? "auto" : "visible",
        flex: 1,
      }}
    >
      {children}
    </div>
  );
}

function ModalFooter({ children, align = "right" }) {
  const theme = useTheme();
  const p = theme.tokens;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: align === "left" ? "flex-start" : align === "between" ? "space-between" : "flex-end",
        gap: 8,
        padding: "12px 20px",
        borderTop: `1px solid ${p.border.default}`,
        backgroundColor: p.surface.subtle,
        flexShrink: 0,
      }}
    >
      {children}
    </div>
  );
}

Modal.Header = ModalHeader;
Modal.Body = ModalBody;
Modal.Footer = ModalFooter;

export default Modal;
