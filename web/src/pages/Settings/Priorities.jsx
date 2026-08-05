// src/pages/Settings/Priorities.jsx
// Company-admin CRUD master for ticket priorities — LookupMaster pinned to
// Kind="priority", so the single kind renders no tab strip.
import LookupMaster from "./LookupMaster";

const Priorities = () => (
  <LookupMaster
    title="Priorities"
    subtitle="Manage the priority levels tickets can be assigned."
    documentTitle="Priorities"
    noun="Priority"
    kinds={[{ value: "priority", label: "Priorities" }]}
    placeholder="e.g. High"
  />
);

export default Priorities;
