import { useState } from "react";
import { Directory, File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";

import { attachmentDownloadRequest } from "../../api/attachmentQueries";
import type { Attachment } from "../../types/api";

/**
 * Saves an attachment to the device and hands it to the share sheet.
 *
 * `File.downloadFileAsync` writes the bytes as they arrive, which is the whole
 * point: the POST download route buffers the entire response in JS memory
 * before anything reaches storage, and a 200MB build will run the phone out of
 * memory long before it finishes. That is why the backend grew a GET form.
 *
 * The share sheet is the save UI. iOS has no user-visible filesystem — "Save to
 * Files" IS a share target — and on Android it offers the same plus every app
 * that can open the type. An APK shared this way lands in the installer, which
 * is what "download the build" actually means on a phone.
 */
export function useDownloadAttachment() {
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const download = async (attachment: Attachment) => {
    const request = attachmentDownloadRequest(attachment.Id);
    if (!request) {
      setError("You are signed out. Sign in and try again.");
      return;
    }

    setBusyId(attachment.Id);
    setError(null);
    try {
      // Its own folder under cache: two attachments can share a file name, and
      // writing both to the cache root would have one silently overwrite the
      // other mid-download.
      const folder = new Directory(Paths.cache, `attachments/${attachment.Id}`);
      folder.create({ intermediates: true, idempotent: true });

      const file = await File.downloadFileAsync(
        request.url,
        new File(folder, attachment.FileName),
        { headers: request.headers, idempotent: true },
      );

      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(file.uri, {
          mimeType: attachment.MimeType ?? undefined,
          dialogTitle: attachment.FileName,
        });
      } else {
        setError("This device has no way to open or save the file.");
      }
    } catch (err) {
      setError(
        err instanceof Error && err.message
          ? `Download failed: ${err.message}`
          : "Download failed. Check your connection and try again.",
      );
    } finally {
      setBusyId(null);
    }
  };

  return { download, busyId, error, clearError: () => setError(null) };
}
