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
  loading?: boolean;
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
  loading = false,
  onConfirm,
  onCancel,
}: DialogProps) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onCancel}
    >
      <Pressable style={styles.backdrop} onPress={loading ? undefined : onCancel}>
        {/* Stops a tap inside the card from closing the dialog. */}
        <Pressable style={styles.card} onPress={(e) => e.stopPropagation()}>
          <Text variant="h2">{title}</Text>
          {message ? <Text variant="secondary">{message}</Text> : null}
          <View style={styles.actions}>
            <Button
              title={cancelLabel}
              variant="secondary"
              onPress={onCancel}
              disabled={loading}
              style={styles.action}
            />
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
