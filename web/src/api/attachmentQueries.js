// src/api/attachmentQueries.js
// Thin POST fetchers for the shared attachments feature (task/ticket/lead).
// Mirrors salesQueries.js — apiClient.post wrappers — with two special cases:
// upload is multipart FormData (field order matters), download is a blob.
import { apiClient } from "../utils/axiosConfig";

export const ATTACHMENT_ENDPOINTS = {
  fetch: "/api/attachments/fetch",
  save: "/api/attachments/save",
  download: "/api/attachments/download",
  delete: "/api/attachments/delete",
};

export const fetchAttachments = ({ Entity, EntityId }) =>
  apiClient.post(ATTACHMENT_ENDPOINTS.fetch, { Entity, EntityId, Id: 0 });

// Field order matters — the server reads Entity/EntityId before the file stream.
export const uploadAttachment = ({ Entity, EntityId, file }) => {
  const form = new FormData();
  form.append("Entity", Entity);
  form.append("EntityId", EntityId);
  form.append("file", file);
  // The apiClient instance defaults Content-Type to application/json, which
  // silently overrides the multipart boundary for FormData bodies — multer
  // then parses zero parts and the server answers NO_FILE. Declaring
  // multipart/form-data makes axios (re)generate the boundary itself.
  return apiClient.post(ATTACHMENT_ENDPOINTS.save, form, {
    headers: { "Content-Type": "multipart/form-data" },
  });
};

export const deleteAttachment = ({ Id }) =>
  apiClient.post(ATTACHMENT_ENDPOINTS.delete, { Id });

// Fetch the file as a blob and trigger a browser download via a temporary <a>.
export const downloadAttachment = async ({ Id, FileName }) => {
  const res = await apiClient.post(
    ATTACHMENT_ENDPOINTS.download,
    { Id },
    { responseType: "blob" },
  );
  const url = URL.createObjectURL(res.data);
  const a = document.createElement("a");
  a.href = url;
  a.download = FileName || "download";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  return res;
};
