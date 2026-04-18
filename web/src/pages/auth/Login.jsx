// src/pages/auth/Login.jsx
import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useSnackbar } from "notistack";
import { Helmet } from "react-helmet-async";
import { Box, Stack, Typography, Paper } from "@mui/material";
import { Eye, EyeOff, ArrowRight, Mail, LockKeyhole } from "lucide-react";

import useAuthStore from "../../stores/useAuthStore";
import useApi from "../../hooks/useApi";
import { Button, TextInput, Checkbox, IconButton } from "../../components/ui";

export default function Login() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const { login, isAuthenticated } = useAuthStore();
  const navigate = useNavigate();
  const { enqueueSnackbar } = useSnackbar();
  const apiClient = useApi();

  useEffect(() => {
    if (isAuthenticated) navigate("/dashboard");
  }, [isAuthenticated, navigate]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!username || !password) {
      enqueueSnackbar("Username or password field is empty", {
        variant: "error",
      });
      return;
    }
    setIsLoading(true);
    try {
      const response = await apiClient.post("/api/auth/loginUser", {
        username,
        password,
      });
      const responseData = response.data;
      if (responseData.success && responseData.responseCode === 200) {
        login(responseData.data);
        navigate("/dashboard");
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
            <Stack direction="row" alignItems="center" spacing={1.25}>
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

            <Box component="form" onSubmit={handleSubmit}>
              <Stack spacing={2}>
                <TextInput
                  label="Username"
                  name="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  disabled={isLoading}
                  required
                  autoComplete="username"
                  autoFocus
                  placeholder="your.handle"
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
                  alignItems="center"
                  justifyContent="space-between"
                  spacing={2}
                  sx={{ mt: 0.5 }}
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
