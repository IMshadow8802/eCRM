import { useMemo } from "react";
import { Box } from "@mui/material";
import { useTheme } from "@mui/material/styles";

import Combobox from "./Combobox";
import Chip from "./Chip";
import { useAssignableUsers } from "../../hooks/useAssignableUsers";

const GROUPS = { 1: "Your manager and team", 2: "Your office", 3: "Other offices" };
const EMPTY = "Nobody can take this. Ask a manager.";

/**
 * "Assign to" picker over the server's Can-assign-to list (useAssignableUsers).
 * Grouped by GroupRank, filtered on the client as you type. Shows name, job
 * title and office only — never phone, email or counts.
 * `value` is a user Id (or null); `onChange(id | null, user | null)`.
 * `allowUnassigned` lets the field be cleared (null = Unassigned).
 */
export default function AssigneePicker({
  module,
  recordId = null,
  value,
  onChange,
  label = "Assign to",
  allowUnassigned = false,
  enabled = true,
  ...rest
}) {
  const p = useTheme().tokens;
  const { users, isLoading } = useAssignableUsers({ module, recordId, enabled });
  const options = useMemo(
    () =>
      users
        .map((u) => ({ value: u.Id, label: u.FullName, user: u }))
        // groupBy needs each group contiguous; the server already orders, this only guards it.
        .sort((a, b) => (a.user.GroupRank ?? 3) - (b.user.GroupRank ?? 3)),
    [users],
  );
  const selected = options.find((o) => o.value === value) ?? null;

  return (
    <Combobox
      label={label}
      value={selected}
      onChange={(o) => onChange?.(o?.value ?? null, o?.user ?? null)}
      options={options}
      loading={isLoading}
      groupBy={(o) => GROUPS[o.user.GroupRank] ?? GROUPS[3]}
      noOptionsText={users.length ? "Nothing found" : EMPTY}
      placeholder={allowUnassigned ? "Unassigned" : undefined}
      disableClearable={!allowUnassigned}
      renderOption={({ key, ...props }, o) => {
        const sub = [o.user.JobTitle, o.user.BranchName].filter(Boolean).join(" · ");
        return (
          <li key={key} {...props} data-testid={`assignee-option-${o.value}`}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1, width: "100%" }}>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Box sx={{ fontWeight: 500 }}>{o.label}</Box>
                {sub && <Box sx={{ fontSize: "calc(12rem / 15)", color: p.text.tertiary }}>{sub}</Box>}
              </Box>
              {o.user.IsGiver && <Chip size="sm" tone="info" label="Gave it to you" />}
              {o.user.AwayToday && <Chip size="sm" tone="warning" variant="solid" label="Away today" />}
            </Box>
          </li>
        );
      }}
      {...rest}
    />
  );
}
