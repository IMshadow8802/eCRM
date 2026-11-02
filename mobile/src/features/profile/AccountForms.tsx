// Self-service account edits — the phone's half of web/src/components/AccountModal.jsx.
import { useState, type RefObject } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useMutation } from "@tanstack/react-query";
import { Check, KeyRound } from "lucide-react-native";

import { apiErrorMessage } from "../../api/errors";
import { changeMyPassword } from "../../api/userQueries";
import { badgeTones, colors, radius, spacing } from "../../theme";
import { AVATAR_PRESET_TONE } from "../../ui/Avatar";
import { AVATAR_COLORS, AVATAR_ICONS } from "../../ui/avatarPresets";
import { ComposeSheet, FieldLabel, useToast, type SheetRef } from "../../ui";

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

/**
 * Change your own password (E 19's "Change password" row → spec §4 19: the
 * password ComposeSheet). Masked fields; the sheet resets on close, so a
 * closed sheet never keeps a typed password. Present it through the ref, which
 * goes straight to the ComposeSheet (React 19 passes `ref` as a prop).
 */
export function ChangePasswordSheet({ ref }: { ref: RefObject<SheetRef | null> }) {
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: (p: Parameters<typeof changeMyPassword>[0]) => changeMyPassword(p),
    onSuccess: () => {
      toast.success("Password changed");
      ref.current?.dismiss();
    },
    onError: (err) => setError(apiErrorMessage(err, "Could not change your password.")),
  });

  const submit = ({ current, next, confirm }: Record<string, string>) => {
    // The server's floor (userController.changeMyPassword).
    if ((next ?? "").length < 6) return setError("The new password needs at least 6 characters.");
    if (next !== confirm) return setError("The two new passwords do not match.");
    setError(null);
    save.mutate({ CurrentPassword: current ?? "", NewPassword: next ?? "" });
  };

  return (
    <ComposeSheet
      ref={ref}
      title="Change password"
      badge={{ tone: "slate", icon: KeyRound }}
      submitLabel="Save password"
      busy={save.isPending}
      error={error}
      fields={[
        { key: "current", label: "Current password", placeholder: "Your current password", secure: true, required: true },
        { key: "next", label: "New password", placeholder: "At least 6 characters", secure: true, required: true },
        { key: "confirm", label: "Confirm new password", placeholder: "Type it again", secure: true, required: true },
      ]}
      onSubmit={submit}
      onDismiss={() => setError(null)}
    />
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
});
