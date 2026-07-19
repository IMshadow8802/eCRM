import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../utils/axiosConfig", () => ({
  apiClient: { post: vi.fn() },
}));

import { apiClient } from "../utils/axiosConfig";
import {
  fetchAttachments,
  uploadAttachment,
  deleteAttachment,
  downloadAttachment,
  fetchAttachmentBlob,
} from "./attachmentQueries";

beforeEach(() => vi.clearAllMocks());

describe("attachmentQueries", () => {
  it("fetch posts Entity/EntityId with Id 0", () => {
    apiClient.post.mockResolvedValue({});
    fetchAttachments({ Entity: "lead", EntityId: 5 });
    expect(apiClient.post).toHaveBeenCalledWith("/api/attachments/fetch", {
      Entity: "lead",
      EntityId: 5,
      Id: 0,
    });
  });

  it("upload builds FormData with fields in Entity → EntityId → file order", () => {
    apiClient.post.mockResolvedValue({});
    const file = new File(["x"], "a.png", { type: "image/png" });
    uploadAttachment({ Entity: "ticket", EntityId: 9, file });

    const [url, body, config] = apiClient.post.mock.calls[0];
    expect(url).toBe("/api/attachments/save");
    expect(body).toBeInstanceOf(FormData);
    expect([...body.keys()]).toEqual(["Entity", "EntityId", "file"]);
    expect(body.get("Entity")).toBe("ticket");
    expect(body.get("EntityId")).toBe("9");
    expect(body.get("file")).toBe(file);
  });

  // REGRESSION: the apiClient instance defaults Content-Type to
  // application/json, which overrides the multipart boundary for FormData —
  // the server then sees zero parts and answers NO_FILE. The upload call must
  // explicitly declare multipart/form-data so axios generates the boundary.
  it("upload overrides the instance's JSON content-type with multipart", () => {
    apiClient.post.mockResolvedValue({});
    uploadAttachment({
      Entity: "ticket",
      EntityId: 9,
      file: new File(["x"], "a.png", { type: "image/png" }),
    });
    const [, , config] = apiClient.post.mock.calls[0];
    expect(config).toEqual({ headers: { "Content-Type": "multipart/form-data" } });
  });

  it("delete posts the Id", () => {
    apiClient.post.mockResolvedValue({});
    deleteAttachment({ Id: 3 });
    expect(apiClient.post).toHaveBeenCalledWith("/api/attachments/delete", { Id: 3 });
  });

  it("download requests a blob and triggers a browser download", async () => {
    const blob = new Blob(["data"]);
    apiClient.post.mockResolvedValue({ data: blob });
    const createURL = vi.fn(() => "blob:url");
    const revokeURL = vi.fn();
    URL.createObjectURL = createURL;
    URL.revokeObjectURL = revokeURL;
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    await downloadAttachment({ Id: 7, FileName: "report.pdf" });

    expect(apiClient.post).toHaveBeenCalledWith(
      "/api/attachments/download",
      { Id: 7 },
      { responseType: "blob" },
    );
    expect(createURL).toHaveBeenCalledWith(blob);
    expect(clickSpy).toHaveBeenCalled();
    expect(revokeURL).toHaveBeenCalledWith("blob:url");
    clickSpy.mockRestore();
  });

  it("fetchAttachmentBlob returns blob + object URL without triggering a download", async () => {
    const blob = new Blob(["data"]);
    apiClient.post.mockResolvedValue({ data: blob });
    URL.createObjectURL = vi.fn(() => "blob:preview");
    URL.revokeObjectURL = vi.fn();
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    const res = await fetchAttachmentBlob({ Id: 7 });

    expect(apiClient.post).toHaveBeenCalledWith(
      "/api/attachments/download",
      { Id: 7 },
      { responseType: "blob" },
    );
    expect(res).toEqual({ blob, url: "blob:preview" });
    expect(clickSpy).not.toHaveBeenCalled();
    expect(URL.revokeObjectURL).not.toHaveBeenCalled(); // caller owns the URL
    clickSpy.mockRestore();
  });
});
