import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { enqueueSnackbar } from "notistack";

import {
  Modal,
  Button,
  TextInput,
  Tabs,
  Avatar,
} from "./ui";
import useAuthStore from "../stores/useAuthStore";
import { useApiMutation } from "../hooks/useApiMutation";
import {
  AVATAR_COLOR_KEYS,
  AVATAR_ICON_KEYS,
  AVATAR_ICONS,
  AVATAR_EMOJIS,
  AVATAR_COLORS,
  colorOf,
  parseAvatar,
  makeAvatar,
} from "../utils/avatarPresets";

const Swatch = ({ colorKey, active, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    aria-label={colorKey}
    data-testid={`swatch-${colorKey}`}
    style={{
      width: 24,
      height: 24,
      borderRadius: "50%",
      background: colorOf(colorKey),
      border: active ? "3px solid var(--color-surface-900)" : "2px solid var(--color-surface-0)",
      boxShadow: "0 0 0 1px var(--color-surface-200)",
      cursor: "pointer",
      padding: 0,
    }}
  />
);

function AvatarPicker({ value, onChange }) {
  const parsed = parseAvatar(value);
  const [mode, setMode] = useState(parsed?.kind === "emoji" ? "emoji" : "icon");
  const [colorKey, setColorKey] = useState(parsed?.colorKey || "violet");

  const chooseIcon = (iconKey) => onChange(makeAvatar("icon", iconKey, colorKey));
  const chooseColor = (c) => {
    setColorKey(c);
    // recolor the current icon if one is selected, else colored initials
    if (parsed?.kind === "icon") onChange(makeAvatar("icon", parsed.iconKey, c));
    else onChange(makeAvatar("color", c));
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <Avatar name="You" preset={value} size="xl" data-testid="account-avatar-preview" />
        <Tabs
          value={mode}
          onChange={setMode}
          items={[
            { value: "icon", label: "Icon" },
            { value: "emoji", label: "Emoji" },
          ]}
        />
      </div>

      {/* Color row applies to icon + colored-initials modes. */}
      {mode === "icon" && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {AVATAR_COLOR_KEYS.map((c) => (
            <Swatch
              key={c}
              colorKey={c}
              active={colorKey === c}
              onClick={() => chooseColor(c)}
            />
          ))}
        </div>
      )}

      {mode === "icon" ? (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(8, 1fr)",
            gap: 8,
          }}
        >
          {AVATAR_ICON_KEYS.map((k) => {
            const Icon = AVATAR_ICONS[k];
            const active = parsed?.kind === "icon" && parsed.iconKey === k;
            return (
              <button
                key={k}
                type="button"
                onClick={() => chooseIcon(k)}
                aria-label={k}
                data-testid={`icon-${k}`}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  height: 34,
                  borderRadius: 8,
                  cursor: "pointer",
                  color: "#fff",
                  background: active ? colorOf(colorKey) : "var(--color-surface-200)",
                  border: "none",
                }}
              >
                <Icon size={16} />
              </button>
            );
          })}
        </div>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(9, 1fr)",
            gap: 8,
          }}
        >
          {AVATAR_EMOJIS.map((e) => {
            const active = parsed?.kind === "emoji" && parsed.emoji === e;
            return (
              <button
                key={e}
                type="button"
                onClick={() => onChange(makeAvatar("emoji", e))}
                aria-label={e}
                data-testid={`emoji-${e}`}
                style={{
                  height: 34,
                  borderRadius: 8,
                  fontSize: 18,
                  cursor: "pointer",
                  background: active ? "var(--color-surface-200)" : "transparent",
                  border: "1px solid var(--color-surface-200)",
                }}
              >
                {e}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function AccountModal({ open, onClose }) {
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const updateUser = useAuthStore((s) => s.updateUser);

  const [tab, setTab] = useState("profile");
  const [fullName, setFullName] = useState(user?.FullName ?? "");
  const [avatar, setAvatar] = useState(user?.Avatar ?? "");
  const [email, setEmail] = useState(user?.Email ?? "");
  const [mobile, setMobile] = useState(user?.Mobile ?? "");
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");

  const profileMutation = useApiMutation({
    endpoint: "/api/users/me/updateProfile",
    showSuccessMessage: false,
  });
  const passwordMutation = useApiMutation({
    endpoint: "/api/users/me/changePassword",
    showSuccessMessage: false,
    showErrorMessage: false,
  });

  const saveProfile = async () => {
    if (!fullName.trim()) return;
    const patch = {
      FullName: fullName.trim(),
      Avatar: avatar,
      Email: email.trim(),
      Mobile: mobile.trim(),
    };
    try {
      await profileMutation.mutateAsync(patch);
      updateUser(patch);
      queryClient.invalidateQueries({ queryKey: ["userDirectory"] });
      enqueueSnackbar("Profile updated", { variant: "success" });
      onClose?.();
    } catch {
      /* mutation surfaces the error toast (e.g. email/mobile already in use) */
    }
  };

  const savePassword = async () => {
    if (!current || !next) return;
    if (next !== confirm) {
      enqueueSnackbar("New passwords do not match", { variant: "error" });
      return;
    }
    try {
      await passwordMutation.mutateAsync({
        CurrentPassword: current,
        NewPassword: next,
      });
      enqueueSnackbar("Password changed", { variant: "success" });
      setCurrent("");
      setNext("");
      setConfirm("");
      onClose?.();
    } catch (e) {
      enqueueSnackbar(
        e?.response?.data?.message || e?.message || "Could not change password",
        { variant: "error" },
      );
    }
  };

  return (
    <Modal open={open} onClose={onClose} size="md" data-testid="account-modal">
      <Modal.Header title="My Account" subtitle={user?.Username} onClose={onClose} />
      <Modal.Body>
        <Tabs
          value={tab}
          onChange={setTab}
          items={[
            { value: "profile", label: "Profile" },
            { value: "password", label: "Password" },
          ]}
        />
        <div style={{ marginTop: 16 }}>
          {tab === "profile" ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <TextInput
                label="Display name"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                required
                data-testid="account-fullname"
              />
              <TextInput
                label="Email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                data-testid="account-email"
              />
              <TextInput
                label="Mobile"
                value={mobile}
                onChange={(e) => setMobile(e.target.value)}
                placeholder="Mobile number"
                data-testid="account-mobile"
              />
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>
                  Avatar
                </div>
                <AvatarPicker value={avatar} onChange={setAvatar} />
              </div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <TextInput
                label="Current password"
                type="password"
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
                data-testid="account-current-pw"
              />
              <TextInput
                label="New password"
                type="password"
                value={next}
                onChange={(e) => setNext(e.target.value)}
                data-testid="account-new-pw"
              />
              <TextInput
                label="Confirm new password"
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                data-testid="account-confirm-pw"
              />
            </div>
          )}
        </div>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        {tab === "profile" ? (
          <Button
            variant="primary"
            onClick={saveProfile}
            disabled={!fullName.trim()}
            loading={profileMutation.isPending}
            data-testid="account-save-profile"
          >
            Save
          </Button>
        ) : (
          <Button
            variant="primary"
            onClick={savePassword}
            disabled={!current || !next || !confirm}
            loading={passwordMutation.isPending}
            data-testid="account-save-password"
          >
            Change password
          </Button>
        )}
      </Modal.Footer>
    </Modal>
  );
}
