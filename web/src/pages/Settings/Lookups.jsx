// src/pages/Settings/Lookups.jsx
//
// Company-admin page for the generic per-company lookups (tblLookup) that are
// not big enough to deserve their own screen. Unlike Priorities and Ticket
// Categories it spans several kinds, so LookupMaster renders its tab strip.
import LookupMaster from "./LookupMaster";

const KIND_OPTIONS = [
  { value: "lead_source", label: "Lead Sources" },
  // Spec 1: the lead lifecycle is a status list, not a pipeline; products and
  // transfers get their own lists too.
  { value: "lead_status", label: "Lead Statuses" },
  { value: "product_category", label: "Product Categories" },
  { value: "transfer_reason", label: "Transfer Reasons" },
  { value: "call_outcome", label: "Call Outcomes" },
  { value: "lost_reason", label: "Lost Reasons" },
  // tblTicket.ResolutionId points at Kind='resolution' (required to resolve a
  // complaint — sp_SetTicketStatus rejects without one).
  { value: "resolution", label: "Ticket Resolutions" },
  // Spec 2: the complaint lifecycle is a flat status list with a Code, and the
  // channel stops being a string hardcoded in the web and mobile clients.
  { value: "ticket_status", label: "Complaint Statuses" },
  { value: "ticket_channel", label: "Complaint Channels" },
];

const Lookups = () => (
  <LookupMaster
    title="Lookups"
    subtitle="Manage the lead and complaint status lists, sources, product categories, transfer reasons, call outcomes, lost reasons, resolutions and complaint channels."
    documentTitle="Lookups"
    noun="Lookup"
    kinds={KIND_OPTIONS}
    placeholder="e.g. Website"
  />
);

export default Lookups;
