// src/pages/auth/Login.jsx
import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useSnackbar } from "notistack";
import { Helmet } from "react-helmet-async";
import { Box, Stack, Typography, Paper } from "@mui/material";
import { Eye, EyeOff, ArrowRight, Mail, LockKeyhole } from "lucide-react";

import useAuthStore from "../../stores/useAuthStore";
import { loginUser } from "../../api/platformQueries";
import { firstAllowedPath } from "../../utils/routeAccess";
import { Button, TextInput, Checkbox, IconButton } from "../../components/ui";

export default function Login() {
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const { login, isAuthenticated, menuRights } = useAuthStore();
  const navigate = useNavigate();
  const { enqueueSnackbar } = useSnackbar();

  // Already signed in — bounce to whatever this user's first granted page is,
  // not a hardcoded /dashboard they may have no rights to. "/" resolves that
  // for us, so we don't need menuRights loaded to make the decision here.
  useEffect(() => {
    if (isAuthenticated) navigate(firstAllowedPath(menuRights) ?? "/", { replace: true });
  }, [isAuthenticated, menuRights, navigate]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!identifier || !password) {
      enqueueSnackbar("Enter your username/email/mobile and password", {
        variant: "error",
      });
      return;
    }
    setIsLoading(true);
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
        enqueueSnackbar(
          responseData.message || "Invalid username or password",
          { variant: "error" },
        );
      }
    } catch (error) {
      if (error.response) {
        enqueueSnackbar(
          error.response.data?.message || "Invalid username or password",
          { variant: "error" },
        );
      } else if (error.request) {
        enqueueSnackbar("Network error. Check your connection.", {
          variant: "error",
        });
      } else {
        enqueueSnackbar("Error logging in. Try again.", { variant: "error" });
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <>
      <Helmet>
        <title>CRM — Sign in</title>
      </Helmet>
      <Box
        sx={{
          minHeight: "100vh",
          width: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          px: 2,
          bgcolor: "background.default",
        }}
      >
        <Paper
          elevation={0}
          sx={{
            width: "100%",
            maxWidth: 420,
            p: { xs: 3, sm: 4 },
            borderRadius: 2,
            border: 1,
            borderColor: "divider",
            backgroundColor: "background.paper",
          }}
        >
          <Stack spacing={3}>
            {/* Brand mark */}
            <Stack direction="row" spacing={1.25} sx={{
              alignItems: "center"
            }}>
              <Box
                sx={{
                  width: 32,
                  height: 32,
                  borderRadius: 1.5,
                  bgcolor: "primary.main",
                  color: "primary.contrastText",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontWeight: 700,
                  fontSize: 14,
                  letterSpacing: "-0.02em",
                }}
              >
                C
              </Box>
              <Typography
                sx={{ fontSize: 15, fontWeight: 700, letterSpacing: "-0.01em" }}
              >
                CRM
              </Typography>
            </Stack>

            <Stack spacing={0.5}>
              <Typography
                sx={{
                  fontSize: 22,
                  fontWeight: 700,
                  letterSpacing: "-0.02em",
                  lineHeight: 1.25,
                }}
              >
                Sign in to your account
              </Typography>
              <Typography
                sx={{ fontSize: 13, color: "text.secondary", fontWeight: 500 }}
              >
                Enter your credentials to continue.
              </Typography>
            </Stack>

            {/* noValidate so the guard in handleSubmit is what actually runs.
                With the browser's `required` check in front of it that guard
                was unreachable, and empty fields produced a native tooltip
                instead of the app's own snackbar. */}
            <Box component="form" onSubmit={handleSubmit} noValidate>
              <Stack spacing={2}>
                <TextInput
                  label="Username / Email / Mobile"
                  name="identifier"
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  disabled={isLoading}
                  required
                  autoComplete="username"
                  autoFocus
                  placeholder="your.handle, email or mobile"
                  leftAdornment={<Mail size={16} />}
                />

                <TextInput
                  label="Password"
                  name="password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
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
                      aria-label={
                        showPassword ? "Hide password" : "Show password"
                      }
                    >
                      {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                    </IconButton>
                  }
                />

                <Stack
                  direction="row"
                  spacing={2}
                  sx={{
                    alignItems: "center",
                    justifyContent: "space-between",
                    mt: 0.5
                  }}>
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
                  rightIcon={
                    !isLoading ? <ArrowRight size={16} /> : undefined
                  }
                  sx={{ mt: 1 }}
                >
                  {isLoading ? "Signing in…" : "Sign in"}
                </Button>
              </Stack>
            </Box>
          </Stack>
        </Paper>
      </Box>
      <Typography
        component="div"
        sx={{
          position: "fixed",
          bottom: 16,
          left: 0,
          right: 0,
          textAlign: "center",
          fontSize: 12,
          fontWeight: 500,
          color: "text.secondary",
        }}
      >
        © PRD Infotech · Contact · Privacy
      </Typography>
    </>
  );
}
