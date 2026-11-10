import type { ReactNode } from "react";
import { KeyboardAvoidingView, Modal, Pressable, StyleSheet, View } from "react-native";

import { colors, radius, spacing } from "../theme";
import { Button } from "./Button";
import { StatusBadge, type StatusBadgeProps } from "./StatusBadge";
import { Text } from "./Text";

export interface DialogProps {
  visible: boolean;
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  /** A 48 badge over the title (E 21: a destructive delete is red trash-2). */
  badge?: Pick<StatusBadgeProps, "tone" | "icon">;
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
  badge,
  hideCancel = false,
  loading = false,
  dismissable = true,
  children,
  onConfirm,
  onCancel,
}: DialogProps) {
  const dismiss = dismissable && !loading ? onCancel : undefined;
  // ponytail: a length guess, not a measurement. Two half-width buttons fit
  // about 24 characters between them on a 360dp phone; past that a label is
  // cut ("Sign in as someon..."), so they stack full width instead.
  const stacked = !hideCancel && cancelLabel.length + confirmLabel.length > 24;
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={dismissable ? onCancel : () => {}}
    >
      {/* Edge-to-edge Android never resizes the window for the keyboard, so
          the card has to move itself or the keyboard covers its buttons. */}
      <KeyboardAvoidingView behavior="padding" style={styles.fill}>
      <Pressable style={styles.backdrop} onPress={dismiss}>
        {/* Stops a tap inside the card from closing the dialog. */}
        <Pressable style={styles.card} onPress={(e) => e.stopPropagation()}>
          {badge ? <StatusBadge size={48} tone={badge.tone} icon={badge.icon} /> : null}
          <Text variant="sheetTitle" style={badge ? styles.titleAfterBadge : undefined}>{title}</Text>
          {message ? <Text variant="text" color="textSecondary" style={styles.message}>{message}</Text> : null}
          {children ? <View style={styles.children}>{children}</View> : null}
          <View style={[styles.actions, stacked && styles.actionsStacked]}>
            {hideCancel ? null : (
              <Button
                title={cancelLabel}
                variant="secondary"
                onPress={onCancel}
                disabled={loading}
                style={stacked ? undefined : styles.action}
              />
            )}
            <Button
              title={confirmLabel}
              variant={destructive ? "danger" : "primary"}
              onPress={onConfirm}
              loading={loading}
              style={stacked ? undefined : styles.action}
            />
          </View>
        </Pressable>
      </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  // E 21: the card sits 32 from each edge.
  backdrop: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing[8],
  },
  card: {
    width: "100%",
    backgroundColor: colors.surface,
    borderRadius: radius.modal,
    paddingTop: 22,
    paddingHorizontal: spacing[5],
    paddingBottom: 18,
  },
  titleAfterBadge: { marginTop: 14 },
  message: { marginTop: 6 },
  children: { marginTop: spacing[3] },
  actions: { flexDirection: "row", gap: 10, marginTop: spacing[5] },
  // Primary on top when stacked, the way a phone dialog reads.
  actionsStacked: { flexDirection: "column-reverse" },
  action: { flex: 1 },
  // The scrim lives here, not on the backdrop: the padding this layer adds
  // above the keyboard is dimmed too (an iOS floating keyboard leaves it visible).
  fill: { flex: 1, backgroundColor: colors.overlay },
});
