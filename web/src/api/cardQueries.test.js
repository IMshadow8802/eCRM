import { describe, it, expect, vi } from "vitest";
import { http, HttpResponse } from "msw";

import { CARD_ENDPOINTS, fetchCardPhoto } from "./cardQueries";
import { server } from "../test/mocks/server";

describe("cardQueries", () => {
  it("names the endpoint", () => expect(CARD_ENDPOINTS.fetchCard).toBe("/api/Card/fetchCard"));

  it("turns the photo into an object URL", async () => {
    URL.createObjectURL = vi.fn(() => "blob:abc");
    server.use(http.get("*/uploads/cards/u/front.jpg", () => new HttpResponse(new Blob(["x"]), { headers: { "Content-Type": "image/jpeg" } })));
    expect(await fetchCardPhoto("cards/u/front.jpg")).toEqual({ url: "blob:abc" });
  });

  it("rejects when the photo is not visible", async () => {
    server.use(http.get("*/uploads/*", () => new HttpResponse(null, { status: 404 })));
    await expect(fetchCardPhoto("cards/u/x.jpg")).rejects.toBeTruthy();
  });
});
