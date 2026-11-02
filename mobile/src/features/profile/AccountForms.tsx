// Self-service account edits — the phone's half of web/src/components/AccountModal.jsx.
import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useMutation } from "@tanstack/react-query";

import { apiErrorMessage } from "../../api/errors";
import { changeMyPassword, updateMyProfile } from "../../api/userQueries";
import useAuthStore from "../../stores/useAuthStore";
import { colors, radius, spacing } from "../../theme";
import { AVATAR_COLORS, AVATAR_ICONS, colorOf } from "../../ui/avatarPresets";
import { normalizeMobile } from "../../utils/mobile";
import { Avatar, Button, Card, Input, MobileInput, Text, useToast } from "../../ui";

/** "icon:rocket|blue" / "color:blue" → the keys the picker works in; anything else picks nothing. */
function parsePreset(value?: string | null): { icon: string | null; color: string | null } {
  const icon = /^icon:([^|]+)\|?(.*)$/.exec(value ?? "");
  if (icon) return { icon: icon[1]!, color: icon[2] || null };
  const color = /^color:(.+)$/.exec(value ?? "");
  return { icon: null, color: color ? color[1]! : null };
}

export function EditProfileForm({ onDone }: { onDone: () => void }) {
  const user = useAuthStore((s) => s.user);
  const updateUser = useAuthStore((s) => s.updateUser);
  const toast = useToast();

  const [fullName, setFullName] = useState(user?.FullName ?? "");
  const [email, setEmail] = useState(user?.Email ?? "");
  const [mobile, setMobile] = useState(user?.Mobile ?? "");
  const [preset, setPreset] = useState(() => parsePreset(user?.Avatar));
  const [error, setError] = useState<{ field: "name" | "mobile" | "form"; message: string } | null>(null);

  // An emoji or uploaded avatar the picker cannot show stays as it was until a pick replaces it.
  const avatar = preset.icon
    ? `icon:${preset.icon}|${preset.color ?? "violet"}`
    : preset.color
      ? `color:${preset.color}`
      : (user?.Avatar ?? null);

  const save = useMutation({
    mutationFn: (p: Parameters<typeof updateMyProfile>[0]) => updateMyProfile(p),
    onSuccess: (_r, sent) => {
      updateUser(sent);
      toast.success("Profile updated");
      onDone();
    },
    onError: (err) => setError({ field: "form", message: apiErrorMessage(err, "Could not save your profile.") }),
  });

  const submit = () => {
    const name = fullName.trim();
    if (!name) return setError({ field: "name", message: "Your name cannot be blank." });
    const digits = mobile.trim();
    if (digits && !normalizeMobile(digits)) {
      return setError({ field: "mobile", message: "A mobile number is ten digits." });
    }
    setError(null);
    // All four, always: sp_UpdateOwnProfile writes every column (ME-02).
    save.mutate({
      FullName: name,
      Email: email.trim() || null,
      Mobile: digits ? normalizeMobile(digits) : null,
      Avatar: avatar,
    });
  };

  return (
    <Card gap={4}>
      <View style={styles.preview}>
        <Avatar name={fullName} uri={avatar} size={56} />
      </View>
      <View style={styles.swatches}>
        {Object.entries(AVATAR_COLORS).map(([key, hex]) => (
          <Pressable
            key={key}
            accessibilityLabel={`Colour ${key}`}
            accessibilityState={{ selected: preset.color === key }}
            onPress={() => setPreset((p) => ({ ...p, color: key }))}
            style={[styles.swatch, { backgroundColor: hex }, preset.color === key && styles.picked]}
          />
        ))}
      </View>
      <View style={styles.swatches}>
        {Object.entries(AVATAR_ICONS).map(([key, Icon]) => {
          const on = preset.icon === key;
          return (
            <Pressable
              key={key}
              accessibilityLabel={`Icon ${key}`}
              accessibilityState={{ selected: on }}
              onPress={() => setPreset((p) => ({ icon: key, color: p.color ?? "violet" }))}
              style={[styles.iconCell, on && { backgroundColor: colorOf(preset.color ?? undefined) }]}
            >
              <Icon size={18} color={on ? colors.textOnBrand : colors.textSecondary} />
            </Pressable>
          );
        })}
      </View>

      <Input
        label="Display name"
        accessibilityLabel="Display name"
        required
        value={fullName}
        onChangeText={setFullName}
        error={error?.field === "name" ? error.message : null}
      />
      <Input
        label="Email"
        accessibilityLabel="Email"
        value={email}
        onChangeText={setEmail}
        keyboardType="email-address"
        autoCapitalize="none"
        placeholder="you@example.com"
      />
      <MobileInput
        label="Mobile"
        accessibilityLabel="Mobile"
        value={mobile}
        onChangeText={setMobile}
        error={error?.field === "mobile" ? error.message : null}
      />

      {error?.field === "form" ? <Text variant="caption" color="danger">{error.message}</Text> : null}
      <Button title="Save profile" onPress={submit} loading={save.isPending} fullWidth />
      <Button title="Cancel" variant="secondary" onPress={onDone} fullWidth />
    </Card>
  );
}

export function ChangePasswordForm({ onDone }: { onDone: () => void }) {
  const toast = useToast();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<{ field: "current" | "next" | "confirm" | "form"; message: string } | null>(null);

  const save = useMutation({
    mutationFn: (p: Parameters<typeof changeMyPassword>[0]) => changeMyPassword(p),
    onSuccess: () => {
      toast.success("Password changed");
      onDone();
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

  const fieldError = (f: "current" | "next" | "confirm") => (error?.field === f ? error.message : null);

  return (
    <Card gap={4}>
      <Input label="Current password" accessibilityLabel="Current password" password value={current} onChangeText={setCurrent} error={fieldError("current")} />
      <Input label="New password" accessibilityLabel="New password" password value={next} onChangeText={setNext} error={fieldError("next")} hint="At least 6 characters" />
      <Input label="Confirm new password" accessibilityLabel="Confirm new password" password value={confirm} onChangeText={setConfirm} error={fieldError("confirm")} />
      {error?.field === "form" ? <Text variant="caption" color="danger">{error.message}</Text> : null}
      <Button title="Save password" onPress={submit} loading={save.isPending} fullWidth />
      <Button title="Cancel" variant="secondary" onPress={onDone} fullWidth />
    </Card>
  );
}

const styles = StyleSheet.create({
  preview: { alignItems: "center" },
  swatches: { flexDirection: "row", flexWrap: "wrap", gap: spacing[2] },
  swatch: { width: spacing[7], height: spacing[7], borderRadius: radius.full },
  picked: { borderWidth: 3, borderColor: colors.text },
  iconCell: {
    width: spacing[10],
    height: spacing[10],
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surfacePressed,
  },
});
