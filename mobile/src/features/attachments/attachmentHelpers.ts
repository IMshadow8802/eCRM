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
  if (["xls", "xlsx", "csv"].includes(ext))
    return { Icon: Table, tint: "success" };
  if (["doc", "docx"].includes(ext))
    return { Icon: FileText, tint: "primary" };
  if (["apk", "aab"].includes(ext))
    return { Icon: Smartphone, tint: "success" };
  if (["zip", "rar", "7z"].includes(ext))
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
