import { useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { MaterialIcons } from "@expo/vector-icons";

import { logout as logoutRequest } from "../../api/authQueries";
import useAuthStore from "../../stores/useAuthStore";
import { colors, radius, spacing } from "../../theme";
import { Avatar, Button, Card, Dialog, Divider, Screen, Text } from "../../ui";

export default function MeScreen() {
  const user = useAuthStore((s) => s.user);
  const company = useAuthStore((s) => s.company);
  const clearSession = useAuthStore((s) => s.logout);

  const [confirming, setConfirming] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  const signOut = async () => {
    setSigningOut(true);
    // Best-effort server call — the local session is dropped either way, so a
    // dead network can never strand someone in a signed-in state.
    try {
      await logoutRequest();
    } catch {
      // ignored on purpose
    }
    setSigningOut(false);
    setConfirming(false);
    clearSession();
  };

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Card style={styles.identity}>
          <Avatar name={user?.FullName} uri={user?.Avatar} size={72} />
          <Text variant="h2">{user?.FullName ?? "—"}</Text>
          {user?.JobTitle ? <Text variant="secondary">{user.JobTitle}</Text> : null}
          {company?.CompName ? (
            <Text variant="secondary">{company.CompName}</Text>
          ) : null}
        </Card>

        <Card padded={false}>
          {user?.Email ? <Row icon="mail-outline" label={user.Email} /> : null}
          {user?.Email && user?.Mobile ? <Divider inset /> : null}
          {user?.Mobile ? <Row icon="phone-iphone" label={user.Mobile} /> : null}
          {user?.Mobile && user?.Username ? <Divider inset /> : null}
          {user?.Username ? <Row icon="badge" label={user.Username} /> : null}
        </Card>

        <Button
          title="Sign out"
          variant="danger"
          icon="logout"
          onPress={() => setConfirming(true)}
          fullWidth
        />
      </ScrollView>

      <Dialog
        visible={confirming}
        title="Sign out?"
        message="You will need your password to sign back in."
        confirmLabel="Sign out"
        destructive
        loading={signingOut}
        onConfirm={signOut}
        onCancel={() => setConfirming(false)}
      />
    </Screen>
  );
}

function Row({
  icon,
  label,
}: {
  icon: keyof typeof MaterialIcons.glyphMap;
  label: string;
}) {
  return (
    <View style={styles.row}>
      <MaterialIcons name={icon} size={18} color={colors.textSecondary} />
      <Text variant="body">{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: spacing[4], gap: spacing[4] },
  identity: {
    alignItems: "center",
    gap: spacing[1],
    paddingVertical: spacing[6],
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.lg,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[4],
  },
});
