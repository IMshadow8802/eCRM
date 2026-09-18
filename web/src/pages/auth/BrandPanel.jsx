// src/pages/auth/BrandPanel.jsx
//
// The left half of the sign-in page — and, narrow, the strip across its top.
//
// It carries OUR brand, always: `gradient.loginPanel` from the design tokens,
// which is dark/light aware and defined in one place. What changes once Central
// answers is the *identity* on it — the company's logo, their name, and the
// backend their data lives on. The colour never changes.
//
// Central returns a PrimaryColor column. It is not for this app and nothing here
// reads it (2026-09-17). Do not wire it in: it is another product's field, and
// painting a page from it makes every tenant's login screen depend on a value
// no one here controls.
import { useState } from "react";
import { Box, Stack, Typography } from "@mui/material";
import { useTheme } from "@mui/material/styles";

/** `https://shadowcodes.in/SolarCRM` → `shadowcodes.in/SolarCRM`. */
const hostLabel = (url) => String(url ?? "").replace(/^https?:\/\//, "").replace(/\/$/, "");

export default function BrandPanel({
  companyName = null,
  compCode = null,
  baseURL = null,
  logoURL = null,
}) {
  const [logoBroken, setLogoBroken] = useState(false);
  const theme = useTheme();
  const name = companyName ?? "Nexus CRM";
  const showLogo = Boolean(logoURL) && !logoBroken;

  return (
    <Box
      data-testid="brand-panel"
      sx={{
        position: "relative",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        color: "#fff",
        background: theme.tokens.gradient.loginPanel,
        px: { xs: 3, md: 6, lg: 8 },
        py: { xs: 3, md: 6 },
        minHeight: { xs: "auto", md: "100vh" },
      }}
    >
      {/* A fine dot grid, barely visible, so a large flat panel has some
          surface to it instead of reading as printed card stock. */}
      <Box
        aria-hidden
        sx={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          backgroundImage:
            "radial-gradient(circle at 1px 1px, rgba(255,255,255,0.06) 1px, transparent 0)",
          backgroundSize: "22px 22px",
        }}
      />

      {/* One light source, behind the mark. A single off-centre glow gives the
          panel a direction; two competing ones just look like smudges. */}
      <Box
        aria-hidden
        sx={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          background:
            "radial-gradient(38rem 30rem at 8% 8%, rgba(129,140,248,0.28) 0%, transparent 60%)",
        }}
      />

      <Stack direction="row" spacing={1.5} sx={{ position: "relative", alignItems: "center" }}>
        {showLogo ? (
          <Box
            component="img"
            src={logoURL}
            alt={name}
            onError={() => setLogoBroken(true)}
            sx={{
              width: 44,
              height: 44,
              borderRadius: 2,
              objectFit: "contain",
              bgcolor: "#fff",
              p: 0.75,
            }}
          />
        ) : (
          <Box
            aria-hidden
            sx={{
              width: 44,
              height: 44,
              borderRadius: 2,
              bgcolor: "#fff",
              color: "primary.main",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              fontWeight: 800,
              fontSize: 20,
              letterSpacing: "-0.03em",
            }}
          >
            {name.trim().charAt(0).toUpperCase()}
          </Box>
        )}
        <Stack spacing={0.25}>
          <Typography sx={{ fontSize: 18, fontWeight: 700, letterSpacing: "-0.02em", lineHeight: 1.2 }}>
            {name}
          </Typography>
          <Typography sx={{ fontSize: 12, fontWeight: 600, opacity: 0.8 }}>
            {baseURL ? hostLabel(baseURL) : "One login, every company"}
            {compCode ? ` · ${compCode}` : ""}
          </Typography>
        </Stack>
      </Stack>

      {/* The three capability bullets that used to sit under this line are gone
          (2026-09-18). They were a pitch aimed at a buyer, on a screen only
          existing staff ever see. */}
      <Typography
        sx={{
          position: "relative",
          py: { xs: 3, md: 6 },
          maxWidth: 460,
          fontSize: { xs: 26, md: 38, lg: 44 },
          fontWeight: 800,
          letterSpacing: "-0.035em",
          lineHeight: 1.08,
        }}
      >
        Every complaint on a clock.
      </Typography>

      <Typography sx={{ position: "relative", fontSize: 12, fontWeight: 500, opacity: 0.75 }}>
        © PRD Infotech · Contact · Privacy
      </Typography>
    </Box>
  );
}
