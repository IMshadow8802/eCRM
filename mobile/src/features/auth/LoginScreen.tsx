import { useState } from "react";
import {
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import Animated, { FadeIn, FadeInDown } from "react-native-reanimated";
import { LinearGradient } from "expo-linear-gradient";
import { StatusBar } from "expo-status-bar";
import { Building2, CircleAlert, LayoutDashboard, Lock, Repeat2, User } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { login as loginRequest } from "../../api/authQueries";
import { fetchClientConfig } from "../../api/centralQueries";
import useAuthStore from "../../stores/useAuthStore";
import { colors, gradients, radius, spacing } from "../../theme";
import { Button, Input, Text } from "../../ui";
import FloatingShapes from "./FloatingShapes";

/** Anything the API didn't explain — network down, DNS, timeout. */
const FALLBACK_ERROR =
  "Could not reach the server. Check your connection and try again.";

export default function LoginScreen() {
  const setSession = useAuthStore((s) => s.login);
  const isClientConfigured = useAuthStore((s) => s.isClientConfigured);
  const companyName = useAuthStore((s) => s.companyName);
  const boundCode = useAuthStore((s) => s.compCode);
  const logoURL = useAuthStore((s) => s.logoURL);
  const setClientConfig = useAuthStore((s) => s.setClientConfig);
  const clearClientConfig = useAuthStore((s) => s.clearClientConfig);
  const insets = useSafeAreaInsets();

  // Step 1 — which backend. Typed once per install; the store persists it.
  const [compCode, setCompCode] = useState("");
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // A dead LogoURL in Central must not leave a broken image on the sign-in
  // screen of every user at that company.
  const [logoBroken, setLogoBroken] = useState(false);

  const showLogo = isClientConfigured && Boolean(logoURL) && !logoBroken;

  const verifyCompany = async () => {
    if (busy) return;
    if (!compCode.trim()) {
      setError("Enter your company code.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      setClientConfig(await fetchClientConfig(compCode));
      setCompCode("");
    } catch (err: any) {
      setError(err?.message ?? FALLBACK_ERROR);
    } finally {
      setBusy(false);
    }
  };

  const switchCompany = () => {
    clearClientConfig();
    setLogoBroken(false);
    setIdentifier("");
    setPassword("");
    setError(null);
  };

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
              hides the thing that makes it look good.

              The mark is the tenant's logo once we know who they are. That is
              the payoff for typing a company code: the app becomes theirs,
              rather than showing the same generic tile to everyone. */}
          <Animated.View entering={FadeInDown.duration(500)} style={styles.head}>
            {showLogo ? (
              <Image
                source={{ uri: logoURL as string }}
                style={styles.logo}
                resizeMode="contain"
                accessibilityLabel={companyName ?? "Company logo"}
                onError={() => setLogoBroken(true)}
              />
            ) : (
              <View style={styles.mark}>
                <LayoutDashboard size={26} color={colors.textOnBrand} />
              </View>
            )}
            <Text variant="h1" color="textOnBrand" style={styles.hello}>
              {isClientConfigured
                ? (companyName ?? boundCode ?? "Welcome back")
                : "Which company?"}
            </Text>
          </Animated.View>

          {!isClientConfigured ? (
            <Animated.View
              entering={FadeInDown.delay(120).duration(500)}
              style={styles.form}
            >
              <Input
                tone="onBrand"
                label="Company code"
                value={compCode}
                onChangeText={(t) => {
                  setCompCode(t.toUpperCase());
                  if (error) setError(null);
                }}
                autoCapitalize="characters"
                autoCorrect={false}
                autoComplete="off"
                placeholder="e.g. PRD"
                leftIcon={Building2}
                editable={!busy}
                onSubmitEditing={verifyCompany}
                returnKeyType="go"
              />

              {error ? (
                <Animated.View entering={FadeIn.duration(200)} style={styles.error}>
                  <CircleAlert size={18} color={colors.textOnBrand} />
                  <Text variant="caption" color="textOnBrand" style={styles.errorText}>
                    {error}
                  </Text>
                </Animated.View>
              ) : null}

              <Button
                title="Continue"
                variant="onBrand"
                onPress={verifyCompany}
                loading={busy}
                fullWidth
                style={styles.submit}
              />
            </Animated.View>
          ) : (
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
              placeholder="Enter username, email or mobile"
              leftIcon={User}
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
              placeholder="Enter password"
              leftIcon={Lock}
              editable={!busy}
              onSubmitEditing={submit}
              returnKeyType="go"
            />

            {error ? (
              <Animated.View entering={FadeIn.duration(200)} style={styles.error}>
                <CircleAlert
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
              fullWidth
              style={styles.submit}
            />

            {/* A visible way out beats a secret gesture: switching company is
                rare, but it is the only escape from a mistyped code, so it gets
                to be a control rather than a line of small print. */}
            <Pressable
              onPress={switchCompany}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel="Switch company"
              style={styles.switchRow}
            >
              <Repeat2 size={16} color={colors.textOnBrandMuted} />
              <Text variant="caption" color="textOnBrandMuted">
                Not {companyName ?? boundCode ?? "this company"}? Switch company
              </Text>
            </Pressable>
          </Animated.View>
          )}

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
  head: { marginBottom: spacing[8] },
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
  logo: {
    width: 56,
    height: 56,
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceOnBrand,
    marginBottom: spacing[4],
  },
  switchRow: {
    marginTop: spacing[3],
    paddingVertical: spacing[2],
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing[2],
  },
  footer: { marginTop: spacing[10], gap: spacing[1] },
});
