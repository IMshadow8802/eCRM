import { memo } from "react";
import { ChevronsUp, CircleCheck, CirclePause, Phone } from "lucide-react-native";

import { complaintBadge, priorityChip } from "../../theme";
import type { Ticket } from "../../types/api";
import { ListRow, SwipeRow, type ChipProps, type SwipeAction } from "../../ui";
import { isTerminal, lifecycleOf, rowDue } from "./ticketHelpers";

export type RowAction = "call" | "hold" | "resolve" | "escalate";

export interface ComplaintRowProps {
  ticket: Ticket;
  onPress: (ticket: Ticket) => void;
  /** Swipe blocks (E 22). Each only OPENS a sheet (or the dialler); nothing writes on a swipe. */
  onAction?: (action: RowAction, ticket: Ticket) => void;
  /** The edit grant: without it only Call (not a write) is offered. */
  canWrite?: boolean;
  /** The company has an on-hold status. */
  canHold?: boolean;
  selected?: boolean;
  first?: boolean;
}

const DUE_TONE = { default: "default", danger: "danger", success: "success" } as const;

/**
 * One complaint (E 10): status badge (+ the violet corner dot when escalated),
 * subject and the due on the right, number · customer, the status pill and the
 * priority flag. A closed one reads quieter. Everything comes off the row.
 */
function ComplaintRowBase({ ticket, onPress, onAction, canWrite = true, canHold = true, selected = false, first = false }: ComplaintRowProps) {
  const code = lifecycleOf(ticket);
  const badge = complaintBadge(code);
  const due = rowDue(ticket);
  const terminal = isTerminal(code);
  const write = canWrite && !terminal;
  const flag = ticket.PriorityName ? priorityChip(ticket.PriorityName) : null;
  const chips: ChipProps[] = [
    { label: ticket.StatusName ?? code, tone: badge.chip },
    ...(flag ? [{ ...flag, iconOnly: true, accessibilityLabel: `${ticket.PriorityName} priority` }] : []),
  ];

  const act = (a: RowAction) => () => onAction?.(a, ticket);
  // Swipe left: Call · On hold · Resolve. Swipe right: Escalate (G29: Call only with a mobile).
  const right: SwipeAction[] = onAction
    ? [
        ...(ticket.CustomerMobile ? [{ key: "call", label: "Call", icon: Phone, color: "primary" as const, onPress: act("call") }] : []),
        ...(write && code !== "onhold" && canHold
          ? [{ key: "hold", label: "On hold", icon: CirclePause, color: "swipeHold" as const, onPress: act("hold") }]
          : []),
        ...(write ? [{ key: "resolve", label: "Resolve", icon: CircleCheck, color: "success" as const, onPress: act("resolve") }] : []),
      ]
    : [];
  const left: SwipeAction[] =
    onAction && write
      ? [{ key: "escalate", label: "Escalate", icon: ChevronsUp, color: "escalate", wide: true, onPress: act("escalate") }]
      : [];

  return (
    <SwipeRow left={left} right={right}>
      <ListRow
        testID={`complaint-${ticket.Id}`}
        badge={{ tone: badge.tone, icon: badge.icon, escalated: ticket.EscalatedTo != null, ringColor: selected ? "primarySoft" : "surface" }}
        title={ticket.Subject}
        titleTone={code === "closed" ? "muted" : "default"}
        right={due ? { text: due.text, tone: DUE_TONE[due.tone] } : undefined}
        number={ticket.TicketNo}
        meta={ticket.CustomerName ?? "Unnamed customer"}
        chips={chips}
        selected={selected}
        noSeparator={first}
        onPress={() => onPress(ticket)}
        accessibilityLabel={`${ticket.TicketNo}, ${ticket.Subject}`}
      />
    </SwipeRow>
  );
}

export const ComplaintRow = memo(ComplaintRowBase);
