import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { useMutation } from "@tanstack/react-query";
import type { StackScreenProps } from "@react-navigation/stack";

import { apiErrorMessage } from "../../api/errors";
import { updateMyProfile } from "../../api/userQueries";
import type { RootStackParamList } from "../../navigation/RootNavigator";
import useAuthStore from "../../stores/useAuthStore";
import { metrics } from "../../theme";
import { normalizeMobile } from "../../utils/mobile";
import { Avatar, Band, BandSheet, Card, Dialog, HeaderButton, Input, MobileInput, Screen, Text, useToast } from "../../ui";
import { AvatarPicker, parsePreset, presetValue } from "./AccountForms";

type Props = StackScreenProps<RootStackParamList, "Me">;

/**
 * Your own profile (no E frame; spec §4.1 19, proposed): the profile band with
 * the avatar, and the form on a card with Save in the band (16's pattern).
 * Password and sign-out live on More.
 */
export default function MeScreen({ navigation }: Props) {
  const user = useAuthStore((s) => s.user);
  const userId = useAuthStore((s) => s.UserId);
  const updateUser = useAuthStore((s) => s.updateUser);
  const toast = useToast();

  const [fullName, setFullName] = useState(user?.FullName ?? "");
  const [email, setEmail] = useState(user?.Email ?? "");
  const [mobile, setMobile] = useState(user?.Mobile ?? "");
  const [preset, setPreset] = useState(() => parsePreset(user?.Avatar));
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);
  const [error, setError] = useState<{ field: "name" | "mobile" | "form"; message: string } | null>(null);

  const avatar = presetValue(preset, user?.Avatar ?? null);

  const save = useMutation({
    mutationFn: (p: Parameters<typeof updateMyProfile>[0]) => updateMyProfile(p),
    onSuccess: (_r, sent) => {
      updateUser(sent);
      toast.success("Profile updated");
      navigation.goBack();
    },
    onError: (err) => setError({ field: "form", message: apiErrorMessage(err, "Could not save your profile.") }),
  });

  const submit = () => {
    const name = fullName.trim();
    if (!name) return setError({ field: "name", message: "Your name cannot be blank." });
    const digits = mobile.trim();
    if (digits && !normalizeMobile(digits)) return setError({ field: "mobile", message: "A mobile number is ten digits." });
    setError(null);
    // All four, always: sp_UpdateOwnProfile writes every column (ME-02).
    save.mutate({
      FullName: name,
      Email: email.trim() || null,
      Mobile: digits ? normalizeMobile(digits) : null,
      Avatar: avatar,
    });
  };

  const dirty =
    fullName !== (user?.FullName ?? "") ||
    email !== (user?.Email ?? "") ||
    mobile !== (user?.Mobile ?? "") ||
    avatar !== (user?.Avatar ?? null);
  const back = () => (dirty ? setConfirmingDiscard(true) : navigation.goBack());

  return (
    <Screen band>
      <Band
        variant="profile"
        align="center"
        title="Profile"
        onBack={back}
        actions={<HeaderButton label="Save" onPress={submit} disabled={save.isPending} />}
      >
        <View style={styles.avatar}>
          <Avatar name={fullName || user?.FullName} uri={avatar} userId={userId} size={88} ring="bandField" />
        </View>
        <Text variant="recordTitle" color="textOnBrand" align="center" style={styles.name}>
          {user?.FullName ?? "—"}
        </Text>
      </Band>
      <BandSheet scroll>
        <Card gap={4}>
          <AvatarPicker value={preset} onChange={setPreset} />
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
          {error?.field === "form" ? <Text variant="label" color="dangerText">{error.message}</Text> : null}
        </Card>
      </BandSheet>
      <Dialog
        visible={confirmingDiscard}
        title="Discard changes?"
        message="Your edits to your profile are not saved."
        confirmLabel="Discard"
        cancelLabel="Keep editing"
        destructive
        onConfirm={() => {
          setConfirmingDiscard(false);
          navigation.goBack();
        }}
        onCancel={() => setConfirmingDiscard(false)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  avatar: { marginTop: metrics.sheetPadTop },
  name: { marginTop: 12 },
});
