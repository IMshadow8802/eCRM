// src/pages/Settings/Lookups.jsx
//
// Company-admin page for the generic per-company lookups (tblLookup) that are
// not big enough to deserve their own screen. Unlike Priorities and Ticket
// Categories it spans several kinds, so LookupMaster renders its tab strip.
import LookupMaster from "./LookupMaster";

const KIND_OPTIONS = [
  { value: "lead_source", label: "Lead Sources" },
  { value: "call_outcome", label: "Call Outcomes" },
  { value: "lost_reason", label: "Lost Reasons" },
  // tblTicket.ResolutionId points at Kind='resolution' (required to resolve
  // a ticket — sp_ResolveTicket rejects without one).
  { value: "resolution", label: "Ticket Resolutions" },
];

const Lookups = () => (
  <LookupMaster
    title="Lookups"
    subtitle="Manage lead source, call outcome, lost-reason and ticket-resolution lists."
    documentTitle="Lookups"
    noun="Lookup"
    kinds={KIND_OPTIONS}
    placeholder="e.g. Website"
  />
);

export default Lookups;
