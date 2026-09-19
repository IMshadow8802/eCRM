import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";

vi.mock("../../../api/attachmentQueries", () => ({ fetchAttachmentBlob: vi.fn(), uploadAttachment: vi.fn() }));

import { fetchAttachmentBlob, uploadAttachment } from "../../../api/attachmentQueries";
import { useQuoteImages, uploadImage, imageIdsOf, MAX_IMAGE_BYTES } from "./useQuoteImages";

const pngBlob = () => new Blob(["png-bytes"], { type: "image/png" });

beforeEach(() => {
  vi.clearAllMocks();
  URL.revokeObjectURL = vi.fn();
  fetchAttachmentBlob.mockImplementation(async () => ({ blob: pngBlob(), url: "blob:tmp" }));
});

describe("useQuoteImages", () => {
  it("downloads each id once and exposes a data URL the PDF can draw", async () => {
    const { result, rerender } = renderHook(({ ids }) => useQuoteImages(ids), { initialProps: { ids: [12, 12, null, 21] } });
    await waitFor(() => expect(Object.keys(result.current.images)).toHaveLength(2));
    expect(result.current.images[12]).toMatch(/^data:image\/png;base64,/);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:tmp"); // the helper's object URL is not ours to keep
    rerender({ ids: [21, 12] });
    rerender({ ids: [12, 21, 33] });
    await waitFor(() => expect(result.current.images[33]).toBeTruthy());
    expect(fetchAttachmentBlob).toHaveBeenCalledTimes(3); // 12, 21, 33 — never twice
  });

  it("lets a failed download be retried on the next change, and draws nothing meanwhile", async () => {
    fetchAttachmentBlob.mockRejectedValueOnce(new Error("403"));
    const { result, rerender } = renderHook(({ ids }) => useQuoteImages(ids), { initialProps: { ids: [12] } });
    await waitFor(() => expect(fetchAttachmentBlob).toHaveBeenCalledTimes(1));
    expect(result.current.images[12]).toBeUndefined();
    rerender({ ids: [12, 21] });
    await waitFor(() => expect(result.current.images[12]).toBeTruthy());
  });

  it("takes a just-uploaded image without downloading it back", async () => {
    const { result, rerender } = renderHook(({ ids }) => useQuoteImages(ids), { initialProps: { ids: [] } });
    act(() => result.current.prime(55, "data:image/png;base64,AAA"));
    rerender({ ids: [55] });
    expect(result.current.images[55]).toBe("data:image/png;base64,AAA");
    expect(fetchAttachmentBlob).not.toHaveBeenCalled();
  });
});

describe("uploadImage", () => {
  const file = (name, type, size = 10) => { const f = new File(["x".repeat(size)], name, { type }); return f; };

  it("uploads a PNG/JPEG and returns the new id with a ready data URL", async () => {
    uploadAttachment.mockResolvedValue({ data: { data: { attachmentId: 77 } } });
    const out = await uploadImage({ entity: "quoteprofile", entityId: 3, file: file("logo.png", "image/png") });
    expect(uploadAttachment).toHaveBeenCalledWith({ Entity: "quoteprofile", EntityId: 3, file: expect.any(File) });
    expect(out.id).toBe(77);
    expect(out.dataUrl).toMatch(/^data:image\/png/);
  });

  // The PDF engine cannot draw WebP or GIF; the generic upload pipeline accepts
  // both. Refuse here, in words, rather than show a blank box in the quotation.
  it.each([["a.webp", "image/webp"], ["a.gif", "image/gif"], ["a.pdf", "application/pdf"]])("refuses %s", async (name, type) => {
    await expect(uploadImage({ entity: "quotation", entityId: 4, file: file(name, type) })).rejects.toThrow("Use a PNG or JPEG image");
    expect(uploadAttachment).not.toHaveBeenCalled();
  });

  it("refuses an image over 2 MB", async () => {
    const big = file("big.jpg", "image/jpeg"); Object.defineProperty(big, "size", { value: MAX_IMAGE_BYTES + 1 });
    await expect(uploadImage({ entity: "quotation", entityId: 4, file: big })).rejects.toThrow("Images must be 2 MB or smaller");
  });

  it("surfaces the server's own message when it refuses", async () => {
    uploadAttachment.mockRejectedValue({ response: { data: { message: "Only a draft quotation's pictures can be changed" } } });
    await expect(uploadImage({ entity: "quotation", entityId: 4, file: file("a.png", "image/png") })).rejects.toThrow("Only a draft quotation's pictures can be changed");
  });
});

describe("imageIdsOf", () => {
  it("collects the letterhead and every section picture, skipping what is switched off", () => {
    const form = { Company: { logoAttachmentId: 12, headerAttachmentId: 13, showHeader: false },
      Content: { sections: [{ type: "text" }, { type: "images", items: [{ attachmentId: 21 }, { attachmentId: null }] }] } };
    expect(imageIdsOf(form)).toEqual([12, 21]);
    expect(imageIdsOf(null)).toEqual([]);
  });
});
