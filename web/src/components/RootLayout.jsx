import { useEffect, useState } from "react";
import { Box, useMediaQuery } from "@mui/material";
import { useLocation } from "react-router-dom";
import TopNav from "./TopNav";
import Sidebar from "./Sidebar";
import useAuthStore from "../stores/useAuthStore";

const COLLAPSED_KEY = "sidebarCollapsed";

function RootLayout({ children }) {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const isMobile = useMediaQuery("(max-width:767.98px)");
  const isTablet = useMediaQuery(
    "(min-width:768px) and (max-width:1279.98px)",
  );
  const { pathname } = useLocation();

  // Login (and future auth) screens render full-bleed — no sidebar, no topnav,
  // no padding shell.
  const isAuthRoute = pathname === "/login";

  const [collapsed, setCollapsed] = useState(() => {
    const stored = localStorage.getItem(COLLAPSED_KEY);
    if (stored === "true") return true;
    if (stored === "false") return false;
    return isTablet;
  });

  useEffect(() => {
    if (localStorage.getItem(COLLAPSED_KEY) != null) return;
    setCollapsed(isTablet);
  }, [isTablet]);

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem(COLLAPSED_KEY, String(next));
      return next;
    });
  };

  const [mobileOpen, setMobileOpen] = useState(false);
  const openMobile = () => setMobileOpen(true);
  const closeMobile = () => setMobileOpen(false);

  if (isAuthRoute) {
    return <Box sx={{ minHeight: "100vh" }}>{children}</Box>;
  }

  return (
    <Box
      sx={{
        minHeight: "100vh",
        display: "flex",
        backgroundColor: "background.default",
      }}
    >
      {isAuthenticated && (
        <Sidebar
          collapsed={collapsed}
          onToggleCollapsed={toggleCollapsed}
          mobileOpen={mobileOpen}
          onMobileClose={closeMobile}
        />
      )}

      <Box
        sx={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          minWidth: 0,
        }}
      >
        {isAuthenticated && <TopNav onOpenMobileSidebar={openMobile} />}
        <Box
          component="main"
          sx={{
            flex: 1,
            overflowX: "hidden",
            overflowY: "auto",
            px: { xs: 1.5, md: 2.5 },
            py: 2,
          }}
        >
          {children}
        </Box>
      </Box>
    </Box>
  );
}

export default RootLayout;
