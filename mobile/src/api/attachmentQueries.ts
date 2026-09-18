// src/api/attachmentQueries.ts
// Multipart upload + blob download. Mirrors web/src/api/attachmentQueries.js.
import { apiClient, getApiBaseUrl, getAuthToken, post, postData } from "./client";
import type { ApiEnvelope, Attachment, AttachmentEntity } from "../types/api";

export const ATTACHMENT_ENDPOINTS = {
  fetch: "/api/attachments/fetch",
  save: "/api/attachments/save",
  download: "/api/attachments/download",
  delete: "/api/attachments/delete",
} as const;

/** React Native's file shape — what expo-image-picker / document-picker return. */
export interface PickedFile {
  uri: string;
  name: string;
  type?: string | null;
}

export const fetchAttachments = (params: {
  Entity: AttachmentEntity;
  EntityId: number;
}): Promise<Attachment[]> =>
  postData<Attachment>(
    ATTACHMENT_ENDPOINTS.fetch,
    { Id: 0, ...params },
    "attachments",
  );

/**
 * Upload one file. Two ordering rules, both load-bearing:
 *
 *   1. Entity/EntityId are appended BEFORE the file part. multer's
 *      diskStorage.destination() reads req.body.Entity while the stream is
 *      still being parsed; append the file first and it lands in uploads/misc/.
 *   2. Content-Type must be set explicitly. The client instance defaults to
 *      application/json, which overrides the multipart boundary — multer then
 *      parses zero parts and the server answers NO_FILE.
 */
export const uploadAttachment = ({
  Entity,
  EntityId,
  file,
}: {
  Entity: AttachmentEntity;
  EntityId: number;
  file: PickedFile;
}): Promise<ApiEnvelope<{ attachmentId: number }>> => {
  const form = new FormData();
  form.append("Entity", Entity);
  form.append("EntityId", String(EntityId));
  // RN's FormData takes this object shape for files; the DOM type doesn't
  // describe it, hence the cast.
  form.append("file", {
    uri: file.uri,
    name: file.name,
    type: file.type || "application/octet-stream",
  } as unknown as Blob);

  return post(ATTACHMENT_ENDPOINTS.save, form, {
    headers: { "Content-Type": "multipart/form-data" },
    // Builds run to 200MB (backend MAX_SIZE); the 30s default would abort a
    // large upload on a phone connection long before it finished.
    timeout: 0,
  });
};

/** Raw bytes, for preview. Caller owns the returned blob. */
export const fetchAttachmentBlob = ({ Id }: { Id: number }): Promise<Blob> =>
  apiClient
    .post(ATTACHMENT_ENDPOINTS.download, { Id }, { responseType: "blob" })
    .then((res) => res.data as Blob);

/**
 * Absolute URL + headers for streaming an attachment straight to disk.
 *
 * The POST download buffers the whole response in JS memory before anything
 * touches storage, which a 200MB build does not survive on a phone. The GET
 * form exists so `expo-file-system` can write it as it arrives — but that API
 * issues GETs only and takes a plain URL, so it cannot go through the axios
 * instance and needs the base URL and the token handed to it.
 *
 * Returns null when there is no token, rather than firing a request that is
 * guaranteed to 401.
 */
export const attachmentDownloadRequest = (
  Id: number,
): { url: string; headers: Record<string, string> } | null => {
  const token = getAuthToken();
  const base = getApiBaseUrl();
  if (!token || !base) return null;
  return {
    url: `${base}${ATTACHMENT_ENDPOINTS.download}/${Id}`,
    headers: { Authorization: `Bearer ${token}` },
  };
};

export const deleteAttachment = (params: {
  Id: number;
}): Promise<ApiEnvelope<unknown>> => post(ATTACHMENT_ENDPOINTS.delete, params);
