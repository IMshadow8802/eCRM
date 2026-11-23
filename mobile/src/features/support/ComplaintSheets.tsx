import { forwardRef, useCallback, useImperativeHandle, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeftRight, ChevronsUp, CircleCheck, CirclePause, Undo2 } from "lucide-react-native";

import { logCall } from "../../api/callQueries";
import { apiErrorMessage, RECORD_GONE_MESSAGE, recordGone } from "../../api/errors";
import { escalateTicket, fetchEscalationTargets, setTicketStatus, transferTicket } from "../../api/ticketQueries";
import { fetchAssignableUsers } from "../../api/userQueries";
import { complaintBadge } from "../../theme";
import type { Lookup, Ticket, TicketStatusCode } from "../../types/api";
import { ComposeSheet, LogCallSheet, useToast, type LogCallThen, type SheetRef } from "../../ui";
import { ResolveSheet } from "./ResolveSheet";
import { TransferSheet } from "./TransferSheet";
import { asStatusCode, dueWhen, isActive, isTerminal, lifecycleOf, statusFor } from "./ticketHelpers";
import { useTicketRefData } from "./useTicketRefData";

/** Every write a complaint offers. Each opens its sheet; none writes on its own. */
export type ComplaintAction =
  | "call"
  | "hold"
  | "resume"
  | "resolve"
  | "close"
  | "reject"
  | "reopen"
  | "reassign"
  | "sendback"
  | "escalate";

export interface ComplaintSheetsHandle {
  open: (action: ComplaintAction, ticket: Ticket) => void;
  /** Change status: any company status row, asking what its Code demands. */
  moveTo: (ticket: Ticket, target: Lookup) => void;
}

/** A status move that is not Resolve: where it goes and what the SP will demand (spec §2). */
interface Move {
  action: "hold" | "resume" | "close" | "reject" | "reopen";
  target: Lookup;
  needsResolution: boolean;
  needsRemarks: boolean;
}

const MOVE_TO: Record<Move["action"], TicketStatusCode> = {
  hold: "onhold",
  resume: "open",
  close: "closed",
  reject: "rejected",
  reopen: "open",
};

const MOVE_COPY: Record<Move["action"], { title: string; submit: string }> = {
  hold: { title: "Put on hold", submit: "Put on hold" },
  resume: { title: "Resume complaint", submit: "Resume" },
  close: { title: "Close complaint", submit: "Close complaint" },
  reject: { title: "Reject complaint", submit: "Reject" },
  reopen: { title: "Reopen complaint", submit: "Reopen" },
};

const first = (name: string) => name.split(" ")[0];

/**
 * The sheets behind every complaint action, shared by the list (swipe, E 22)
 * and the record (action bar, E 11): Resolve (13), Reassign (23), Send back,
 * Log call (24), Escalate, and one status sheet for hold / resume / close /
 * reject / reopen. `setTicketStatus` is the one engine for every status move;
 * a refusal is the server's sentence in a toast — never pre-empted.
 *
 * A 403/404 means the complaint left the caller while the screen was open
 * (Review Focus 4): the cached detail is dropped, `onGone` takes the record
 * screen back to the list, and the toast says RECORD_GONE_MESSAGE. A reassign
 * or send back that succeeds leaves the same way.
 */
const NOT_SET_UP = "That status is not set up for your company. Add it on the web first.";

export interface ComplaintSheetsProps {
  /** The record screen: leave it (back to the list). Omit on the list. */
  onGone?: () => void;
}

export const ComplaintSheets = forwardRef<ComplaintSheetsHandle, ComplaintSheetsProps>(function ComplaintSheets({ onGone }, ref) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const { statuses, resolutions, transferReasons, callOutcomes } = useTicketRefData();

  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [move, setMove] = useState<Move | null>(null);
  const [resolveTarget, setResolveTarget] = useState<Lookup | null>(null);
  const [callError, setCallError] = useState<string | null>(null);

  const resolveRef = useRef<SheetRef>(null);
  const moveRef = useRef<SheetRef>(null);
  const reassignRef = useRef<SheetRef>(null);
  const sendBackRef = useRef<SheetRef>(null);
  const escalateRef = useRef<SheetRef>(null);
  const callRef = useRef<SheetRef>(null);

  const code = ticket ? lifecycleOf(ticket) : "open";
  // The chain above whoever is WORKING it (the server works it out). Same key
  // as the record's own query, so the two share one request.
  const { data: seniors, isLoading: seniorsLoading } = useQuery({
    queryKey: ["escalation-targets", ticket?.Id],
    queryFn: () => fetchEscalationTargets(ticket!.Id),
    enabled: !!ticket && isActive(code),
  });

  // Per record, so the server can mark who gave it (IsGiver) and drop the holder.
  const [picking, setPicking] = useState(false);
  const { data: people = [] } = useQuery({
    queryKey: ["users", "assignable", "complaints", ticket?.Id],
    queryFn: () => fetchAssignableUsers({ Module: "complaints", RecordId: ticket!.Id }),
    enabled: picking && !!ticket,
  });

  const invalidate = (id: number) => {
    void queryClient.invalidateQueries({ queryKey: ["ticket", id] });
    // The chain is the holder's: a refused write may mean someone else holds it now.
    void queryClient.invalidateQueries({ queryKey: ["escalation-targets", id] });
    void queryClient.invalidateQueries({ queryKey: ["tickets"] });
  };

  /** The complaint is no longer the caller's to look at here: drop it and leave. */
  const leave = (id: number, say: () => void) => {
    for (const r of [resolveRef, moveRef, reassignRef, sendBackRef, escalateRef, callRef]) r.current?.dismiss();
    onGone?.();
    queryClient.removeQueries({ queryKey: ["ticket", id] });
    // The chain belongs to the old holder: kept (staleTime 60 s), a reopened
    // record offered nobody above the new one (Maestro, 2026-11-23).
    queryClient.removeQueries({ queryKey: ["escalation-targets", id] });
    void queryClient.invalidateQueries({ queryKey: ["tickets"] });
    say();
  };

  /** Every write's refusal: gone (403/404) leaves; anything else is the server's sentence, then a fresh copy. */
  const fail = (err: unknown, id: number, fallback: string) => {
    if (recordGone(err)) return leave(id, () => toast.error(RECORD_GONE_MESSAGE));
    toast.error(apiErrorMessage(err, fallback));
    invalidate(id);
  };

  const status = useMutation({
    mutationFn: (p: Parameters<typeof setTicketStatus>[0]) => setTicketStatus(p),
    onError: (err, vars) => fail(err, vars.TicketId, "Could not change the status."),
    onSuccess: (_r, vars) => {
      resolveRef.current?.dismiss();
      moveRef.current?.dismiss();
      const to = statuses.find((s) => s.Id === vars.StatusId)?.Value;
      toast.success(to ? `Status changed to ${to}` : "Status changed");
      invalidate(vars.TicketId);
    },
  });

  const reassign = useMutation({
    mutationFn: (p: Parameters<typeof transferTicket>[0]) => transferTicket(p),
    onError: (err, vars) => {
      // Send back refused (the giver lost the module, say): the server's
      // sentence, then the refetched record drops the button (Review Focus 3).
      if (vars.SendBack) sendBackRef.current?.dismiss();
      fail(err, vars.TicketId, "Could not reassign this complaint.");
    },
    onSuccess: (_r, vars) => {
      const to = vars.SendBack ? ticket?.SendBackToName : people.find((u) => u.Id === vars.ToUserId)?.FullName;
      const verb = vars.SendBack ? "Sent back" : "Reassigned";
      leave(vars.TicketId, () => toast.success(to ? `${verb} to ${to}` : verb));
    },
  });

  const escalate = useMutation({
    mutationFn: (p: Parameters<typeof escalateTicket>[0]) => escalateTicket(p),
    onError: (err, vars) => fail(err, vars.TicketId, "Could not escalate this complaint."),
    onSuccess: (_r, vars) => {
      escalateRef.current?.dismiss();
      const to = seniors?.find((s) => s.Id === vars.ToUserId)?.FullName;
      toast.success(to ? `Escalated to ${to}` : "Escalated");
      invalidate(vars.TicketId);
    },
  });

  const call = useMutation({
    mutationFn: (p: Parameters<typeof logCall>[0]) => logCall(p),
    onError: (err, vars) => {
      if (recordGone(err)) leave(vars.TicketId!, () => toast.error(RECORD_GONE_MESSAGE));
      else setCallError(apiErrorMessage(err, "Could not log that call."));
    },
  });

  /**
   * The sheet a move into `target` needs — exactly what its Code demands of
   * sp_SetTicketStatus (spec §2): resolved → resolution + remarks; rejected →
   * remarks; into closed straight from active → resolution + remarks; terminal
   * → active is a reopen → remarks. Resolved goes to the Resolve sheet, aimed
   * at THIS row (a company may have two resolved-coded statuses).
   */
  const ask = useCallback((row: Ticket, target: Lookup, action?: Move["action"]) => {
    const from = lifecycleOf(row);
    const to = asStatusCode(target.Code);
    if (to === "resolved") {
      setResolveTarget(target);
      resolveRef.current?.present();
      return;
    }
    const reopen = isTerminal(from) && isActive(to);
    const straightToClosed = to === "closed" && from !== "resolved";
    setMove({
      action: action ?? (to === "onhold" ? "hold" : to === "open" ? (reopen ? "reopen" : "resume") : to === "closed" ? "close" : "reject"),
      target,
      needsResolution: straightToClosed,
      needsRemarks: reopen || to === "rejected" || straightToClosed,
    });
    moveRef.current?.present();
  }, []);
  const mutateStatus = status.mutate;

  // Stable deps: a new handle each render would re-run a callback ref (the record keeps it in state) forever.
  useImperativeHandle(ref, () => ({
    open: (action, row) => {
      setTicket(row);
      if (action === "call") {
        setCallError(null);
        callRef.current?.present();
      } else if (action === "resolve") {
        // A company with no resolved-coded status: say so, not a sheet whose Save does nothing.
        if (!statusFor(statuses, "resolved")) {
          toast.error(NOT_SET_UP);
          return;
        }
        setResolveTarget(null);
        resolveRef.current?.present();
      } else if (action === "reassign") {
        setPicking(true);
        reassignRef.current?.present();
      } else if (action === "sendback") sendBackRef.current?.present();
      else if (action === "escalate") escalateRef.current?.present();
      else {
        const target = statusFor(statuses, MOVE_TO[action]);
        if (!target) {
          toast.error(NOT_SET_UP);
          return;
        }
        ask(row, target, action);
      }
    },
    moveTo: (row, target) => {
      setTicket(row);
      const from = lifecycleOf(row);
      const to = asStatusCode(target.Code);
      // The same row, or active → active (two `open` rows included): nothing to ask,
      // the pick is the act. A second row of a terminal code still needs what that
      // code demands (sp_SetTicketStatus), so it goes through ask().
      if (target.Id === row.StatusId || (isActive(from) && isActive(to))) {
        mutateStatus({ TicketId: row.Id, StatusId: target.Id });
        return;
      }
      ask(row, target);
    },
  }), [statuses, toast, mutateStatus, ask]);

  const onhold = statusFor(statuses, "onhold");
  const resolved = statusFor(statuses, "resolved");
  // Complaints only, never on a terminal one (E 24). "Put on hold" makes no
  // sense on one already held.
  const then: LogCallThen[] | undefined =
    ticket && isActive(code)
      ? [
          { value: "keep", label: "Keep open" },
          ...(onhold && code !== "onhold"
            ? [{ value: "hold", label: "Put on hold", tone: "butter" as const, icon: CirclePause }]
            : []),
          ...(resolved ? [{ value: "resolve", label: "Resolve", tone: "green" as const, icon: CircleCheck }] : []),
        ]
      : undefined;

  const contact = ticket?.ContactPerson || ticket?.CustomerContactPerson || ticket?.CustomerName;
  const mobile = ticket?.Contact || ticket?.CustomerMobile;
  const due = dueWhen(ticket?.DueAt);
  const copy = move ? MOVE_COPY[move.action] : MOVE_COPY.hold;
  const moveBadge = complaintBadge(move ? MOVE_TO[move.action] : "onhold");
  const label = ticket ? `${ticket.TicketNo} · ${ticket.Subject}` : undefined;

  return (
    <>
      <ResolveSheet
        ref={resolveRef}
        ticket={ticket}
        resolutions={resolutions}
        busy={status.isPending}
        onSubmit={({ resolutionId, remarks }) => {
          const to = resolveTarget ?? resolved;
          if (!ticket || !to) return;
          status.mutate({ TicketId: ticket.Id, StatusId: to.Id, ResolutionId: resolutionId, Remarks: remarks });
        }}
      />

      <ComposeSheet
        ref={moveRef}
        title={copy.title}
        subtitle={label}
        badge={{ tone: moveBadge.tone, icon: moveBadge.icon }}
        submitLabel={copy.submit}
        busy={status.isPending}
        choices={
          move?.needsResolution
            ? [{ key: "resolution", label: "Resolution", required: true, options: resolutions.map((r) => ({ value: r.Id, label: r.Value })) }]
            : []
        }
        fields={[
          {
            key: "remarks",
            label: "Remarks",
            placeholder: move?.needsRemarks ? "Why — this goes on the history" : "Optional note for the history",
            multiline: true,
            required: move?.needsRemarks ?? false,
          },
        ]}
        onSubmit={(values, picked) => {
          if (!ticket || !move) return;
          status.mutate({
            TicketId: ticket.Id,
            StatusId: move.target.Id,
            ResolutionId: (picked.resolution as number | undefined) ?? null,
            Remarks: values.remarks || null,
          });
        }}
      />

      <TransferSheet
        ref={reassignRef}
        testID="reassign"
        title="Reassign complaint"
        subtitle={ticket ? `${ticket.TicketNo} · ${ticket.AssigneeName ? `now with ${ticket.AssigneeName}` : "Unassigned"}` : undefined}
        badge={{ tone: "indigo", icon: ArrowLeftRight }}
        pickLabel="Reassign to"
        searchable
        awayLabel="Away today"
        giverLabel="Gave it to you"
        people={people
          .filter((u) => u.Id !== ticket?.AssignedTo)
          .map((u) => ({
            Id: u.Id,
            FullName: u.FullName,
            note: [u.JobTitle, u.BranchName].filter(Boolean).join(" · ") || undefined,
            group: u.GroupRank,
            away: u.AwayToday === true,
            giver: u.IsGiver === true,
          }))}
        reasons={transferReasons}
        remarksPlaceholder={(name) => (name ? `Tell ${first(name)} what has been tried` : "What has been tried")}
        remarksError="Remarks are required to reassign."
        footnote={due ? `Due stays ${due}. Reassigning never moves the TAT clock.` : undefined}
        submitLabel={(name) => (name ? `Reassign to ${first(name)}` : "Reassign")}
        emptyMessage="Nobody can take this. Ask a manager."
        busy={reassign.isPending}
        onSubmit={({ userId: to, reasonId, remarks }) => {
          if (!ticket) return;
          reassign.mutate({
            TicketId: ticket.Id,
            ToUserId: to,
            // Never inferred from the assignee's office (web: only on an explicit
            // office pick); a wide caller would silently move the complaint.
            ToBranchId: null,
            ReasonId: reasonId!,
            Remarks: remarks,
          });
        }}
      />

      <ComposeSheet
        ref={sendBackRef}
        title={ticket?.SendBackToName ? `Send back to ${ticket.SendBackToName}` : "Send back"}
        subtitle={label}
        badge={{ tone: "teal", icon: Undo2 }}
        submitLabel={ticket?.SendBackToName ? `Send back to ${first(ticket.SendBackToName)}` : "Send back"}
        busy={reassign.isPending}
        fields={[
          { key: "sendback", label: "Remarks", placeholder: "Why it goes back — they get a notification", multiline: true, required: true },
        ]}
        onSubmit={(values) => {
          if (!ticket?.SendBackToId) return;
          // No ReasonId: the server stamps its own "Sent back" reason.
          reassign.mutate({ TicketId: ticket.Id, ToUserId: ticket.SendBackToId, Remarks: values.sendback!, SendBack: true });
        }}
      />

      <TransferSheet
        ref={escalateRef}
        testID="escalate"
        title="Escalate complaint"
        subtitle={ticket ? `${ticket.TicketNo} · ${ticket.AssigneeName ? `it stays with ${ticket.AssigneeName}` : "it stays unassigned"}` : undefined}
        badge={{ tone: "lilac", icon: ChevronsUp }}
        pickLabel="Escalate to"
        people={(seniors ?? []).map((s) => ({
          Id: s.Id,
          FullName: s.FullName,
          note: [s.Depth === 1 ? "Direct manager" : `${s.Depth} levels up`, s.JobTitle].filter(Boolean).join(" · "),
        }))}
        remarksPlaceholder={() => "What they need to know — they get a notification"}
        remarksError="Say why it needs a senior."
        submitLabel={(name) => (name ? `Escalate to ${name}` : "Escalate")}
        emptyMessage={
          seniorsLoading
            ? "Loading who is above…"
            : `Nobody above ${ticket?.AssigneeName ?? "you"} can open complaints. Reassign it or tell a manager.`
        }
        busy={escalate.isPending}
        onSubmit={({ userId: to, remarks }) => {
          if (ticket) escalate.mutate({ TicketId: ticket.Id, ToUserId: to, Remarks: remarks });
        }}
      />

      <LogCallSheet
        ref={callRef}
        subtitle={[contact, mobile].filter(Boolean).join(" · ") || undefined}
        outcomes={callOutcomes}
        then={then}
        busy={call.isPending || status.isPending}
        error={callError}
        onSubmit={(v) => {
          if (!ticket) return;
          const row = ticket;
          call.mutate(
            {
              TicketId: row.Id,
              Direction: v.direction,
              OutcomeId: v.outcomeId,
              Notes: v.notes,
              Duration: v.minutes > 0 ? v.minutes : null,
            },
            {
              onSuccess: () => {
                callRef.current?.dismiss();
                void queryClient.invalidateQueries({ queryKey: ["calls", "ticket", row.Id] });
                invalidate(row.Id);
                // The "Then" step chains after the call is on the record.
                if (v.then === "hold" && onhold) status.mutate({ TicketId: row.Id, StatusId: onhold.Id });
                else if (v.then === "resolve") {
                  setResolveTarget(null);
                  resolveRef.current?.present();
                }
                else toast.success("Call logged");
              },
            },
          );
        }}
      />
    </>
  );
});
