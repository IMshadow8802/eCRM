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

    const [url, body] = apiClient.post.mock.calls[0];
    expect(url).toBe("/api/attachments/save");
    expect(body).toBeInstanceOf(FormData);
    expect([...body.keys()]).toEqual(["Entity", "EntityId", "file"]);
    expect(body.get("Entity")).toBe("ticket");
    expect(body.get("EntityId")).toBe("9");
    expect(body.get("file")).toBe(file);
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
});
