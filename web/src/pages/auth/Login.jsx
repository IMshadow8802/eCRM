// src/pages/auth/Login.jsx
import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useSnackbar } from "notistack";
import { Helmet } from "react-helmet-async";
import { Box, Stack, Typography } from "@mui/material";
import { useQueryClient } from "@tanstack/react-query";
import {
  Eye, EyeOff, ArrowRight, Mail, LockKeyhole, Building2, CircleAlert, Repeat2,
} from "lucide-react";

import useAuthStore from "../../stores/useAuthStore";
import { loginUser } from "../../api/platformQueries";
import { fetchClientConfig } from "../../api/centralQueries";
import { firstAllowedPath } from "../../utils/routeAccess";
import { Button, TextInput, Checkbox, IconButton } from "../../components/ui";
import BrandPanel from "./BrandPanel";

/**
 * Errors here are shown in the form, not only in a snackbar.
 *
 * A toast that fades is the wrong instrument for a login page: it is the one
 * screen a user cannot navigate away from when they are stuck, and the reason
 * they are stuck has to stay on screen while they retype. The snackbar is kept
 * for the success case, where transience is the point.
 */
function FormError({ children }) {
  if (!children) return null;
  return (
    <Stack
      direction="row"
      spacing={1.25}
      role="alert"
      sx={{
        alignItems: "flex-start",
        px: 1.5,
        py: 1.25,
        borderRadius: 1.5,
        border: 1,
        borderColor: "error.main",
        bgcolor: "error.main",
        color: "error.contrastText",
      }}
    >
      <Box sx={{ display: "flex", pt: "1px" }}>
        <CircleAlert size={16} />
      </Box>
      <Typography sx={{ fontSize: 13, fontWeight: 600, lineHeight: 1.45 }}>
        {children}
      </Typography>
    </Stack>
  );
}

export default function Login() {
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const passwordRef = useRef(null);
  const [remember, setRemember] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  // Step 1 — which backend. Typed once per browser; persisted by the store.
  const [compCode, setCompCode] = useState("");
  const [isVerifying, setIsVerifying] = useState(false);
  const {
    login, isAuthenticated, menuRights,
    isClientConfigured, companyName, compCode: boundCode, logoURL,
    API_BASE_URL, setClientConfig, clearClientConfig,
  } = useAuthStore();
  const navigate = useNavigate();
  const { enqueueSnackbar } = useSnackbar();
  const queryClient = useQueryClient();

  const handleVerifyCompCode = async (event) => {
    event.preventDefault();
    const code = compCode.trim().toUpperCase();
    if (!code) {
      setError("Enter your company code.");
      return;
    }
    setIsVerifying(true);
    setError(null);
    try {
      const cfg = await fetchClientConfig(code);
      setClientConfig(cfg);
      enqueueSnackbar(`Connected to ${cfg.companyName ?? cfg.compCode}`, { variant: "success" });
    } catch (err) {
      setError(err?.message || "Could not verify the company code");
    } finally {
      setIsVerifying(false);
    }
  };

  // A different company is a different backend: drop cached data and session.
  const handleSwitchCompany = () => {
    queryClient.clear();
    clearClientConfig();
    setCompCode("");
    setIdentifier("");
    setPassword("");
    setError(null);
  };

  // Already signed in — bounce to whatever this user's first granted page is,
  // not a hardcoded /dashboard they may have no rights to. "/" resolves that
  // for us, so we don't need menuRights loaded to make the decision here.
  useEffect(() => {
    if (isAuthenticated) navigate(firstAllowedPath(menuRights) ?? "/", { replace: true });
  }, [isAuthenticated, menuRights, navigate]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!identifier || !password) {
      setError("Enter your username/email/mobile and password.");
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const response = await loginUser({ identifier, password });
      const responseData = response.data;
      if (responseData.success && responseData.responseCode === 200) {
        login(responseData.data);
        // Land on the first page this user's menu rights grant. The rights are
        // in the login response, so read them from there rather than waiting a
        // render for the store to settle.
        const rights = responseData.data?.permissions?.rawPermissions;
        navigate(firstAllowedPath(rights) ?? "/", { replace: true });
        enqueueSnackbar("Welcome back", { variant: "success" });
      } else {
        setError(responseData.message || "Invalid username or password");
      }
    } catch (err) {
      if (err.response) {
        setError(err.response.data?.message || "Invalid username or password");
      } else if (err.request) {
        setError("Network error. Check your connection.");
      } else {
        setError("Error logging in. Try again.");
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <>
      <Helmet>
        <title>{companyName ? `${companyName} — Sign in` : "CRM — Sign in"}</title>
      </Helmet>
      <Box
        sx={{
          minHeight: "100vh",
          display: "grid",
          // The brand panel is a column beside the form on a desktop and a
          // strip above it on a phone — never hidden. Whose CRM this is stays
          // answerable at every width.
          gridTemplateColumns: { xs: "1fr", md: "1.05fr 1fr" },
          bgcolor: "background.default",
        }}
      >
        <BrandPanel
          companyName={isClientConfigured ? companyName : null}
          compCode={isClientConfigured ? boundCode : null}
          baseURL={isClientConfigured ? API_BASE_URL : null}
          logoURL={isClientConfigured ? logoURL : null}
        />

        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            px: { xs: 3, sm: 5, lg: 8 },
            py: { xs: 5, md: 6 },
          }}
        >
          {/* Fixed width in both states, so binding a company does not resize
              or re-centre the column the user is typing into. */}
          <Box sx={{ width: "100%", maxWidth: 380 }}>
            {!isClientConfigured ? (
              <Stack spacing={3}>
                {/* No explanatory paragraph. The field is labelled, the button
                    says Continue, and that is the whole task. Whether the code
                    is remembered afterwards is our problem, not the user's. */}
                <Typography sx={{ fontSize: 26, fontWeight: 700, letterSpacing: "-0.03em", lineHeight: 1.2 }}>
                  Which company?
                </Typography>

                <Box component="form" onSubmit={handleVerifyCompCode} noValidate>
                  <Stack spacing={2}>
                    <TextInput
                      label="Company code"
                      name="compCode"
                      value={compCode}
                      onChange={(e) => {
                        setCompCode(e.target.value.toUpperCase());
                        if (error) setError(null);
                      }}
                      disabled={isVerifying}
                      required
                      autoComplete="off"
                      autoFocus
                      placeholder="e.g. PRD"
                      leftAdornment={<Building2 size={16} />}
                    />
                    <FormError>{error}</FormError>
                    <Button
                      type="submit"
                      variant="primary"
                      size="lg"
                      fullWidth
                      loading={isVerifying}
                      rightIcon={!isVerifying ? <ArrowRight size={16} /> : undefined}
                      sx={{ mt: 1 }}
                    >
                      {isVerifying ? "Checking…" : "Continue"}
                    </Button>
                  </Stack>
                </Box>
              </Stack>
            ) : (
              <Stack spacing={3}>
                {/* Which company you are bound to, and the way out of it. This
                    was a 13px text link buried mid-sentence; switching is rare
                    but it is the only escape from a mistyped code, so it gets
                    to be a control rather than prose. */}
                <Stack
                  data-testid="company-chip"
                  direction="row"
                  spacing={1.5}
                  sx={{
                    alignItems: "center",
                    justifyContent: "space-between",
                    px: 1.5,
                    py: 1,
                    borderRadius: 2,
                    border: 1,
                    borderColor: "divider",
                    bgcolor: "action.hover",
                  }}
                >
                  <Stack spacing={0} sx={{ minWidth: 0 }}>
                    <Typography sx={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.08em", color: "text.secondary" }}>
                      SIGNING IN TO
                    </Typography>
                    <Typography noWrap sx={{ fontSize: 14, fontWeight: 700, letterSpacing: "-0.01em" }}>
                      {companyName ?? boundCode ?? "this company"}
                    </Typography>
                  </Stack>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleSwitchCompany}
                    leftIcon={<Repeat2 size={14} />}
                    sx={{ flexShrink: 0 }}
                  >
                    Switch company
                  </Button>
                </Stack>

                <Typography sx={{ fontSize: 26, fontWeight: 700, letterSpacing: "-0.03em", lineHeight: 1.2 }}>
                  Sign in
                </Typography>

                {/* noValidate so the guard in handleSubmit is what actually runs.
                    With the browser's `required` check in front of it that guard
                    was unreachable, and empty fields produced a native tooltip
                    instead of the app's own message. */}
                <Box component="form" onSubmit={handleSubmit} noValidate>
                  <Stack spacing={2}>
                    <TextInput
                      label="Username / Email / Mobile"
                      name="identifier"
                      value={identifier}
                      onChange={(e) => {
                        setIdentifier(e.target.value);
                        if (error) setError(null);
                      }}
                      disabled={isLoading}
                      required
                      autoComplete="username"
                      autoFocus
                      placeholder="your.handle, email or mobile"
                      leftAdornment={<Mail size={16} />}
                      /*
                       * A <form> with two text inputs and a submit button submits
                       * on Enter from EITHER of them — that is the browser's
                       * implicit submission, not something this form asked for. So
                       * typing a username and pressing Enter, which is how most
                       * people fill a login form, submitted with an empty password
                       * and (the form being noValidate) got an error back.
                       * Enter here advances to the password instead; Enter from
                       * the password still submits, untouched.
                       */
                      onKeyDown={(e) => {
                        if (e.key !== "Enter") return;
                        e.preventDefault();
                        passwordRef.current?.focus();
                      }}
                    />

                    <TextInput
                      ref={passwordRef}
                      label="Password"
                      name="password"
                      type={showPassword ? "text" : "password"}
                      value={password}
                      onChange={(e) => {
                        setPassword(e.target.value);
                        if (error) setError(null);
                      }}
                      disabled={isLoading}
                      required
                      autoComplete="current-password"
                      placeholder="••••••••"
                      leftAdornment={<LockKeyhole size={16} />}
                      rightAdornment={
                        <IconButton
                          size="sm"
                          variant="ghost"
                          onClick={() => setShowPassword((v) => !v)}
                          tooltip={showPassword ? "Hide" : "Show"}
                          aria-label={showPassword ? "Hide password" : "Show password"}
                        >
                          {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                        </IconButton>
                      }
                    />

                    <FormError>{error}</FormError>

                    <Stack
                      direction="row"
                      spacing={2}
                      sx={{ alignItems: "center", justifyContent: "space-between", mt: 0.5 }}
                    >
                      <Checkbox
                        label="Remember me"
                        checked={remember}
                        onChange={(e) => setRemember(e.target.checked)}
                        size="sm"
                      />
                      <Typography
                        component="a"
                        href="#"
                        sx={{
                          fontSize: 13,
                          fontWeight: 600,
                          color: "primary.main",
                          textDecoration: "none",
                          "&:hover": { textDecoration: "underline" },
                        }}
                      >
                        Forgot password?
                      </Typography>
                    </Stack>

                    <Button
                      type="submit"
                      variant="primary"
                      size="lg"
                      fullWidth
                      loading={isLoading}
                      rightIcon={!isLoading ? <ArrowRight size={16} /> : undefined}
                      sx={{ mt: 1 }}
                    >
                      {isLoading ? "Signing in…" : "Sign in"}
                    </Button>
                  </Stack>
                </Box>
              </Stack>
            )}
          </Box>
        </Box>
      </Box>
    </>
  );
}
