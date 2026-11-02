import { FileArchive, FileText, Film, File as FileIcon, Image as ImageIcon, Smartphone, Table } from "lucide-react-native";

import { fileMeta, humanSize, MAX_UPLOAD_BYTES } from "./attachmentHelpers";

// parity: ATT-01 — csv/rar/7z are listed here though the backend refuses them; not pinned.
it.each([
  ["photo.HEIC", "image/jpeg", ImageIcon, "info"],
  ["clip.mov", "video/quicktime", Film, "neutralIcon"],
  ["quote.pdf", null, FileText, "danger"],
  ["scan.bin", "application/pdf", FileText, "danger"],
  ["sheet.XLSX", null, Table, "success"],
  ["letter.docx", null, FileText, "primary"],
  ["build.apk", null, Smartphone, "success"],
  ["logs.zip", null, FileArchive, "priorityMedium"],
  ["README", null, FileIcon, "textSecondary"],
])("%s (%s) gets its own icon", (name, mime, Icon, tint) => {
  expect(fileMeta(name, mime)).toEqual({ Icon, tint });
});

it.each([
  [null, ""],
  [undefined, ""],
  [Number.NaN, ""],
  [0, "0 B"],
  [1023, "1023 B"],
  [1536, "1.5 KB"],
  [20 * 1024, "20 KB"],
  [2.4 * 1024 * 1024, "2.4 MB"],
  [MAX_UPLOAD_BYTES, "200 MB"],
  [3 * 1024 ** 4, "3072 GB"],
])("humanSize(%s) is %j", (bytes, text) => {
  expect(humanSize(bytes)).toBe(text);
});

it("the upload cap mirrors the backend's 200MB", () => {
  expect(MAX_UPLOAD_BYTES).toBe(209_715_200);
});
