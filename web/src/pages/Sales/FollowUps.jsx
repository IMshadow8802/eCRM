// src/pages/Sales/FollowUps.jsx
// Standalone work-queue of ALL follow-ups across leads. sp_FetchFollowUp with
// LeadId:0 returns every follow-up (paged); row-click opens the lead's detail.
// Rows can be marked done, rescheduled, or deleted in place.
import { useMemo, useState } from "react";
import { Helmet } from "react-helmet-async";
import { Box } from "@mui/material";
import { MaterialReactTable } from "material-react-table";
import { useNavigate } from "react-router-dom";
import { CalendarClock, Check, Trash2 } from "lucide-react";
import dayjs from "dayjs";

import {
  Button,
  Combobox,
  DateField,
  IconButton,
  Modal,
  Tooltip,
} from "../../components/ui";
import PageHeader from "../../components/ui/PageHeader";
import HelpGuide from "../../components/HelpGuide";
import { HELP_GUIDES } from "../../data/helpGuides";
import useServerTable from "../../hooks/useServerTable";
import { useApiQuery } from "../../hooks/useApiQuery";
import { useApiMutation } from "../../hooks/useApiMutation";
import { SALES_ENDPOINTS } from "../../api/salesQueries";

const formatDate = (value) => (value ? dayjs(value).format("DD-MMM-YYYY") : "—");

// A follow-up with no status yet counts as Pending (matches sp_FetchFollowUp's
// ISNULL(Status,'Pending') filter).
export const isFollowupOverdue = (f) =>
  Boolean(f?.NextFollowupDate) &&
  dayjs(f.NextFollowupDate).isBefore(dayjs(), "day") &&
  (f?.Status || "Pending") !== "Done";

// sp_FetchFollowUp's @Status is an exact-match filter (054).
const STATUS_OPTS = [
  { value: "Pending", label: "Pending" },
  { value: "Done", label: "Done" },
];

// sp_SaveFollowUp updates every column it's given, so send the row back
// unchanged apart from what the action modifies.
const rowPayload = (f) => ({
  Id: f.Id,
  LeadId: f.LeadId,
  NextFollowupDate: f.NextFollowupDate
    ? dayjs(f.NextFollowupDate).format("YYYY-MM-DD")
    : null,
  FollowupType: f.FollowupType ?? null,
  Remarks: f.Remarks ?? null,
  Status: f.Status || "Pending",
});

const FollowUps = () => {
  const navigate = useNavigate();

  const [status, setStatus] = useState("");
  const [reschedule, setReschedule] = useState(null); // follow-up row being rescheduled
  const [newDate, setNewDate] = useState("");
  const [deleteTarget, setDeleteTarget] = useState(null); // follow-up row pending delete

  // sp_FetchFollowUp returns LeadId but no lead name, so resolve names from a
  // bulk lead load (same pattern Leads.jsx uses for owners/stages).
  const { data: leadsData } = useApiQuery({
    queryKey: ["followup-leads"],
    endpoint: SALES_ENDPOINTS.leads.fetchLeads,
    params: { PageNumber: 1, PageSize: 1000 },
  });
  const leadNameById = useMemo(
    () => new Map((leadsData?.leads || []).map((l) => [l.Id, l.Name])),
    [leadsData]
  );

  const saveMutation = useApiMutation({
    endpoint: SALES_ENDPOINTS.followups.saveFollowup,
    successMessage: "Follow-up updated",
    invalidateQueries: [["followups"]],
  });
  const deleteMutation = useApiMutation({
    endpoint: SALES_ENDPOINTS.followups.deleteFollowup,
    successMessage: "Follow-up deleted",
    invalidateQueries: [["followups"]],
  });

  const markDone = (f) =>
    saveMutation.mutate({ ...rowPayload(f), Status: "Done" });

  const submitReschedule = async () => {
    if (!reschedule || !newDate) return;
    await saveMutation.mutateAsync({
      ...rowPayload(reschedule),
      NextFollowupDate: newDate,
    });
    setReschedule(null);
    setNewDate("");
  };

  const submitDelete = async () => {
    if (!deleteTarget) return;
    await deleteMutation.mutateAsync({ Id: deleteTarget.Id });
    setDeleteTarget(null);
  };

  const columns = useMemo(
    () => [
      {
        accessorKey: "LeadId",
        header: "Lead",
        enableSorting: false,
        Cell: ({ cell }) => {
          const id = cell.getValue();
          return leadNameById.get(id) || (id ? `Lead #${id}` : "—");
        },
      },
      {
        accessorKey: "NextFollowupDate",
        header: "Next Follow-up",
        enableSorting: true,
        Cell: ({ row, cell }) => (
          <span
            style={
              isFollowupOverdue(row?.original)
                ? { color: "#DC2626", fontWeight: 600 }
                : undefined
            }
          >
            {formatDate(cell.getValue())}
          </span>
        ),
      },
      {
        accessorKey: "FollowupType",
        header: "Type",
        enableSorting: false,
        Cell: ({ cell }) => cell.getValue() || "—",
      },
      {
        accessorKey: "Status",
        header: "Status",
        enableSorting: false,
        Cell: ({ cell }) => cell.getValue() || "Pending",
      },
      {
        accessorKey: "Remarks",
        header: "Remarks",
        enableSorting: false,
        Cell: ({ cell }) => cell.getValue() || "—",
      },
    ],
    [leadNameById]
  );

  const extraParams = useMemo(
    () => ({ LeadId: 0, Status: status || null }),
    [status]
  );

  const { table } = useServerTable({
    columns,
    queryKey: "followups",
    endpoint: SALES_ENDPOINTS.followups.fetchFollowups,
    dataKey: "followups",
    extraParams,
    initialPageSize: 25,
    getRowId: (row) => row.Id,
    enableRowActions: true,
    displayColumnDefOptions: {
      "mrt-row-actions": { grow: false, header: "Actions" },
    },
    muiTableBodyRowProps: ({ row }) => ({
      hover: true,
      sx: {
        cursor: "pointer",
        // Overdue = due before today and still pending: tint the whole row.
        ...(isFollowupOverdue(row.original) && {
          backgroundColor: "rgba(239, 68, 68, 0.08)",
        }),
      },
      onClick: () => navigate(`/sales/leads/${row.original.LeadId}`),
    }),
    // Actions live inside the clickable row — stop propagation so a click
    // doesn't also navigate to the lead.
    renderRowActions: ({ row }) => {
      const f = row.original;
      const done = (f.Status || "Pending") === "Done";
      return (
        <Box sx={{ display: "flex", gap: 0.5 }} onClick={(e) => e.stopPropagation()}>
          {!done && (
            <Tooltip title="Mark done">
              <IconButton
                size="sm"
                variant="ghost"
                aria-label="Mark follow-up done"
                data-testid={`complete-followup-${f.Id}`}
                onClick={() => markDone(f)}
              >
                <Check size={16} />
              </IconButton>
            </Tooltip>
          )}
          <Tooltip title="Reschedule">
            <IconButton
              size="sm"
              variant="ghost"
              aria-label="Reschedule follow-up"
              data-testid={`reschedule-followup-${f.Id}`}
              onClick={() => {
                setReschedule(f);
                setNewDate(
                  f.NextFollowupDate
                    ? dayjs(f.NextFollowupDate).format("YYYY-MM-DD")
                    : ""
                );
              }}
            >
              <CalendarClock size={16} />
            </IconButton>
          </Tooltip>
          <Tooltip title="Delete">
            <IconButton
              size="sm"
              variant="ghost"
              aria-label="Delete follow-up"
              data-testid={`delete-followup-${f.Id}`}
              onClick={() => setDeleteTarget(f)}
            >
              <Trash2 size={16} />
            </IconButton>
          </Tooltip>
        </Box>
      );
    },
    muiTableContainerProps: { sx: { maxHeight: "500px" } },
  });

  return (
    <Box sx={{ display: "flex", flexDirection: "column", flexGrow: 1 }}>
      <PageHeader
        title="Follow-ups"
        subtitle="Every scheduled follow-up across your leads, in one work queue."
        actions={<HelpGuide guide={HELP_GUIDES.followups} />}
      />
      <Helmet>
        <title>PRD Infotech | Follow-ups</title>
      </Helmet>
      <Box sx={{ display: "flex", gap: 1, mt: 1, mb: 0.5, flexWrap: "wrap" }}>
        <Box sx={{ width: 180 }}>
          <Combobox
            size="sm"
            placeholder="All statuses"
            options={STATUS_OPTS}
            value={STATUS_OPTS.find((o) => o.value === status) ?? null}
            onChange={(opt) => setStatus(opt?.value ?? "")}
            data-testid="filter-status"
          />
        </Box>
      </Box>
      <Box sx={{ width: "100%", overflowX: "auto" }}>
        <MaterialReactTable table={table} />
      </Box>

      <Modal
        open={Boolean(reschedule)}
        onClose={() => setReschedule(null)}
        size="sm"
        data-testid="reschedule-modal"
      >
        <Modal.Header
          title="Reschedule follow-up"
          icon={<CalendarClock size={18} />}
          onClose={() => setReschedule(null)}
        />
        <Modal.Body>
          <DateField
            label="New date"
            required
            value={newDate}
            onChange={setNewDate}
            data-testid="reschedule-date"
          />
        </Modal.Body>
        <Modal.Footer>
          <Button variant="ghost" onClick={() => setReschedule(null)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={submitReschedule}
            disabled={!newDate}
            loading={saveMutation.isPending}
            data-testid="reschedule-submit"
          >
            Save
          </Button>
        </Modal.Footer>
      </Modal>

      <Modal
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        size="sm"
        data-testid="delete-followup-modal"
      >
        <Modal.Header
          title="Delete follow-up?"
          icon={<Trash2 size={18} />}
          onClose={() => setDeleteTarget(null)}
        />
        <Modal.Body>
          <div style={{ fontSize: 14 }}>
            This removes the follow-up
            {deleteTarget?.NextFollowupDate
              ? ` scheduled for ${formatDate(deleteTarget.NextFollowupDate)}`
              : ""}
            . This cannot be undone.
          </div>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="ghost" onClick={() => setDeleteTarget(null)}>
            Cancel
          </Button>
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
