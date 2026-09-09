// The lookup's Code is the machine meaning behind an editable label.
// open | qualified = still being worked; lost | junk | converted = closed.
export const isActiveCode = (code) => code === "open" || code === "qualified";

export const LEAD_PRESETS = [
  { value: "all", label: "All" },
  { value: "mine", label: "My leads" },
  { value: "overdue", label: "Overdue" },
  { value: "unassigned", label: "Unassigned" },
  { value: "lost", label: "Lost" },
];

export const presetParams = (preset, userId) => {
  switch (preset) {
    case "mine": return { OwnerId: userId };
    case "overdue": return { Overdue: true };
    case "unassigned": return { Unassigned: true };
    case "lost": return { StatusCode: "lost" };
    default: return {};
  }
};

export const FOLLOWUP_TYPES = [
  { value: "call", label: "Call" },
  { value: "visit", label: "Visit" },
  { value: "meeting", label: "Meeting" },
  { value: "other", label: "Other" },
];

export const DIRECTIONS = [
  { value: "out", label: "Outgoing" },
  { value: "in", label: "Incoming" },
];
