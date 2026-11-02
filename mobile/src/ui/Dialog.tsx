import type { ReactNode } from "react";
import { Modal, Pressable, StyleSheet, View } from "react-native";

import { colors, radius, shadows, spacing } from "../theme";
import { Button } from "./Button";
import { Text } from "./Text";

export interface DialogProps {
  visible: boolean;
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  /** Notice-style dialog: a single confirm button. */
  hideCancel?: boolean;
  loading?: boolean;
  /** False: only the buttons close it — no backdrop tap, no Android back. */
  dismissable?: boolean;
  /** Extra content (a field) between the message and the buttons. */
  children?: ReactNode;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * The ONE confirm dialog. Never use RN's Alert — it cannot be styled, cannot
 * show a loading state, and blocks the JS thread on Android.
 */
export function Dialog({
  visible,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  destructive = false,
  hideCancel = false,
  loading = false,
  dismissable = true,
  children,
  onConfirm,
  onCancel,
}: DialogProps) {
  const dismiss = dismissable && !loading ? onCancel : undefined;
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={dismissable ? onCancel : () => {}}
    >
      <Pressable style={styles.backdrop} onPress={dismiss}>
        {/* Stops a tap inside the card from closing the dialog. */}
        <Pressable style={styles.card} onPress={(e) => e.stopPropagation()}>
          <Text variant="h2">{title}</Text>
          {message ? <Text variant="secondary">{message}</Text> : null}
          {children}
          <View style={styles.actions}>
            {hideCancel ? null : (
              <Button
                title={cancelLabel}
                variant="secondary"
                onPress={onCancel}
                disabled={loading}
                style={styles.action}
              />
            )}
            <Button
              title={confirmLabel}
              variant={destructive ? "danger" : "primary"}
              onPress={onConfirm}
              loading={loading}
              style={styles.action}
            />
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: colors.overlay,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing[6],
  },
  card: {
    width: "100%",
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing[5],
    gap: spacing[3],
    ...shadows.lg,
  },
  actions: { flexDirection: "row", gap: spacing[3], marginTop: spacing[2] },
  action: { flex: 1 },
});

export default Dialog;
