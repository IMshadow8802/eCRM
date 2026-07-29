import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ShieldOff } from "lucide-react";

import useAuthStore from "../stores/useAuthStore";
import { firstAllowedPath } from "../utils/routeAccess";
import { EmptyState, Button } from "../components/ui";

/**
 * Shown in place of a page the user's menu rights do not grant.
 *
 * Deliberately rendered instead of redirecting: a silent bounce makes people
 * think the app is broken or that they mistyped. The URL stays put so they can
 * see what they asked for and read why it was refused.
 */
export default function NoAccess() {
  const location = useLocation();
  const navigate = useNavigate();
  const menuRights = useAuthStore((s) => s.menuRights);
  const home = firstAllowedPath(menuRights);

  useEffect(() => {
    document.title = "No access";
    return () => {
      document.title = "eCRM";
    };
  }, []);

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 32,
        minHeight: "60vh",
      }}
      data-testid="no-access"
    >
      <EmptyState
        icon={<ShieldOff size={32} />}
        title="You don't have access to this page"
        description={
          home
            ? `Your role doesn't include ${location.pathname}. If you need it, ask an administrator to grant it under Roles & Permissions.`
            : `Your role doesn't include ${location.pathname}, and you have no other pages assigned yet. Ask an administrator to set up your access.`
        }
        size="lg"
        action={
          home ? (
            <Button
              variant="primary"
              onClick={() => navigate(home, { replace: true })}
              data-testid="no-access-home"
            >
              Go to my home page
            </Button>
          ) : null
        }
      />
    </div>
  );
}
