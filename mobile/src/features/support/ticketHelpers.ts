import type {
  CustomFieldDef,
  CustomFieldValue,
  Lookup,
  PipelineStage,
  StageType,
  Ticket,
} from "../../types/api";

/**
 * sp_SaveTicket takes Channel as a plain varchar(20) — no lookup drives it —
 * so the list of channels is a UI constant, matching the web's exactly.
 */
export const CHANNELS = [
  { value: "phone", label: "Phone" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "email", label: "Email" },
  { value: "web", label: "Web" },
  { value: "chat", label: "Chat" },
] as const;

export const channelLabel = (channel: string | null): string =>
  CHANNELS.find((c) => c.value === channel)?.label ?? channel ?? "—";

// ---------------------------------------------------------------- lookups

/** `{Id: Value}` for resolving the raw ids a ticket row carries. */
export const lookupMap = (lookups: Lookup[] | undefined): Map<number, string> =>
  new Map((lookups ?? []).map((l) => [l.Id, l.Value]));

export const asOptions = (lookups: Lookup[] | undefined) =>
  (lookups ?? []).map((l) => ({ value: l.Id, label: l.Value }));

/**
 * Priority is a per-company lookup row, so its *name* is the only thing that
 * can be matched on — there is no enum and ids differ between companies.
 * Anything unrecognised falls back to neutral rather than guessing.
 */
export function priorityTone(
  name: string | undefined,
): "danger" | "warning" | "success" | "textSecondary" {
  const key = (name ?? "").toLowerCase();
  if (key.includes("urgent") || key.includes("critical")) return "danger";
  if (key.includes("high")) return "danger";
  if (key.includes("medium") || key.includes("normal")) return "warning";
  if (key.includes("low")) return "success";
  return "textSecondary";
}

// --------------------------------------------------------------- lifecycle

export type Lifecycle = "open" | "resolved" | "closed" | "rejected" | "unknown";

export const LIFECYCLE_LABEL: Record<Lifecycle, string> = {
  open: "Open",
  resolved: "Resolved",
  closed: "Closed",
  rejected: "Rejected",
  unknown: "No stage",
};

/** Order the sections appear in. Open first — that is the work. */
export const LIFECYCLE_ORDER: Lifecycle[] = [
  "open",
  "resolved",
  "closed",
  "rejected",
  "unknown",
];

/**
 * The two-step terminal flow, derived rather than hardcoded.
 *
 * A support pipeline ends in two `won` stages: the FIRST (lowest SortOrder) is
 * **Resolved** — fixed, awaiting the customer's confirmation, and requires a
 * ResolutionId. The LAST is **Closed**. A `lost` stage is **Rejected**: closed
 * without ever being solved, so it carries no resolution.
 *
 * Stage names are per-company and editable, so matching on the word "Resolved"
 * would break the moment someone renames it. SortOrder within StageType is the
 * only stable signal.
 */
export interface StageRoles {
  ordered: PipelineStage[];
  first: PipelineStage | null;
  resolved: PipelineStage | null;
  closed: PipelineStage | null;
  rejected: PipelineStage | null;
}

/**
 * @param stages     every stage fetchPipelines returned — it hands back the
 *                   stages of ALL the entity's pipelines in one flat list.
 * @param pipelineId scope the roles to one pipeline. Pass it whenever the
 *                   answer is about a particular ticket or board.
 *
 * The filter is not optional in spirit, only in signature. A company may run
 * more than one support pipeline, and without scoping, `resolved` is the first
 * `won` stage across ALL of them and `closed` the last — so a ticket resolved
 * in pipeline B gets compared against pipeline A's stages and renders under the
 * wrong lifecycle, while the move sheet offers stages the ticket cannot go to.
 * The web boards have always filtered by `PipelineId`; this is the same guard.
 *
 * Omit it only when the question genuinely spans pipelines — counting open
 * tickets, say, where scoping would drop every ticket outside the default
 * pipeline instead of counting it.
 */
export function stageRoles(
  stages: PipelineStage[] | undefined,
  pipelineId?: number | null,
): StageRoles {
  const scoped =
    pipelineId == null
      ? (stages ?? [])
      : (stages ?? []).filter((s) => s.PipelineId === pipelineId);
  const ordered = [...scoped].sort(
    (a, b) => (a.SortOrder ?? 0) - (b.SortOrder ?? 0),
  );
  const won = ordered.filter((s) => s.StageType === "won");

  return {
    ordered,
    first: ordered.find((s) => s.StageType === "open") ?? ordered[0] ?? null,
    resolved: won[0] ?? null,
    // One `won` stage means resolved and closed are the same thing; a pipeline
    // is allowed to be that simple.
    closed: won[won.length - 1] ?? null,
    rejected: ordered.find((s) => s.StageType === "lost") ?? null,
  };
}

/** Where a ticket sits, read from its stage — never from its timestamps. */
export function lifecycleOf(
  ticket: Pick<Ticket, "StageId">,
  roles: StageRoles,
): Lifecycle {
  if (ticket.StageId == null) return "unknown";
  const stage = roles.ordered.find((s) => s.Id === ticket.StageId);
  if (!stage) return "unknown";
  if (stage.StageType === "lost") return "rejected";
  if (stage.StageType === "open") return "open";
  return stage.Id === roles.closed?.Id && roles.closed?.Id !== roles.resolved?.Id
    ? "closed"
    : stage.Id === roles.resolved?.Id
      ? "resolved"
      : "closed";
}

export const stageOf = (
  ticket: Pick<Ticket, "StageId">,
  roles: StageRoles,
): PipelineStage | null =>
  roles.ordered.find((s) => s.Id === ticket.StageId) ?? null;

/** Entering the Resolved stage needs a reason; every other move does not. */
export const needsResolution = (
  stage: PipelineStage,
  roles: StageRoles,
): boolean => stage.Id === roles.resolved?.Id;

export const STAGE_TONE: Record<StageType, "info" | "success" | "danger"> = {
  open: "info",
  won: "success",
  lost: "danger",
};

/** Group tickets by lifecycle, preserving the server's order within each. */
export function groupByLifecycle(
  tickets: Ticket[],
  roles: StageRoles,
): { lifecycle: Lifecycle; tickets: Ticket[] }[] {
  const buckets = new Map<Lifecycle, Ticket[]>();
  for (const ticket of tickets) {
    const key = lifecycleOf(ticket, roles);
    const list = buckets.get(key);
    if (list) list.push(ticket);
    else buckets.set(key, [ticket]);
  }
  return LIFECYCLE_ORDER.filter((l) => buckets.get(l)?.length).map(
    (lifecycle) => ({ lifecycle, tickets: buckets.get(lifecycle)! }),
  );
}

// ------------------------------------------------------------ custom fields

/**
 * A stored value, back in the shape the form edits. The EAV row splits by type
 * across three columns and only one of them is populated.
 */
export function draftFromValues(
  values: CustomFieldValue[],
): Record<number, string | boolean> {
  const draft: Record<number, string | boolean> = {};
  for (const value of values) {
    if (value.Type === "checkbox") {
      draft[value.FieldId] = value.ValueText === "true" || value.ValueNumber === 1;
    } else if (value.Type === "number") {
      draft[value.FieldId] = value.ValueNumber == null ? "" : String(value.ValueNumber);
    } else if (value.Type === "date") {
      draft[value.FieldId] = value.ValueDate ? value.ValueDate.slice(0, 10) : "";
    } else {
      draft[value.FieldId] = value.ValueText ?? "";
    }
  }
  return draft;
}

/** Seed a blank entry per definition so every field is controlled from render one. */
export function blankDraft(
  defs: CustomFieldDef[],
): Record<number, string | boolean> {
  const draft: Record<number, string | boolean> = {};
  for (const def of defs) draft[def.Id] = def.Type === "checkbox" ? false : "";
  return draft;
}

/** The `CustomJSON` payload sp_SaveTicket expects. */
export const serialiseCustomFields = (
  defs: CustomFieldDef[],
  draft: Record<number, string | boolean>,
): string | null =>
  defs.length
    ? JSON.stringify(
        defs.map((def) => ({
          fieldId: def.Id,
          type: def.Type,
          value: draft[def.Id] ?? (def.Type === "checkbox" ? false : ""),
        })),
      )
    : null;

/** Which required custom fields are still empty. Empty array = good to submit. */
export const missingRequired = (
  defs: CustomFieldDef[],
  draft: Record<number, string | boolean>,
): CustomFieldDef[] =>
  defs.filter((def) => {
    if (!def.IsRequired) return false;
    const value = draft[def.Id];
    // An unticked required checkbox is a genuine "you must agree" — treat
    // false as missing, the same way the web does.
    if (def.Type === "checkbox") return value !== true;
    return !String(value ?? "").trim();
  });
