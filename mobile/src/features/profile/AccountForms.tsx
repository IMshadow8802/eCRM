// Self-service account edits — the phone's half of web/src/components/AccountModal.jsx.
import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useMutation } from "@tanstack/react-query";
import { Check, KeyRound } from "lucide-react-native";

import { apiErrorMessage } from "../../api/errors";
import { changeMyPassword } from "../../api/userQueries";
import { badgeTones, colors, radius, spacing } from "../../theme";
import { AVATAR_PRESET_TONE } from "../../ui/Avatar";
import { AVATAR_COLORS, AVATAR_ICONS } from "../../ui/avatarPresets";
import { Dialog, FieldLabel, Input, Text, useToast } from "../../ui";

export interface AvatarPreset {
  icon: string | null;
  color: string | null;
}

/** "icon:rocket|blue" / "color:blue" → the keys the picker works in; anything else picks nothing. */
export function parsePreset(value?: string | null): AvatarPreset {
  const icon = /^icon:([^|]+)\|?(.*)$/.exec(value ?? "");
  if (icon) return { icon: icon[1]!, color: icon[2] || null };
  const color = /^color:(.+)$/.exec(value ?? "");
  return { icon: null, color: color ? color[1]! : null };
}

/** The stored string for a pick; an emoji or uploaded avatar the picker cannot show stays as it was. */
export const presetValue = (p: AvatarPreset, current: string | null): string | null =>
  p.icon ? `icon:${p.icon}|${p.color ?? "violet"}` : p.color ? `color:${p.color}` : current;

/** A colour key → the sorbet tone the Avatar draws it in, so the swatch is what you get. */
const toneOf = (key: string | null) => badgeTones[AVATAR_PRESET_TONE[key ?? "violet"] ?? "lilac"];

/** Colour swatches, then icons (tblUser.Avatar presets, shared with the web picker). */
export function AvatarPicker({ value, onChange }: { value: AvatarPreset; onChange: (p: AvatarPreset) => void }) {
  return (
    <View style={styles.picker}>
      <FieldLabel label="Avatar" />
      <View style={styles.swatches}>
        {Object.keys(AVATAR_COLORS).map((key) => {
          const on = value.color === key;
          const tone = toneOf(key);
          return (
            <Pressable
              key={key}
              accessibilityLabel={`Colour ${key}`}
              accessibilityState={{ selected: on }}
              onPress={() => onChange({ ...value, color: key })}
              style={[styles.cell, { backgroundColor: tone.fill }]}
            >
              {on ? <Check size={18} color={tone.ink} strokeWidth={3} /> : null}
            </Pressable>
          );
        })}
      </View>
      <View style={styles.swatches}>
        {Object.entries(AVATAR_ICONS).map(([key, Icon]) => {
          const on = value.icon === key;
          const tone = toneOf(value.color);
          return (
            <Pressable
              key={key}
              accessibilityLabel={`Icon ${key}`}
              accessibilityState={{ selected: on }}
              onPress={() => onChange({ icon: key, color: value.color ?? "violet" })}
              style={[styles.cell, { backgroundColor: on ? tone.fill : colors.fieldTint }]}
            >
              <Icon size={18} color={on ? tone.ink : colors.textSecondary} />
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

type PasswordField = "current" | "next" | "confirm" | "form";

/**
 * Change your own password (E 19's "Change password" row). A dialog, not a
 * ComposeSheet: ComposeSheet's fields cannot be masked.
 */
export function ChangePasswordDialog({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  // Mounted only while open, so a closed dialog never keeps a typed password.
  return visible ? <ChangePasswordPrompt onClose={onClose} /> : null;
}

function ChangePasswordPrompt({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<{ field: PasswordField; message: string } | null>(null);

  const save = useMutation({
    mutationFn: (p: Parameters<typeof changeMyPassword>[0]) => changeMyPassword(p),
    onSuccess: () => {
      toast.success("Password changed");
      onClose();
    },
    onError: (err) => setError({ field: "form", message: apiErrorMessage(err, "Could not change your password.") }),
  });

  const submit = () => {
    if (!current) return setError({ field: "current", message: "Enter your current password." });
    // The server's floor (userController.changeMyPassword).
    if (next.length < 6) return setError({ field: "next", message: "At least 6 characters." });
    if (next !== confirm) return setError({ field: "confirm", message: "The two new passwords do not match." });
    setError(null);
    save.mutate({ CurrentPassword: current, NewPassword: next });
  };

  const fieldError = (f: PasswordField) => (error?.field === f ? error.message : null);

  return (
    <Dialog
      visible
      title="Change password"
      badge={{ tone: "slate", icon: KeyRound }}
      confirmLabel="Save password"
      loading={save.isPending}
      onConfirm={submit}
      onCancel={onClose}
    >
      <View style={styles.fields}>
        <Input label="Current password" accessibilityLabel="Current password" password value={current} onChangeText={setCurrent} error={fieldError("current")} autoFocus />
        <Input label="New password" accessibilityLabel="New password" password value={next} onChangeText={setNext} error={fieldError("next")} hint="At least 6 characters" />
        <Input label="Confirm new password" accessibilityLabel="Confirm new password" password value={confirm} onChangeText={setConfirm} error={fieldError("confirm")} />
        {error?.field === "form" ? <Text variant="label" color="dangerText">{error.message}</Text> : null}
      </View>
    </Dialog>
  );
}

const styles = StyleSheet.create({
  picker: { gap: spacing[2] },
  swatches: { flexDirection: "row", flexWrap: "wrap", gap: spacing[2] },
  cell: {
    width: spacing[10],
    height: spacing[10],
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
  },
  fields: { gap: spacing[3] },
});
