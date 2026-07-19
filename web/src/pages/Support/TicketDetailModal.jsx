import { Modal } from "../../components/ui";
import TicketDetail from "./TicketDetail";

/**
 * Ticket detail as a modal — opened from the board cards and the tickets
 * table, so the user never loses their place in the list/board. The full-page
 * route (/support/tickets/:id) stays for deep links.
 */
export default function TicketDetailModal({ ticketId, open, onClose }) {
  return (
    <Modal open={open} onClose={onClose} size="lg" data-testid="ticket-detail-modal">
      <Modal.Header title="Ticket details" onClose={onClose} />
      <Modal.Body>
        {open && ticketId ? <TicketDetail ticketId={ticketId} /> : null}
      </Modal.Body>
    </Modal>
  );
}
