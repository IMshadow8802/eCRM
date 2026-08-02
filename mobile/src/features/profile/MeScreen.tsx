import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { MaterialIcons } from "@expo/vector-icons";

import { logout as logoutRequest } from "../../api/authQueries";
import useAuthStore from "../../stores/useAuthStore";
import theme from "../../constants/theme";
import { getFontFamily } from "../../constants/fonts";

export default function MeScreen() {
  const user = useAuthStore((s) => s.user);
  const company = useAuthStore((s) => s.company);
  const clearSession = useAuthStore((s) => s.logout);

  const signOut = async () => {
    // Best-effort server call — the local session is dropped either way, so a
    // dead network can never strand someone in a signed-in state.
    try {
      await logoutRequest();
    } catch {
      // ignored on purpose
    }
    clearSession();
  };

  const initials = (user?.FullName ?? "?")
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");

  return (
    <ScrollView contentContainerStyle={styles.scroll}>
      <View style={styles.card}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{initials}</Text>
        </View>
        <Text style={styles.name}>{user?.FullName ?? "—"}</Text>
        {user?.JobTitle ? (
          <Text style={styles.meta}>{user.JobTitle}</Text>
        ) : null}
        {company?.CompName ? (
          <Text style={styles.meta}>{company.CompName}</Text>
        ) : null}
      </View>

      <View style={styles.rows}>
        {user?.Email ? <Row icon="mail-outline" label={user.Email} /> : null}
        {user?.Mobile ? <Row icon="phone-iphone" label={user.Mobile} /> : null}
        {user?.Username ? (
          <Row icon="person-outline" label={user.Username} />
        ) : null}
      </View>

      <Pressable style={styles.signOut} onPress={signOut}>
        <MaterialIcons name="logout" size={18} color={theme.colors.status.error} />
        <Text style={styles.signOutText}>Sign out</Text>
      </Pressable>
    </ScrollView>
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
      <MaterialIcons name={icon} size={18} color={theme.colors.gray[500]} />
      <Text style={styles.rowText}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: 20, gap: 16 },
  card: {
    alignItems: "center",
    backgroundColor: theme.colors.gray[50],
    borderRadius: 16,
    paddingVertical: 28,
  },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: theme.colors.primary.brand,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
  },
  avatarText: {
    color: "#fff",
    fontSize: 24,
    fontFamily: getFontFamily("semibold"),
  },
  name: {
    fontSize: 18,
    fontFamily: getFontFamily("semibold"),
    color: theme.colors.gray[900],
  },
  meta: {
    fontSize: 13,
    fontFamily: getFontFamily("regular"),
    color: theme.colors.gray[500],
    marginTop: 2,
  },
  rows: { gap: 2 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
    backgroundColor: theme.colors.gray[50],
    borderRadius: 12,
  },
  rowText: {
    fontSize: 14,
    fontFamily: getFontFamily("regular"),
    color: theme.colors.gray[700],
  },
  signOut: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.colors.status.error,
  },
  signOutText: {
    fontSize: 15,
    fontFamily: getFontFamily("semibold"),
    color: theme.colors.status.error,
  },
});
