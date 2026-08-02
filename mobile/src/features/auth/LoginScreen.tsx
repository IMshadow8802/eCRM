import { useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from "react-native";
import { MaterialIcons } from "@expo/vector-icons";

import { login as loginRequest } from "../../api/authQueries";
import useAuthStore from "../../stores/useAuthStore";
import { colors, radius, spacing } from "../../theme";
import { Button, Input, Screen, Text } from "../../ui";

/** Anything the API didn't explain — network down, DNS, timeout. */
const FALLBACK_ERROR =
  "Could not reach the server. Check your connection and try again.";

export default function LoginScreen() {
  const setSession = useAuthStore((s) => s.login);

  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const canSubmit = identifier.trim().length > 0 && password.length > 0;

  const submit = async () => {
    if (!canSubmit || busy) return;
    setBusy(true);
    setError(null);
    try {
      const body = await loginRequest({
        identifier: identifier.trim(),
        password,
      });
      if (body.success && body.data) {
        // The store hands the token to the api client; every later request
        // picks it up from the interceptor.
        setSession(body.data);
        return;
      }
      setError(body.message || "Login failed");
    } catch (err: any) {
      // A 401 here is a wrong password, not an expired session — the client's
      // shouldSkipAuthRedirect keeps it off the logout path, so showing the
      // server's message is safe.
      setError(err?.response?.data?.message ?? FALLBACK_ERROR);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen edgeTop edgeBottom>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.brand}>
            <View style={styles.mark}>
              <MaterialIcons name="dashboard" size={30} color={colors.textOnBrand} />
            </View>
            <Text variant="h1">Nexus CRM</Text>
            <Text variant="secondary">Sign in to your workspace</Text>
          </View>

          <Input
            label="Username, email or mobile"
            value={identifier}
            onChangeText={setIdentifier}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="username"
            placeholder="e.g. ayush or you@company.com"
            leftIcon="person-outline"
            editable={!busy}
          />

          <Input
            label="Password"
            value={password}
            onChangeText={setPassword}
            password
            autoCapitalize="none"
            autoComplete="password"
            placeholder="Your password"
            leftIcon="lock-outline"
            editable={!busy}
            onSubmitEditing={submit}
            returnKeyType="go"
            error={error}
          />

          <Button
            title="Sign in"
            onPress={submit}
            loading={busy}
            disabled={!canSubmit}
            fullWidth
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scroll: {
    flexGrow: 1,
    justifyContent: "center",
    paddingHorizontal: spacing[6],
    gap: spacing[4],
  },
  brand: { alignItems: "center", gap: spacing[1], marginBottom: spacing[6] },
  mark: {
    width: 64,
    height: 64,
    borderRadius: radius.lg,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing[3],
  },
});
