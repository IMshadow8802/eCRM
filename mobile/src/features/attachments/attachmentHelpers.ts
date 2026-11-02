import {
  File as FileIcon,
  FileArchive,
  FileText,
  Image as ImageIcon,
  Film,
  Smartphone,
  Table,
  type LucideIcon,
} from "lucide-react-native";

import { colors } from "../../theme";

/** Icon + colour per file kind, so a list of files is scannable at a glance. */
export function fileMeta(
  fileName: string,
  mimeType: string | null,
): { Icon: LucideIcon; tint: keyof typeof colors } {
  const mime = mimeType ?? "";
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";

  if (mime.startsWith("image/")) return { Icon: ImageIcon, tint: "info" };
  if (mime.startsWith("video/")) return { Icon: Film, tint: "neutralIcon" };
  if (mime === "application/pdf" || ext === "pdf")
    return { Icon: FileText, tint: "danger" };
  if (["xls", "xlsx"].includes(ext))
    return { Icon: Table, tint: "success" };
  if (["doc", "docx"].includes(ext))
    return { Icon: FileText, tint: "primary" };
  if (["apk", "aab"].includes(ext))
    return { Icon: Smartphone, tint: "success" };
  if (ext === "zip")
    return { Icon: FileArchive, tint: "priorityMedium" };
  return { Icon: FileIcon, tint: "textSecondary" };
}

/** "2.4 MB" — files here run from a few KB to a 200MB build. */
export function humanSize(bytes: number | null | undefined): string {
  if (bytes == null || Number.isNaN(bytes)) return "";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[i]}`;
}

/** The backend cap — mirrors MAX_SIZE in backend/src/middleware/upload.js. */
export const MAX_UPLOAD_BYTES = 200 * 1024 * 1024;

/**
 * What upload.js accepts, by extension — web's TYPES (components/Attachments.jsx).
 * Checked before sending, so a refused type does not upload in full first.
 */
// Extension → the mime upload.js pairs it with (its ALLOWED). null = EXT_ONLY:
// the server ignores the mime for builds and archives.
const EXT_MIME: Record<string, string | null> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp",
  mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime",
  pdf: "application/pdf",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  apk: null, aab: null, zip: null,
};

const extOf = (name: string) => (name.includes(".") ? name.split(".").pop()!.toLowerCase() : "");

/** Why the server would refuse this file's type, in web's words — or null when it is allowed. */
export function refusedType(name: string): string | null {
  const ext = extOf(name);
  return ext in EXT_MIME ? null : `"${name}" — file type .${ext} is not allowed`;
}

/** What a picker hands back, whichever picker it was. */
export interface PickedAsset {
  uri: string;
  name: string;
  mimeType?: string | null;
  size?: number | null;
}

/**
 * The one gate every picker goes through before anything uploads: type, then
 * size. What passes is named so upload.js accepts it — a .HEIC-named JPEG
 * becomes .jpg, and the mime is the one the server pairs with the extension
 * (pickers often give none, or application/octet-stream, which it refuses).
 */
export function screenPicked(assets: PickedAsset[]): { files: { uri: string; name: string; type: string }[]; refused: string[] } {
  const files: { uri: string; name: string; type: string }[] = [];
  const refused: string[] = [];
  for (const a of assets) {
    const name = uploadName(a.name, a.mimeType);
    const reason =
      refusedType(name) ??
      (a.size != null && a.size > MAX_UPLOAD_BYTES ? `"${a.name}" is larger than the ${humanSize(MAX_UPLOAD_BYTES)} limit.` : null);
    if (reason) refused.push(reason);
    else files.push({ uri: a.uri, name, type: EXT_MIME[extOf(name)] ?? a.mimeType ?? "application/octet-stream" });
  }
  return { files, refused };
}

/**
 * The name to upload under. iOS hands over JPEG bytes (mime image/jpeg) still
 * named IMG_x.HEIC; upload.js needs mime and extension to agree, so such a file
 * is renamed `.jpg`. Every other name goes as picked.
 */
export function uploadName(name: string, mimeType: string | null | undefined): string {
  const ext = extOf(name);
  if (mimeType !== "image/jpeg" || ext === "jpg" || ext === "jpeg") return name;
  return `${ext ? name.slice(0, -(ext.length + 1)) : name}.jpg`;
}

/** DocumentPicker's filter: upload.js's mimes, plus the build types a picker labels generically. */
export const PICKER_TYPES = [
  "image/png", "image/jpeg", "image/gif", "image/webp",
  "video/mp4", "video/webm", "video/quicktime",
  "application/pdf",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.android.package-archive",
  "application/zip",
  // .aab (and an .apk from some providers) has no mime of its own.
  "application/octet-stream",
];
