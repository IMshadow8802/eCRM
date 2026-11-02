// Today fetchers against backend/src/controllers/todayController.js.
// Only the wire is fake (src/test/transport).
import { lastRequest, respond } from "../test/transport";
import { fetchMyDay } from "./todayQueries";

it("fetchMyDay posts an empty body (= today) to /api/today/mine and resolves the envelope", async () => {
  const body = { success: true, message: "Your day fetched", data: { day: { key: "2026-11-02", live: true }, me: null } };
  respond(body);
  await expect(fetchMyDay()).resolves.toEqual(body);
  expect(lastRequest().url).toBe("/api/today/mine");
  expect(lastRequest().config.method).toBe("post");
  expect(lastRequest().body).toStrictEqual({});
});
