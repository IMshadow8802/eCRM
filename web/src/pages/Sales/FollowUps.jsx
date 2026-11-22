// src/pages/Sales/FollowUps.jsx
// The follow-up work queue across every lead the caller can see. The four
// views are the only question a rep asks of this page — what is due now, what
// is late, what is next — so they are tabs over fetchFollowups' own filters
// rather than a filter bar the user has to assemble.
import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { enqueueSnackbar } from "notistack";
import { Helmet } from "react-helmet-async";
import { Box } from "@mui/material";
import { MaterialReactTable } from "material-react-table";
import { useNavigate } from "react-router-dom";
import { CalendarClock, CheckCircle2, Eye, SkipForward, Trash2 } from "lucide-react";
import dayjs from "dayjs";

import { Button, IconButton, Modal, TextArea, Tooltip, Tabs, Chip } from "../../components/ui";
import PageHeader from "../../components/ui/PageHeader";
import HelpGuide from "../../components/HelpGuide";
import { HELP_GUIDES } from "../../data/helpGuides";
import useServerTable from "../../hooks/useServerTable";
import { useApiMutation } from "../../hooks/useApiMutation";
import { SALES_ENDPOINTS } from "../../api/salesQueries";
import { formatDate, formatDue } from "../../utils/format";
import { recordGone, RECORD_GONE_MESSAGE } from "../../utils/recordGone";
import { FOLLOWUP_TYPES } from "./leadStatus";
import LogFollowUpModal from "./LogFollowUpModal";
import RescheduleFollowUpModal from "./RescheduleFollowUpModal";

const VIEWS = [
  { value: "today", label: "Today" },
  { value: "overdue", label: "Overdue" },
  { value: "upcoming", label: "Upcoming" },
  { value: "all", label: "All" },
];

// Overdue is the server's verdict (IsOverdue / @Overdue), not a client date
// comparison — the queue and the badge must not disagree across a timezone.
const viewParams = (view) => {
  const today = dayjs().format("YYYY-MM-DD");
  switch (view) {
    case "today":
      return { LeadId: 0, Status: "open", DueFrom: today, DueTo: today };
    case "overdue":
      return { LeadId: 0, Overdue: true };
    case "upcoming":
      return { LeadId: 0, Status: "open", DueFrom: dayjs().add(1, "day").format("YYYY-MM-DD") };
    default:
      return { LeadId: 0 };
  }
};

// Via (fn_VisibleFollowUps): 1 = its lead is visible, 2 = an open one assigned to
// the caller on a lead they cannot see, 3 = a manager's look-only line. Only
// Via 1 opens the lead; Via 3 carries no phone and no actions. Missing = neither.
const opensLead = (f) => Number(f.Via) === 1;
const canAct = (f) => [1, 2].includes(Number(f.Via));

const typeLabel = (t) => FOLLOWUP_TYPES.find((x) => x.value === t)?.label ?? t;

const FollowUps = () => {
  const navigate = useNavigate();
  const [view, setView] = useState("today");
  const [logging, setLogging] = useState(null);
  const [rescheduling, setRescheduling] = useState(null);
  const [skipping, setSkipping] = useState(null);
  const [skipRemarks, setSkipRemarks] = useState("");
  const [deleting, setDeleting] = useState(null);
  const queryClient = useQueryClient();

  // Gone (recordGone: 404): the follow-up left the caller while the page was
  // open — close the prompt and reload the queue. Anything else (403 = visible
  // but refused, e.g. "You can view this follow-up but not act on it"): the
  // server's own words, prompt stays.
  const onActError = (error) => {
    const gone = recordGone(error);
    enqueueSnackbar(gone ? RECORD_GONE_MESSAGE : error?.response?.data?.message || error?.message || "Operation failed", { variant: "error" });
    if (!gone) return;
    setSkipping(null);
    setDeleting(null);
    queryClient.invalidateQueries({ queryKey: ["followups"] });
  };

  const skipMutation = useApiMutation({
    endpoint: SALES_ENDPOINTS.followups.skipFollowUp,
    successMessage: "Follow-up skipped",
    invalidateQueries: [["followups"], ["leads"]],
    showErrorMessage: false,
    onError: onActError,
  });
  const deleteMutation = useApiMutation({
    endpoint: SALES_ENDPOINTS.followups.deleteFollowup,
    successMessage: "Follow-up deleted",
    invalidateQueries: [["followups"], ["leads"]],
    showErrorMessage: false,
    onError: onActError,
  });

  // Remarks are required: the server 400s without them, and a skipped
  // follow-up with no reason tells the next person nothing.
  const submitSkip = async () => {
    if (!skipping || !skipRemarks.trim()) return;
    try {
      await skipMutation.mutateAsync({ Id: skipping.Id, Remarks: skipRemarks.trim() });
    } catch {
      return; // onActError has spoken
    }
    setSkipping(null);
    setSkipRemarks("");
  };
  const submitDelete = async () => {
    if (!deleting) return;
    try {
      await deleteMutation.mutateAsync({ Id: deleting.Id });
    } catch {
      return;
    }
    setDeleting(null);
  };

  const columns = useMemo(
    () => [
      {
        accessorKey: "LeadName",
        header: "Lead",
        enableSorting: false,
        // The name reads as a link because it is one — the whole history sits
        // one click away and nothing on the row said so.
        Cell: ({ row }) => {
          const f = row.original;
          const lookOnly = Number(f.Via) === 3;
          return (
            <span>
              {opensLead(f) ? (
                <Box
                  component="span"
                  data-testid={`lead-link-${f.Id}`}
                  sx={{
                    color: "primary.main",
                    fontWeight: 600,
                    cursor: "pointer",
                    "&:hover": { textDecoration: "underline" },
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    navigate(`/sales/leads/${f.LeadId}`);
                  }}
                >
                  {f.LeadName}
                </Box>
              ) : (
                <Box component="span" sx={{ fontWeight: 600 }} data-testid={`lead-name-${f.Id}`}>{f.LeadName}</Box>
              )}
              {f.LeadCompany ? ` · ${f.LeadCompany}` : ""}
              {!lookOnly && f.LeadMobile ? ` · ${f.LeadMobile}` : ""}
              {lookOnly && (
                <Box component="span" sx={{ display: "block", fontSize: "calc(12rem / 15)", color: "text.secondary" }}>
                  Assigned to {f.AssignedToName || "nobody"}
                </Box>
              )}
            </span>
          );
        },
      },
      {
        accessorKey: "DueAt",
        header: "Due",
        enableSorting: true,
        Cell: ({ row, cell }) => (
          <span style={row.original.IsOverdue ? { color: "#DC2626", fontWeight: 600 } : undefined}>
            {formatDue(cell.getValue(), { empty: "—" })}
          </span>
        ),
      },
      {
        accessorKey: "Type",
        header: "Type",
        enableSorting: false,
        Cell: ({ cell }) => typeLabel(cell.getValue()),
      },
      {
        accessorKey: "AssignedToName",
        header: "Assigned to",
        enableSorting: false,
        Cell: ({ cell }) => cell.getValue() || "—",
      },
      {
        accessorKey: "Status",
        header: "Status",
        enableSorting: false,
        Cell: ({ cell }) => (
          <Chip
            label={cell.getValue()}
            size="sm"
            tone={cell.getValue() === "open" ? "primary" : "default"}
          />
        ),
      },
      {
        accessorKey: "Remarks",
        header: "Outcome / remarks",
        enableSorting: false,
        Cell: ({ row }) => [row.original.Outcome, row.original.Remarks].filter(Boolean).join(" — ") || "—",
      },
    ],
    [navigate]
  );

  const extraParams = useMemo(() => viewParams(view), [view]);

  const { table } = useServerTable({
    columns,
    queryKey: "followups",
    endpoint: SALES_ENDPOINTS.followups.fetchFollowups,
    dataKey: "followups",
    extraParams,
    initialPageSize: 25,
    getRowId: (row) => row.Id,
    enableRowActions: true,
    displayColumnDefOptions: { "mrt-row-actions": { grow: false, header: "Actions" } },
    muiTableBodyRowProps: ({ row }) =>
      opensLead(row.original)
        ? { hover: true, sx: { cursor: "pointer" }, onClick: () => navigate(`/sales/leads/${row.original.LeadId}`) }
        : { hover: true },
    // A logged follow-up is history: nothing to do, nothing to delete — but
    // its lead is still worth opening, so the eye is on every row.
    renderRowActions: ({ row }) => {
      const f = row.original;
      return (
        <Box sx={{ display: "flex", gap: 0.5 }} onClick={(e) => e.stopPropagation()}>
          {opensLead(f) && (
            <Tooltip title="View lead & history">
              <IconButton size="sm" variant="ghost" tone="primary" aria-label="View lead" data-testid={`view-lead-${f.Id}`} onClick={() => navigate(`/sales/leads/${f.LeadId}`)}>
                <Eye size={16} />
              </IconButton>
            </Tooltip>
          )}
          {f.Status === "open" && canAct(f) && (
            <>
              <Tooltip title="Log this follow-up">
                <IconButton size="sm" variant="ghost" tone="success" aria-label="Log follow-up" data-testid={`log-followup-${f.Id}`} onClick={() => setLogging(f)}>
                  <CheckCircle2 size={16} />
                </IconButton>
              </Tooltip>
              {/* Reschedule books a new follow-up on the lead (sp_ScheduleFollowUp
                  needs the lead visible), so a Via 2 line can log/skip but not move. */}
              {opensLead(f) && (
                <Tooltip title="Reschedule">
                  <IconButton size="sm" variant="ghost" tone="primary" aria-label="Reschedule follow-up" data-testid={`reschedule-followup-${f.Id}`} onClick={() => setRescheduling(f)}>
                    <CalendarClock size={16} />
                  </IconButton>
                </Tooltip>
              )}
              <Tooltip title="Skip with a remark">
                <IconButton size="sm" variant="ghost" tone="warning" aria-label="Skip follow-up" data-testid={`skip-followup-${f.Id}`} onClick={() => setSkipping(f)}>
                  <SkipForward size={16} />
                </IconButton>
              </Tooltip>
              <Tooltip title="Delete">
                <IconButton size="sm" variant="ghost" tone="error" aria-label="Delete follow-up" data-testid={`delete-followup-${f.Id}`} onClick={() => setDeleting(f)}>
                  <Trash2 size={16} />
                </IconButton>
              </Tooltip>
            </>
          )}
        </Box>
      );
    },
  });

  return (
    <Box sx={{ display: "flex", flexDirection: "column", flexGrow: 1 }}>
      <PageHeader
        title="Follow-ups"
        subtitle="What is due, what is late, what is next — across every lead you can see."
        actions={<HelpGuide guide={HELP_GUIDES.followups} />}
      />
      <Helmet>
        <title>PRD Infotech | Follow-ups</title>
      </Helmet>
      <Box sx={{ mt: 1 }}>
        <Tabs value={view} onChange={setView} items={VIEWS} data-testid="followup-views" />
      </Box>
      <MaterialReactTable table={table} />

      <LogFollowUpModal open={Boolean(logging)} followUp={logging} onClose={() => setLogging(null)} />
      <RescheduleFollowUpModal open={Boolean(rescheduling)} followUp={rescheduling} onClose={() => setRescheduling(null)} />

      <Modal open={Boolean(skipping)} onClose={() => setSkipping(null)} size="sm" data-testid="skip-modal">
        <Modal.Header title="Skip follow-up" icon={<SkipForward size={18} />} onClose={() => setSkipping(null)} />
        <Modal.Body>
          <TextArea
            label="Why?"
            required
            value={skipRemarks}
            onChange={(e) => setSkipRemarks(e.target.value)}
            data-testid="skip-remarks"
          />
        </Modal.Body>
        <Modal.Footer>
          <Button variant="ghost" onClick={() => setSkipping(null)}>Cancel</Button>
          <Button
            variant="primary"
            onClick={submitSkip}
            disabled={!skipRemarks.trim()}
            loading={skipMutation.isPending}
            data-testid="skip-submit"
          >
            Skip
          </Button>
        </Modal.Footer>
      </Modal>

      <Modal open={Boolean(deleting)} onClose={() => setDeleting(null)} size="sm" data-testid="delete-followup-modal">
        <Modal.Header title="Delete follow-up?" icon={<Trash2 size={18} />} onClose={() => setDeleting(null)} />
        <Modal.Body>
          <div style={{ fontSize: "calc(14rem / 15)" }}>
            Removes the open follow-up due {formatDate(deleting?.DueAt, { empty: "—" })}. Logged ones are history and cannot be deleted.
          </div>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="ghost" onClick={() => setDeleting(null)}>Cancel</Button>
          <Button
            variant="destructive"
            onClick={submitDelete}
            loading={deleteMutation.isPending}
            data-testid="delete-followup-confirm"
          >
            Delete
          </Button>
        </Modal.Footer>
      </Modal>
    </Box>
  );
};

export default FollowUps;
