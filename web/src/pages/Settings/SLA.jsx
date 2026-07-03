// src/pages/Settings/SLA.jsx
// Company-admin SLA matrix: one row per priority lookup with editable response
// and resolution targets (minutes). Saving a row upserts a tblSLA rule via
// saveSLARule (Id from the existing rule if present, else 0).
import React, { useEffect, useMemo, useState } from "react";
import { Helmet } from "react-helmet-async";
import { Box } from "@mui/material";

import PageHeader from "../../components/PageHeader";
import NumberInput from "../../components/ui/NumberInput";
import Button from "../../components/ui/Button";
import { EmptyState } from "../../components/ui";

import { useApiQuery } from "../../hooks/useApiQuery";
import { useApiMutation } from "../../hooks/useApiMutation";
import { SUPPORT_ENDPOINTS } from "../../api/supportQueries";

const SLA = () => {
  const prioritiesQuery = useApiQuery({
    queryKey: ["lookups", "priority"],
    endpoint: SUPPORT_ENDPOINTS.config.fetchLookups,
    params: { Kind: "priority" },
  });

  const rulesQuery = useApiQuery({
    queryKey: ["slaRules"],
    endpoint: SUPPORT_ENDPOINTS.tickets.fetchSLARules,
  });

  const priorities = prioritiesQuery.data?.lookups || [];
  const rules = rulesQuery.data?.slaRules || [];

  const rulesByPriority = useMemo(() => {
    const map = {};
    rules.forEach((r) => {
      map[r.Priority] = r;
    });
    return map;
  }, [rules]);

  // Local editable mins keyed by priority Id, seeded from the fetched rules.
  // Depend on the raw query data (stable react-query refs) — not the derived
  // `|| []` arrays, which are fresh each render and would loop setEdits.
  const [edits, setEdits] = useState({});
  useEffect(() => {
    const next = {};
    priorities.forEach((p) => {
      const rule = rulesByPriority[p.Id];
      next[p.Id] = {
        ResponseMins: String(rule?.ResponseMins ?? 0),
        ResolutionMins: String(rule?.ResolutionMins ?? 0),
      };
    });
    setEdits(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prioritiesQuery.data, rulesQuery.data]);

  const [savingId, setSavingId] = useState(null);

  const saveMutation = useApiMutation({
    endpoint: SUPPORT_ENDPOINTS.tickets.saveSLARule,
    successMessage: "SLA rule saved successfully!",
    onSuccess: () => rulesQuery.refetch(),
  });

  const setField = (priorityId, field, value) => {
    setEdits((prev) => ({
      ...prev,
      [priorityId]: { ...prev[priorityId], [field]: value },
    }));
  };

  const handleSave = (priority) => {
    const edit = edits[priority.Id] || {};
    const rule = rulesByPriority[priority.Id];
    setSavingId(priority.Id);
    saveMutation.mutate(
      {
        Id: rule?.Id || 0,
        Priority: priority.Id,
        ResponseMins: Number(edit.ResponseMins) || 0,
        ResolutionMins: Number(edit.ResolutionMins) || 0,
      },
      { onSettled: () => setSavingId(null) }
    );
  };

  const isLoading = prioritiesQuery.isLoading || rulesQuery.isLoading;

  return (
    <Box sx={{ display: "flex", flexDirection: "column", flexGrow: 1 }}>
      <PageHeader title="SLA Rules" subtitle="Set response and resolution targets (in minutes) per priority." />
      <Helmet>
        <title>PRD Infotech | SLA Rules</title>
      </Helmet>

      <Box sx={{ mt: 1.5 }}>
        {!isLoading && priorities.length === 0 ? (
          <EmptyState
            title="No priorities yet"
            description="Add priorities first — SLA targets are set per priority."
            data-testid="sla-empty"
          />
        ) : (
          <Box sx={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left", padding: "8px 12px" }}>Priority</th>
                  <th style={{ textAlign: "left", padding: "8px 12px" }}>Response (mins)</th>
                  <th style={{ textAlign: "left", padding: "8px 12px" }}>Resolution (mins)</th>
                  <th style={{ padding: "8px 12px" }} />
                </tr>
              </thead>
              <tbody>
                {priorities.map((p) => {
                  const edit = edits[p.Id] || { ResponseMins: "0", ResolutionMins: "0" };
                  return (
                    <tr key={p.Id} data-testid={`sla-row-${p.Id}`}>
                      <td style={{ padding: "8px 12px" }}>{p.Value}</td>
                      <td style={{ padding: "8px 12px", width: 180 }}>
                        <NumberInput
                          min={0}
                          value={edit.ResponseMins}
                          onChange={(e) => setField(p.Id, "ResponseMins", e.target.value)}
                          data-testid={`sla-response-${p.Id}`}
                          aria-label={`Response minutes for ${p.Value}`}
                        />
                      </td>
                      <td style={{ padding: "8px 12px", width: 180 }}>
                        <NumberInput
                          min={0}
                          value={edit.ResolutionMins}
                          onChange={(e) => setField(p.Id, "ResolutionMins", e.target.value)}
                          data-testid={`sla-resolution-${p.Id}`}
                          aria-label={`Resolution minutes for ${p.Value}`}
                        />
                      </td>
                      <td style={{ padding: "8px 12px" }}>
                        <Button
                          size="sm"
                          onClick={() => handleSave(p)}
                          loading={savingId === p.Id}
                          data-testid={`sla-save-${p.Id}`}
                        >
                          Save
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Box>
        )}
      </Box>
    </Box>
  );
};

export default SLA;
