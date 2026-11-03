import { useRef, useState, type ReactNode } from "react";
import { Image, KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { StatusBar } from "expo-status-bar";
import { ArrowRight, Building2, Hexagon, LogOut, Lock, OctagonAlert, User } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { login as loginRequest } from "../../api/authQueries";
import { fetchClientConfig } from "../../api/centralQueries";
import useAuthStore from "../../stores/useAuthStore";
import { colors, gradients, radius, spacing } from "../../theme";
import { Button, InfoNote, Input, StatusBadge, Text, useKeyboardOpen } from "../../ui";
import { appVersion } from "./appVersion";
import { REASONS, UNREACHABLE, loginError, type AuthError } from "./authMessages";

/** A field-level prompt (on the field) or a server answer (the box, E 03). */
type FormError = { field: "code" | "identifier" | "password"; message: string } | { box: AuthError };

/**
 * E 01–03. The gradient is the only one in the app; the form sits on a solid
 * white panel that rides the keyboard. Step 1 binds the company (Central),
 * step 2 signs in against that company's backend.
 */
export default function LoginScreen() {
  const setSession = useAuthStore((s) => s.login);
  const isClientConfigured = useAuthStore((s) => s.isClientConfigured);
  const companyName = useAuthStore((s) => s.companyName);
  const boundCode = useAuthStore((s) => s.compCode);
  const logoURL = useAuthStore((s) => s.logoURL);
  const setClientConfig = useAuthStore((s) => s.setClientConfig);
  const clearClientConfig = useAuthStore((s) => s.clearClientConfig);
  const sessionEndedReason = useAuthStore((s) => s.sessionEndedReason);
  const sessionEndedMessage = useAuthStore((s) => s.sessionEndedMessage);
  const insets = useSafeAreaInsets();
  const keyboardOpen = useKeyboardOpen();
  const scroller = useRef<ScrollView>(null);
  // The form is the foot of the scroll: with the keyboard up, show the foot,
  // so the field being typed in and the primary button are both above it.
  const keepFormInView = () => {
    if (keyboardOpen) scroller.current?.scrollToEnd({ animated: false });
  };

  const [compCode, setCompCode] = useState("");
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<FormError | null>(null);
  const [busy, setBusy] = useState(false);
  // A dead LogoURL in Central must not leave a broken image on every user's sign-in.
  const [logoBroken, setLogoBroken] = useState(false);

  const fieldError = (field: "code" | "identifier" | "password") =>
    error && "field" in error && error.field === field ? error.message : null;
  const box = error && "box" in error ? error.box : null;
  const typed = (set: (v: string) => void) => (v: string) => {
    set(v);
    if (error) setError(null);
  };

  const verifyCompany = async () => {
    if (busy) return;
    if (!compCode.trim()) return setError({ field: "code", message: "Enter your company code." });
    setBusy(true);
    setError(null);
    try {
      // Central's fetcher upper-cases; "Not case-sensitive" is its promise.
      setClientConfig(await fetchClientConfig(compCode.trim()));
      setCompCode("");
    } catch (err: any) {
      // Central's lookup always explains itself (centralQueries.ts).
      setError({ box: err?.message ? { title: err.message } : UNREACHABLE });
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

  // No disabled state on the button: one that tells you what is missing when
  // tapped beats a greyed-out control that never explains itself.
  const submit = async () => {
    if (busy) return;
    if (!identifier.trim()) return setError({ field: "identifier", message: "Enter your username, email or mobile." });
    if (!password) return setError({ field: "password", message: "Enter your password." });
    setBusy(true);
    setError(null);
    try {
      const body = await loginRequest({ identifier: identifier.trim(), password });
      if (body.success && body.data) {
        // The store hands the token to the api client.
        setSession(body.data);
        return;
      }
      setError({ box: { title: body.message || "Login failed" } });
    } catch (err) {
      // A 401 here is a wrong password, not an expired session: the client's
      // shouldSkipAuthRedirect keeps login off the logout path.
      setError({ box: loginError(err) });
    } finally {
      setBusy(false);
    }
  };

  const tenant = companyName ?? boundCode ?? null;
  const showLogo = Boolean(logoURL) && !logoBroken;
  const endedWhy = sessionEndedReason
    ? sessionEndedMessage || (REASONS[sessionEndedReason] ?? "Please sign in again.")
    : null;

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <LinearGradient
        colors={gradients.auth}
        start={gradients.authStart}
        end={gradients.authEnd}
        style={StyleSheet.absoluteFill}
      />
      {/* "padding" on Android too: edge-to-edge (forced from API 35) ignores
          adjustResize, so nothing else lifts the form over the keyboard. */}
      <KeyboardAvoidingView testID="login-keyboard" style={styles.flex} behavior="padding">
        <ScrollView
          ref={scroller}
          testID="login-scroll"
          onLayout={keepFormInView}
          onContentSizeChange={keepFormInView}
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          bounces={false}
        >
          {!isClientConfigured ? (
            // 01: the product, since we do not know the company yet.
            <View style={[styles.brand, { paddingTop: insets.top + 56 }]}>
              <View style={styles.logoTile}>
                <Hexagon size={32} color={colors.primary} />
              </View>
              <Text variant="display" color="textOnBrand" style={styles.productName}>Nexus CRM</Text>
              <Text variant="bodyLg" color="onBrandMuted" style={styles.tagline}>
                Tasks, complaints and leads for your whole team, in one place.
              </Text>
            </View>
          ) : (
            // 02: the tenant — the payoff for typing a company code.
            <View style={[styles.brand, styles.brandCenter, { paddingTop: insets.top + spacing[10] }]}>
              <View style={styles.logoFrame}>
                {showLogo ? (
                  <Image
                    source={{ uri: logoURL as string }}
                    style={styles.logo}
                    resizeMode="contain"
                    accessibilityLabel={companyName ?? "Company logo"}
                    onError={() => setLogoBroken(true)}
                  />
                ) : (
                  <StatusBadge testID="tenant-placeholder" tone="slate" icon={Building2} size={56} />
                )}
              </View>
              <Text variant="h1" color="textOnBrand" align="center" style={styles.tenant}>
                {tenant ?? "Welcome back"}
              </Text>
              {boundCode ? (
                <Text variant="text" color="onBrandMuted" align="center" style={styles.code}>
                  Company code {boundCode}
                </Text>
              ) : null}
            </View>
          )}

          <View
            testID="login-panel"
            style={[
              styles.panel,
              // The panel's minimum height is for the resting screen only; with
              // the keyboard up it would push the button below the fold.
              !keyboardOpen && (isClientConfigured ? styles.panelLogin : styles.panelCode),
              { paddingBottom: Math.max(44, insets.bottom + spacing[3]) },
            ]}
          >
            {!isClientConfigured ? (
              <>
                <Text variant="h1">Enter your company code</Text>
                <Text variant="text" color="textSecondary" style={styles.sub6}>
                  Your admin gives you this code. You only enter it once on this phone.
                </Text>
                {box ? <ErrorBox error={box} /> : null}
                <Input
                  label="Company code"
                  accessibilityLabel="Company code"
                  value={compCode}
                  onChangeText={typed(setCompCode)}
                  leftIcon={Building2}
                  hint="Not case-sensitive. Example: TestCRM"
                  error={fieldError("code")}
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="off"
                  autoFocus
                  editable={!busy}
                  onSubmitEditing={verifyCompany}
                  returnKeyType="go"
                  containerStyle={styles.firstField}
                />
                <Button title="Continue" trailingIcon={ArrowRight} onPress={verifyCompany} loading={busy} fullWidth style={styles.button} />
              </>
            ) : (
              <>
                <Text variant="h1">Sign in</Text>
                {box ? (
                  <ErrorBox error={box} />
                ) : (
                  <Text variant="text" color="textSecondary" style={styles.sub4}>
                    Use the username your admin set up for you.
                  </Text>
                )}
                {endedWhy && !box ? (
                  <View style={styles.notice}>
                    <InfoNote icon={LogOut}>{endedWhy}</InfoNote>
                  </View>
                ) : null}
                <Input
                  label="Username"
                  accessibilityLabel="Username"
                  value={identifier}
                  onChangeText={typed(setIdentifier)}
                  leftIcon={User}
                  error={fieldError("identifier")}
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="username"
                  editable={!busy}
                  containerStyle={box ? styles.fieldAfterBox : styles.firstFieldLogin}
                />
                <Input
                  label="Password"
                  accessibilityLabel="Password"
                  value={password}
                  onChangeText={typed(setPassword)}
                  password
                  leftIcon={Lock}
                  error={fieldError("password")}
                  // E 03: wrong credentials ring the password; the box above says why.
                  invalid={box?.code === "INVALID_CREDENTIALS"}
                  autoCapitalize="none"
                  autoComplete="password"
                  editable={!busy}
                  onSubmitEditing={submit}
                  returnKeyType="go"
                  containerStyle={styles.nextField}
                />
                <Button
                  title="Sign in"
                  onPress={submit}
                  loading={busy}
                  fullWidth
                  style={box ? styles.buttonAfterBox : styles.button}
                />
                {/* The only escape from a mistyped code, so a control, not small print. */}
                <Pressable
                  onPress={switchCompany}
                  disabled={busy}
                  accessibilityRole="button"
                  accessibilityLabel="Switch company"
                  hitSlop={spacing[3]}
                  style={box ? styles.switchAfterBox : styles.switch}
                >
                  <Text variant="text" color="textSecondary" align="center">
                    {`Not ${tenant ?? "this company"}? `}
                    <Text variant="rowTitle" color="primary">Switch company</Text>
                  </Text>
                </Pressable>
              </>
            )}
            <Footer>{appVersion()}</Footer>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

/** E 03: dangerSoft box, a red octagon badge, title + body in `dangerText`. Never only a toast. */
function ErrorBox({ error }: { error: AuthError }) {
  return (
    <View testID="auth-error" style={styles.errorBox} accessibilityRole="alert">
      <StatusBadge tone="red" icon={OctagonAlert} size={36} />
      <View style={styles.flex}>
        <Text variant="rowTitle" color="dangerText">{error.title}</Text>
        {error.body ? <Text variant="meta" color="dangerText" style={styles.errorBody}>{error.body}</Text> : null}
      </View>
    </View>
  );
}

function Footer({ children }: { children: ReactNode }) {
  return (
    <View style={styles.footer}>
      <Text variant="small" align="center">{children}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.primary },
  flex: { flex: 1 },
  scroll: { flexGrow: 1 },
  brand: { paddingHorizontal: spacing[7], paddingBottom: spacing[6] },
  brandCenter: { alignItems: "center" },
  logoTile: {
    width: 56,
    height: 56,
    borderRadius: radius.card,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  productName: { marginTop: spacing[6] },
  tagline: { marginTop: 6, maxWidth: 280 },
  logoFrame: {
    width: 72,
    height: 72,
    borderRadius: radius.sheet,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  logo: { width: 56, height: 56, borderRadius: radius.badgeLg },
  tenant: { marginTop: spacing[4] },
  code: { marginTop: spacing[1] },
  // E: absolute at the bottom, 420 / 540 tall. Here it sits at the foot of the
  // scroll with that as a minimum, so the keyboard pushes it up, never over it.
  panel: {
    marginTop: "auto",
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.modal,
    borderTopRightRadius: radius.modal,
    paddingTop: spacing[7],
    paddingHorizontal: spacing[5],
  },
  panelCode: { minHeight: 420 },
  panelLogin: { minHeight: 540 },
  sub6: { marginTop: 6 },
  sub4: { marginTop: spacing[1] },
  notice: { marginTop: spacing[4] },
  firstField: { marginTop: spacing[6] },
  firstFieldLogin: { marginTop: 22 },
  fieldAfterBox: { marginTop: spacing[4] },
  // E `.fl` keeps 12 under every field; the button adds its own 20 (16 after an error).
  nextField: { marginTop: spacing[3] },
  button: { marginTop: spacing[8] },
  buttonAfterBox: { marginTop: spacing[7] },
  switch: { marginTop: spacing[5] },
  switchAfterBox: { marginTop: 18 },
  errorBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing[3],
    marginTop: spacing[4],
    padding: spacing[3],
    borderRadius: radius.card,
    backgroundColor: colors.dangerSoft,
  },
  errorBody: { marginTop: 2 },
  footer: { marginTop: "auto", paddingTop: spacing[6] },
});
