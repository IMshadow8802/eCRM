// src/api/tatQueries.js
// Task TAT clocks (backend routes/tatRoutes.js). The policy endpoints live in
// workQueries.js with the rest of the work settings.
export const TAT_ENDPOINTS = {
  fetchTaskTat: "/api/tat/fetchTaskTat",
  acknowledge: "/api/tat/acknowledge",
  hold: "/api/tat/hold",
  release: "/api/tat/release",
  myPartDone: "/api/tat/myPartDone",
  saveReason: "/api/tat/saveReason",
  saveVerdict: "/api/tat/saveVerdict",
};
