import { useEffect, useState } from "react";
import { useTheme } from "@mui/material/styles";
import { Link, useNavigate } from "react-router-dom";
import { Compass, ArrowLeft, RefreshCw, Home } from "lucide-react";

import useAuthStore from "../stores/useAuthStore";
import { firstAllowedPath } from "../utils/routeAccess";
import { EmptyState, Button } from "../components/ui";

/**
 * Shown for any route the app does not know, and built deliberately like its
 * sibling `NoAccess`: `EmptyState` + `ui/Button`, so it inherits the theme.
 *
 * It used to be the one page in the app written in raw Tailwind utilities
 * against Tailwind's own palette — `bg-white`, `text-gray-900` — which made it
 * a white slab with near-black text inside a dark shell, the only page that
 * ignored dark mode. It also carried a `<style jsx>` block; styled-jsx is not
 * a dependency here, so React 19 rendered it as a plain global `<style>` and
 * its keyframes leaked into every other page's stylesheet. And `min-h-screen`
 * inside `<main>` double-counted the TopNav, so a 376px page always scrolled.
 */
const NotFound = () => {
  const theme = useTheme();
  const p = theme.tokens;
  const navigate = useNavigate();
  const menuRights = useAuthStore((state) => state.menuRights);
  // Same trap as the old login redirect: "Go to Dashboard" dead-ends for anyone
  // without Dashboard rights. Send them to a page they can actually open.
  const home = firstAllowedPath(menuRights) ?? "/";
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    document.title = "404 - Page Not Found";
    const timer = setTimeout(() => setIsVisible(true), 100);
    return () => {
      document.title = "eCRM";
      clearTimeout(timer);
    };
  }, []);

  return (
    <div
      data-testid="not-found"
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 32,
        minHeight: "60vh",
        // The entrance, without a stylesheet: one transitioned inline value.
        opacity: isVisible ? 1 : 0,
        transform: isVisible ? "translateY(0)" : "translateY(8px)",
        transition: "opacity 400ms cubic-bezier(0.4,0,0.2,1), transform 400ms cubic-bezier(0.4,0,0.2,1)",
      }}
    >
      <EmptyState
        icon={<Compass size={32} />}
        title="Page Not Found"
        description="The page you're looking for doesn't exist or has been moved."
        size="lg"
        action={
          // The three actions wrap on a phone rather than sitting in one row
          // that runs off the side.
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center" }}>
            {/* A real <a>, not a button that navigates: middle-click and
                "open in new tab" have to work on the way out of a dead URL.
                ui/Button renders a <button> and is not polymorphic, so this
                one borrows the primary tokens directly. */}
            <Link
              to={home}
              data-testid="not-found-home"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                height: 40,
                paddingInline: 16,
                borderRadius: theme.radii.md,
                background: p.primary.main,
                color: p.primary.contrastText,
                fontSize: 14,
                fontWeight: 600,
                textDecoration: "none",
              }}
            >
              <Home size={16} />
              Go to my home page
            </Link>
            <Button variant="tonal" leftIcon={<ArrowLeft size={16} />} onClick={() => navigate(-1)}>
              Go Back
            </Button>
            <Button variant="ghost" leftIcon={<RefreshCw size={16} />} onClick={() => window.location.reload()}>
              Refresh
            </Button>
          </div>
        }
      />
    </div>
  );
};

export default NotFound;
