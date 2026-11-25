// Phone-mark fetcher against backend/src/controllers/phoneMarkController.js.
import { lastRequest, respond } from "../test/transport";
import { setPhoneMark } from "./phoneMarkQueries";

it("posts Mobile, Mark and Note to /api/phoneMark/set and nothing else", async () => {
  const env = { success: true, message: "Done", data: { Id: 3 } };
  respond(env);
  const p = { Mobile: "9825012345", Mark: "caution" as const, Note: "Speaks Punjabi", Source: "admin" };
  await expect(setPhoneMark(p)).resolves.toEqual(env);
  expect(lastRequest().url).toBe("/api/phoneMark/set");
  expect(lastRequest().body).toStrictEqual({ Mobile: "9825012345", Mark: "caution", Note: "Speaks Punjabi" });
});
