// Shared MSW fixtures for the TAT tab / reason dialog tests (Task 7 routes are
// mocked: data { clocks, holds, events } from sp_FetchTaskTat's three sets).
import { http, HttpResponse } from "msw";

export const LOOKUPS = {
  task_hold_reason: [
    { Id: 61, Code: "waiting_client", Value: "Waiting on client" },
    { Id: 63, Code: "other", Value: "Other" },
  ],
  task_breach_reason: [
    { Id: 71, Code: "waiting", Value: "Waiting on someone" },
    { Id: 74, Code: "other", Value: "Other" },
  ],
};

const ok = (data = {}, message = "ok") => HttpResponse.json({ success: true, message, responseCode: 200, data });

// Records every /api/tat/* body as [route, body] in `calls`.
export function tatHandlers({ tat = { clocks: [], holds: [], events: [] }, calls = [] } = {}) {
  return [
    http.post("*/api/config/fetchLookups", async ({ request }) => {
      const { Kind } = await request.json();
      return ok({ lookups: LOOKUPS[Kind] ?? [] });
    }),
    http.post("*/api/tat/fetchTaskTat", async () => ok(tat)),
    http.post("*/api/tat/:route", async ({ request, params }) => {
      calls.push([params.route, await request.json()]);
      return ok({}, "Saved");
    }),
  ];
}
