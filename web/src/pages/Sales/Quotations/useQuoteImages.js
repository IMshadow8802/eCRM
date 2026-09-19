import { useCallback, useEffect, useRef, useState } from "react";
import { fetchAttachmentBlob, uploadAttachment } from "../../../api/attachmentQueries";

// The PDF engine draws PNG and JPEG. The generic upload pipeline also accepts
// WebP and GIF, which would arrive in the quotation as an empty box.
const DRAWABLE = ["image/png", "image/jpeg"];
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

const toDataUrl = (blob) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result);
  reader.onerror = () => reject(reader.error);
  reader.readAsDataURL(blob);
});

/** Every attachment id a quotation needs drawn. */
export function imageIdsOf(form) {
  if (!form) return [];
  const c = form.Company ?? {};
  return [
    c.showLogo !== false ? c.logoAttachmentId : null,
    c.showHeader !== false ? c.headerAttachmentId : null,
    ...(form.Content?.sections ?? []).flatMap((s) => (s.type === "images" ? (s.items ?? []).map((i) => i.attachmentId) : [])),
  ].filter(Boolean);
}

/**
 * Attachment ids → data URLs. Attachments are JWT-gated, so neither an
 * <img src> nor the PDF engine can fetch one; this downloads each id ONCE
 * through the authenticated client. An id that is not loaded yet is simply
 * absent — buildQuoteDoc then draws nothing, never the sample art.
 */
export function useQuoteImages(ids) {
  const [images, setImages] = useState({});
  const asked = useRef(new Set());
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

  const key = [...new Set(ids.filter(Boolean))].sort((a, b) => a - b).join(",");

  useEffect(() => {
    for (const id of key ? key.split(",").map(Number) : []) {
      if (asked.current.has(id)) continue;
      asked.current.add(id);
      fetchAttachmentBlob({ Id: id })
        .then(async ({ blob, url }) => {
          URL.revokeObjectURL(url); // the helper made an object URL we have no use for
          const dataUrl = await toDataUrl(blob);
          if (mounted.current) setImages((m) => ({ ...m, [id]: dataUrl }));
        })
        .catch(() => { asked.current.delete(id); }); // forgotten, so the next change retries it
    }
  }, [key]);

  /** A just-uploaded image is already in hand — do not download it back. */
  const prime = useCallback((id, dataUrl) => {
    asked.current.add(id);
    setImages((m) => ({ ...m, [id]: dataUrl }));
  }, []);

  return { images, prime };
}

/** Validates, uploads, and returns `{ id, dataUrl }`. Throws an Error whose message is ready to show. */
export async function uploadImage({ entity, entityId, file }) {
  if (!DRAWABLE.includes(file?.type)) throw new Error("Use a PNG or JPEG image");
  if (file.size > MAX_IMAGE_BYTES) throw new Error("Images must be 2 MB or smaller");
  try {
    const res = await uploadAttachment({ Entity: entity, EntityId: entityId, file });
    return { id: res.data.data.attachmentId, dataUrl: await toDataUrl(file) };
  } catch (err) {
    throw new Error(err?.response?.data?.message || "The image could not be uploaded");
  }
}
