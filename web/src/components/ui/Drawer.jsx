import { useEffect } from "react";
import ReactDOM from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { useTheme } from "@mui/material/styles";

import { motion as motionTokens, zIndex } from "../../styles/tokens";

/**
 * Slide-in side panel. Default side="right".
 */
export default function Drawer({
  open,
  onClose,
  side = "right",
  width = 420,
  children,
  "data-testid": testId,
  dismissOnBackdrop = true,
}) {
  const theme = useTheme();
  const p = theme.tokens;

  useEffect(() => {
    if (!open) return;
    const handler = (e) => e.key === "Escape" && onClose?.();
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (typeof document === "undefined") return null;

  const hiddenX = side === "right" ? "100%" : "-100%";

  return ReactDOM.createPortal(
    <AnimatePresence>
      {open && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: zIndex.overlay,
            pointerEvents: "auto",
          }}
        >
          <motion.div
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
              backdropFilter: "blur(6px)",
              WebkitBackdropFilter: "blur(6px)",
            }}
          />
          <motion.aside
            role="dialog"
            aria-modal="true"
            data-testid={testId}
            initial={{ x: hiddenX }}
            animate={{ x: 0 }}
            exit={{ x: hiddenX }}
            transition={{
              duration: motionTokens.duration.slow / 1000,
              ease: [0.2, 0, 0, 1],
            }}
            style={{
              position: "absolute",
              top: 0,
              bottom: 0,
              [side]: 0,
              width,
              maxWidth: "100vw",
              backgroundColor: p.surface.card,
              borderLeft: side === "right" ? `1px solid ${p.border.default}` : undefined,
              borderRight: side === "left" ? `1px solid ${p.border.default}` : undefined,
              boxShadow: p.shadow.xl,
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
            }}
          >
            {children}
          </motion.aside>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
