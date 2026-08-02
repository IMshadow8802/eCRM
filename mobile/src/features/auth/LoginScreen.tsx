import { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { MaterialIcons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { login as loginRequest } from "../../api/authQueries";
import useAuthStore from "../../stores/useAuthStore";
import theme from "../../constants/theme";
import { getFontFamily } from "../../constants/fonts";

/** Anything the API didn't explain — network down, DNS, timeout. */
const FALLBACK_ERROR =
  "Could not reach the server. Check your connection and try again.";

export default function LoginScreen() {
  const setSession = useAuthStore((s) => s.login);
  const insets = useSafeAreaInsets();

  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const canSubmit = identifier.trim().length > 0 && password.length > 0 && !busy;

  const submit = async () => {
    if (!canSubmit) return;
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
      // shouldSkipAuthRedirect keeps it from triggering the logout path, so it
      // is safe to just show the server's message.
      setError(err?.response?.data?.message ?? FALLBACK_ERROR);
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingTop: insets.top + 48, paddingBottom: insets.bottom + 24 },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.brand}>
          <View style={styles.mark}>
            <MaterialIcons name="dashboard" size={30} color="#fff" />
          </View>
          <Text style={styles.title}>Nexus CRM</Text>
          <Text style={styles.subtitle}>Sign in to your workspace</Text>
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Username, email or mobile</Text>
          <TextInput
            style={styles.input}
            value={identifier}
            onChangeText={setIdentifier}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="username"
            placeholder="e.g. ayush or you@company.com"
            placeholderTextColor={theme.colors.gray[400]}
            returnKeyType="next"
            editable={!busy}
          />
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Password</Text>
          <View style={styles.passwordRow}>
            <TextInput
              style={[styles.input, styles.passwordInput]}
              value={password}
              onChangeText={setPassword}
              secureTextEntry={!showPassword}
              autoCapitalize="none"
              autoComplete="password"
              placeholder="••••••••"
              placeholderTextColor={theme.colors.gray[400]}
              returnKeyType="go"
              onSubmitEditing={submit}
              editable={!busy}
            />
            <Pressable
              style={styles.eye}
              onPress={() => setShowPassword((v) => !v)}
              hitSlop={8}
              accessibilityLabel={
                showPassword ? "Hide password" : "Show password"
              }
            >
              <MaterialIcons
                name={showPassword ? "visibility-off" : "visibility"}
                size={20}
                color={theme.colors.gray[500]}
              />
            </Pressable>
          </View>
        </View>

        {error ? (
          <View style={styles.errorBox}>
            <MaterialIcons
              name="error-outline"
              size={18}
              color={theme.colors.status.error}
            />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        <Pressable
          style={[styles.submit, !canSubmit && styles.submitDisabled]}
          onPress={submit}
          disabled={!canSubmit}
        >
          {busy ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.submitText}>Sign in</Text>
          )}
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: "#fff" },
  scroll: { paddingHorizontal: 24, flexGrow: 1, justifyContent: "center" },
  brand: { alignItems: "center", marginBottom: 40 },
  mark: {
    width: 64,
    height: 64,
    borderRadius: 18,
    backgroundColor: theme.colors.primary.brand,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  title: {
    fontSize: 24,
    fontFamily: getFontFamily("bold"),
    color: theme.colors.gray[900],
  },
  subtitle: {
    fontSize: 14,
    fontFamily: getFontFamily("regular"),
    color: theme.colors.gray[500],
    marginTop: 4,
  },
  field: { marginBottom: 18 },
  label: {
    fontSize: 13,
    fontFamily: getFontFamily("medium"),
    color: theme.colors.gray[700],
    marginBottom: 8,
  },
  input: {
    borderWidth: 1,
    borderColor: theme.colors.gray[300],
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontSize: 15,
    fontFamily: getFontFamily("regular"),
    color: theme.colors.gray[900],
    backgroundColor: "#fff",
  },
  passwordRow: { position: "relative", justifyContent: "center" },
  passwordInput: { paddingRight: 46 },
  eye: { position: "absolute", right: 14 },
  errorBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#FEF2F2",
    borderRadius: 10,
    padding: 12,
    marginBottom: 16,
  },
  errorText: {
    flex: 1,
    fontSize: 13,
    fontFamily: getFontFamily("regular"),
    color: "#B91C1C",
  },
  submit: {
    backgroundColor: theme.colors.primary.brand,
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: "center",
    marginTop: 4,
  },
  submitDisabled: { opacity: 0.5 },
  submitText: {
    color: "#fff",
    fontSize: 15,
    fontFamily: getFontFamily("semibold"),
  },
});
