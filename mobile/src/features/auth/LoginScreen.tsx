import { useEffect, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import Animated, {
  FadeInDown,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import { LinearGradient } from "expo-linear-gradient";
import { StatusBar } from "expo-status-bar";
import { MaterialIcons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { login as loginRequest } from "../../api/authQueries";
import useAuthStore from "../../stores/useAuthStore";
import { colors, gradients, radius, shadows, spacing } from "../../theme";
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

  // Card entrance. Spring rather than timing so it settles instead of stopping.
  const enter = useSharedValue(0);
  useEffect(() => {
    enter.value = withSpring(1, { damping: 14, stiffness: 120 });
  }, [enter]);

  const cardStyle = useAnimatedStyle(() => ({
    opacity: enter.value,
    transform: [{ scale: 0.92 + 0.08 * enter.value }],
  }));

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
    <View style={styles.root}>
      <StatusBar style="light" />
      <LinearGradient
        colors={gradients.brand}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
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
              paddingTop: insets.top + spacing[8],
              paddingBottom: insets.bottom + spacing[6],
            },
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Animated.View entering={FadeInDown.duration(500)} style={styles.brand}>
            <View style={styles.mark}>
              <MaterialIcons
                name="dashboard"
                size={32}
                color={colors.textOnBrand}
              />
            </View>
            <Text variant="h1" color="textOnBrand">
              Nexus CRM
            </Text>
          </Animated.View>

          <Animated.View style={[styles.card, cardStyle]}>
            <View style={styles.cardHead}>
              <Text variant="h2">Welcome back</Text>
              <Text variant="secondary">Sign in to continue</Text>
            </View>

            <Input
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
              <Animated.View
                entering={FadeInDown.duration(200)}
                style={styles.error}
              >
                <MaterialIcons
                  name="error-outline"
                  size={18}
                  color={colors.danger}
                />
                <Text variant="caption" color="danger" style={styles.errorText}>
                  {error}
                </Text>
              </Animated.View>
            ) : null}

            <Button
              title="Sign in"
              onPress={submit}
              loading={busy}
              disabled={!canSubmit}
              size="lg"
              fullWidth
            />
          </Animated.View>

          <Text
            variant="caption"
            color="textOnBrand"
            align="center"
            style={styles.footer}
          >
            Nexus CRM · Sales, Support and Tasks
          </Text>
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
    paddingHorizontal: spacing[5],
  },
  brand: { alignItems: "center", gap: spacing[3], marginBottom: spacing[6] },
  mark: {
    width: 72,
    height: 72,
    borderRadius: radius.xl,
    backgroundColor: colors.surfaceOnBrand,
    alignItems: "center",
    justifyContent: "center",
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius["2xl"],
    padding: spacing[5],
    gap: spacing[4],
    ...shadows.lg,
  },
  cardHead: { gap: spacing[1], marginBottom: spacing[1] },
  error: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
    backgroundColor: colors.dangerSoft,
    borderRadius: radius.base,
    padding: spacing[3],
  },
  errorText: { flex: 1 },
  footer: { marginTop: spacing[6], opacity: 0.7 },
});
