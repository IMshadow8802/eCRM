import { FileArchive, FileText, Film, File as FileIcon, Image as ImageIcon, Smartphone, Table } from "lucide-react-native";

import { fileMeta, humanSize, MAX_UPLOAD_BYTES, refusedType, screenPicked, uploadName } from "./attachmentHelpers";

// csv/rar/7z are not listed: the backend refuses them, so no row ever carries one.
it.each([
  ["data.csv", null, FileIcon, "textSecondary"],
  ["old.rar", null, FileIcon, "textSecondary"],
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

// parity: ATT-01 — the extension allow-list is web's TYPES (Attachments.jsx), which is upload.js's.
it.each([
  ...["a.png", "a.JPG", "a.jpeg", "a.gif", "a.webp", "a.mp4", "a.webm", "a.mov", "a.pdf", "a.xls", "a.xlsx", "a.doc", "a.docx", "a.apk", "a.aab", "a.zip"]
    .map((n) => [n, true] as const),
  ...["a.csv", "a.txt", "a.heic", "a.rar", "a.7z", "README", "a."].map((n) => [n, false] as const),
])("refusedType(%s) lets it through: %s", (name, ok) => {
  expect(refusedType(name)).toBe(ok ? null : `"${name}" — file type .${name.includes(".") ? name.split(".").pop()!.toLowerCase() : ""} is not allowed`);
});

// parity: ATT-02 — iOS can hand over JPEG bytes under a .HEIC name; upload.js wants mime and extension to agree.
it.each([
  ["IMG_1.HEIC", "image/jpeg", "IMG_1.jpg"],
  ["IMG_1.heic", "image/jpeg", "IMG_1.jpg"],
  ["shot", "image/jpeg", "shot.jpg"],
  ["a.jpeg", "image/jpeg", "a.jpeg"],
  ["a.JPG", "image/jpeg", "a.JPG"],
  ["a.png", "image/png", "a.png"],
  ["IMG_1.HEIC", "image/heic", "IMG_1.HEIC"],
  ["doc.pdf", null, "doc.pdf"],
])("uploadName(%s, %s) is %s", (name, mime, expected) => {
  expect(uploadName(name, mime)).toBe(expected);
});

// One gate for every picker (attachments list, complaint form): type, then size;
// the name iOS gives a JPEG is fixed; the mime is what upload.js expects for the extension.
it("screenPicked keeps what the server takes and names the rest", () => {
  const { files, refused } = screenPicked([
    { uri: "file:///1", name: "IMG_1.HEIC", mimeType: "image/jpeg", size: 10 },
    { uri: "file:///2", name: "c.docx", mimeType: null },
    { uri: "file:///3", name: "q.pdf", mimeType: "application/octet-stream", size: 10 },
    { uri: "file:///4", name: "b.apk" },
    { uri: "file:///5", name: "w.aab", mimeType: "application/x-aab" },
    { uri: "file:///6", name: "notes.txt", mimeType: "text/plain" },
    { uri: "file:///7", name: "huge.mov", mimeType: "video/quicktime", size: MAX_UPLOAD_BYTES + 1 },
  ]);
  expect(files).toEqual([
    { uri: "file:///1", name: "IMG_1.jpg", type: "image/jpeg" },
    { uri: "file:///2", name: "c.docx", type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
    { uri: "file:///3", name: "q.pdf", type: "application/pdf" },
    { uri: "file:///4", name: "b.apk", type: "application/octet-stream" },
    { uri: "file:///5", name: "w.aab", type: "application/x-aab" },
  ]);
  expect(refused).toEqual([
    '"notes.txt" — file type .txt is not allowed',
    '"huge.mov" is larger than the 200 MB limit.',
  ]);
});
