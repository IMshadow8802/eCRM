import { useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import Animated, { FadeIn, FadeInDown } from "react-native-reanimated";
import { LinearGradient } from "expo-linear-gradient";
import { StatusBar } from "expo-status-bar";
import { MaterialIcons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { login as loginRequest } from "../../api/authQueries";
import useAuthStore from "../../stores/useAuthStore";
import { colors, gradients, radius, spacing } from "../../theme";
import { Button, Input, Text } from "../../ui";
import FloatingShapes from "./FloatingShapes";

/** Anything the API didn't explain — network down, DNS, timeout. */
const FALLBACK_ERROR =
  "Could not reach the server. Check your connection and try again.";

export default function LoginScreen() {
  const setSession = useAuthStore((s) => s.login);
  const insets = useSafeAreaInsets();

  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // No disabled state on the button. A greyed-out control that never explains
  // itself is worse than one that tells you what is missing when you tap it.
  const submit = async () => {
    if (busy) return;

    if (!identifier.trim()) {
      setError("Enter your username, email or mobile.");
      return;
    }
    if (!password) {
      setError("Enter your password.");
      return;
    }

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
    <View style={styles.root}>
      <StatusBar style="light" />
      <LinearGradient
        colors={gradients.brand}
        start={{ x: 0.1, y: 0 }}
        end={{ x: 0.9, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <FloatingShapes />

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={[
            styles.scroll,
            {
              paddingTop: insets.top + spacing[10],
              paddingBottom: insets.bottom + spacing[5],
            },
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Type carries the screen — no card. A panel over a gradient just
              hides the thing that makes it look good. */}
          <Animated.View entering={FadeInDown.duration(500)} style={styles.head}>
            <View style={styles.mark}>
              <MaterialIcons
                name="dashboard"
                size={26}
                color={colors.textOnBrand}
              />
            </View>
            <Text variant="h1" color="textOnBrand" style={styles.hello}>
              Welcome back
            </Text>
            <Text variant="body" color="textOnBrandMuted">
              Sign in to continue to Nexus CRM
            </Text>
          </Animated.View>

          <Animated.View
            entering={FadeInDown.delay(120).duration(500)}
            style={styles.form}
          >
            <Input
              tone="onBrand"
              label="Username, email or mobile"
              value={identifier}
              onChangeText={(t) => {
                setIdentifier(t);
                if (error) setError(null);
              }}
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="username"
              placeholder="ayush · you@company.com"
              leftIcon="person-outline"
              editable={!busy}
            />

            <Input
              tone="onBrand"
              label="Password"
              value={password}
              onChangeText={(t) => {
                setPassword(t);
                if (error) setError(null);
              }}
              password
              autoCapitalize="none"
              autoComplete="password"
              placeholder="Your password"
              leftIcon="lock-outline"
              editable={!busy}
              onSubmitEditing={submit}
              returnKeyType="go"
            />

            {error ? (
              <Animated.View entering={FadeIn.duration(200)} style={styles.error}>
                <MaterialIcons
                  name="error-outline"
                  size={18}
                  color={colors.textOnBrand}
                />
                <Text
                  variant="caption"
                  color="textOnBrand"
                  style={styles.errorText}
                >
                  {error}
                </Text>
              </Animated.View>
            ) : null}

            <Button
              title="Sign in"
              variant="onBrand"
              onPress={submit}
              loading={busy}
              size="lg"
              fullWidth
              style={styles.submit}
            />
          </Animated.View>

          <Animated.View
            entering={FadeIn.delay(400).duration(600)}
            style={styles.footer}
          >
            <Text variant="caption" color="textOnBrand" align="center">
              PRD Infotech Pvt Ltd
            </Text>
            <Text variant="caption" color="textOnBrandMuted" align="center">
              Nexus CRM · v1.0.0
            </Text>
          </Animated.View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.primary },
  flex: { flex: 1 },
  scroll: {
    flexGrow: 1,
    justifyContent: "center",
    paddingHorizontal: spacing[6],
  },
  head: { gap: spacing[2], marginBottom: spacing[8] },
  mark: {
    width: 56,
    height: 56,
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceOnBrand,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing[4],
  },
  hello: { letterSpacing: -0.5 },
  form: { gap: spacing[4] },
  error: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
    backgroundColor: colors.danger,
    borderRadius: radius.base,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[3],
  },
  errorText: { flex: 1 },
  submit: { marginTop: spacing[2] },
  footer: { marginTop: spacing[10], gap: spacing[1] },
});
