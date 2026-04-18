import { useTheme } from "@mui/material/styles";
import { enqueueSnackbar } from "notistack";
import { MailCheck } from "lucide-react";

import { Modal, Button } from "../ui";
import { useApiMutation } from "../../hooks/useApiMutation";

/**
 * Lightweight accept/decline confirmation for a pending workspace invite.
 * The caller passes the workspace row; on success it fires `onResponded`
 * so the parent can refetch the switcher list.
 */
export default function InviteResponseModal({ workspace, onClose, onResponded }) {
  const theme = useTheme();
  const p = theme.tokens;
  const respondMutation = useApiMutation({
    endpoint: "/api/workspaces/respondInvite",
    showSuccessMessage: false,
  });

  const respond = async (Action) => {
    try {
      await respondMutation.mutateAsync({
        WorkspaceId: workspace.Id,
        Action,
      });
      enqueueSnackbar(
        Action === "accept" ? "Invite accepted" : "Invite declined",
        { variant: "success" },
      );
      onResponded?.(workspace, Action);
      onClose?.();
    } catch {
      // error toast from hook
    }
  };

  return (
    <Modal
      open={Boolean(workspace)}
      onClose={onClose}
      size="sm"
      data-testid="invite-response-modal"
    >
      <Modal.Header
        title={`Join "${workspace?.Name ?? ""}"?`}
        subtitle="The workspace owner has invited you as a member."
        icon={<MailCheck size={18} />}
        onClose={onClose}
      />
      <Modal.Body>
        <div style={{ fontSize: 14, color: p.text.secondary, lineHeight: 1.5 }}>
          Accepting grants you access to every task, column, and comment inside
          this workspace. Declining hides the invite for good.
        </div>
      </Modal.Body>
      <Modal.Footer>
        <Button
          variant="ghost"
          onClick={() => respond("decline")}
          loading={respondMutation.isPending}
          data-testid="invite-decline"
        >
          Decline
        </Button>
        <Button
          variant="primary"
          onClick={() => respond("accept")}
          loading={respondMutation.isPending}
          data-testid="invite-accept"
        >
          Accept invite
        </Button>
      </Modal.Footer>
    </Modal>
  );
}
