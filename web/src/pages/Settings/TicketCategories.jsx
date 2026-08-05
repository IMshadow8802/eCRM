// src/pages/Settings/TicketCategories.jsx
// Company-admin CRUD master for ticket categories — LookupMaster pinned to
// Kind="ticket_category", so the single kind renders no tab strip.
import LookupMaster from "./LookupMaster";

const TicketCategories = () => (
  <LookupMaster
    title="Ticket Categories"
    subtitle="Manage the categories tickets can be filed under."
    documentTitle="Ticket Categories"
    noun="Category"
    kinds={[{ value: "ticket_category", label: "Ticket Categories" }]}
    placeholder="e.g. Billing"
  />
);

export default TicketCategories;
