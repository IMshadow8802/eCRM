import type { QueryClient } from "@tanstack/react-query";
import { act, fireEvent, screen, waitFor } from "@testing-library/react-native";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";

import {
  attachmentDownloadRequest,
  deleteAttachment,
  fetchAttachments,
  uploadAttachment,
} from "../../api/attachmentQueries";
import type { Attachment } from "../../types/api";
import { envelope } from "../../test/fixtures";
import { renderWithProviders } from "../../test/renderWithProviders";
import { spySheets } from "../../test/sheets";
import AttachmentList from "./AttachmentList";
import { PICKER_TYPES } from "./attachmentHelpers";

jest.mock("../../api/attachmentQueries");
// FileViewer's and the download hook's native modules; the viewer is covered by its own test.
jest.mock("expo-file-system", () => ({ Paths: { cache: { uri: "file:///cache" } }, File: jest.fn(), Directory: jest.fn() }));
jest.mock("expo-sharing", () => ({ isAvailableAsync: jest.fn(), shareAsync: jest.fn() }));

const MB = 1024 * 1024;
const file = (patch: Partial<Attachment>): Attachment => ({
  Id: 1,
  Entity: "ticket",
  EntityId: 7,
  FileName: "invoice.pdf",
  StoredName: "x.pdf",
  FileSize: 2.4 * MB,
  MimeType: "application/pdf",
  UploadedBy: 1,
  UploaderName: "Asha",
  CreatedDate: "2026-11-01T10:00:00",
  ...patch,
});

const denied = { granted: false, status: ImagePicker.PermissionStatus.DENIED, canAskAgain: false, expires: "never" } as const;
const photo = (asset: Partial<ImagePicker.ImagePickerAsset>): ImagePicker.ImagePickerResult => ({
  canceled: false,
  assets: [{ uri: "file:///shot.jpg", width: 1, height: 1, ...asset }],
});

const mount = async (canManage = true) => {
  const r = await renderWithProviders(<AttachmentList entity="ticket" entityId={7} canManage={canManage} />);
  client = r.queryClient;
  return r;
};

// FlatList renders new rows in a batch on a timer; under load it fired between
// waitFor polls, outside act(). Fake timers park it (RNTL's waitFor/findBy
// advance them), as in BoardsScreen.test.
jest.useFakeTimers();

// A write invalidates the list; let that refetch land inside the test, not after it.
let client: QueryClient | null = null;
afterEach(async () => {
  const c = client;
  client = null;
  if (c) await waitFor(() => expect(c.isFetching() + c.isMutating()).toBe(0));
});

beforeEach(() => {
  jest.mocked(fetchAttachments).mockResolvedValue([file({})]);
  jest.mocked(uploadAttachment).mockResolvedValue(envelope({ attachmentId: 9 }));
  jest.mocked(deleteAttachment).mockResolvedValue(envelope({}));
});

it("lists the record's files with size and uploader", async () => {
  await mount();
  expect(await screen.findByText("invoice.pdf")).toBeOnTheScreen();
  expect(screen.getByText("PDF · 2.4 MB · Asha")).toBeOnTheScreen();
  expect(fetchAttachments).toHaveBeenCalledWith({ Entity: "ticket", EntityId: 7 });
});

it("E: rows in one group, each led by its kind's badge; Add a file opens the picker sheet", async () => {
  const { present } = spySheets();
  await mount();
  await screen.findByText("invoice.pdf");
  expect(screen.getByTestId("attachments-scroll")).toBeOnTheScreen();
  expect(screen.getAllByText("invoice.pdf")).toHaveLength(1);
  await fireEvent.press(screen.getByRole("button", { name: "Add a file" }));
  expect(present).toHaveBeenCalled();
});

it("embedded: no scroll of its own (it sits in the record's scroll)", async () => {
  const r = await renderWithProviders(<AttachmentList entity="ticket" entityId={7} canManage={false} embedded />);
  client = r.queryClient;
  await screen.findByText("invoice.pdf");
  expect(screen.queryByTestId("attachments-scroll")).toBeNull();
});

it("loading shows skeleton rows", async () => {
  jest.mocked(fetchAttachments).mockReturnValue(new Promise(() => {}));
  // Not `mount()`: the afterEach would wait on a fetch that never lands.
  await renderWithProviders(<AttachmentList entity="ticket" entityId={7} canManage={false} />);
  expect(screen.getAllByTestId("skeleton-row")).toHaveLength(2);
});

it("says when there are no files", async () => {
  jest.mocked(fetchAttachments).mockResolvedValue([]);
  await mount();
  expect(await screen.findByText("No files yet.")).toBeOnTheScreen();
});

it("a viewer can download but not add or delete", async () => {
  await mount(false);
  await screen.findByText("invoice.pdf");
  expect(screen.getByLabelText("Download invoice.pdf")).toBeOnTheScreen();
  expect(screen.queryByLabelText("Delete invoice.pdf")).toBeNull();
  expect(screen.queryByLabelText("Add a file")).toBeNull();
});

it("a photo from the camera is uploaded against this record, then the list reloads", async () => {
  jest.mocked(ImagePicker.launchCameraAsync).mockResolvedValue(
    photo({ fileName: "IMG_1.jpg", mimeType: "image/jpeg", fileSize: 3 * MB }),
  );
  await mount();
  await screen.findByText("invoice.pdf");
  await fireEvent.press(screen.getByText("Take a photo"));
  await waitFor(() =>
    expect(uploadAttachment).toHaveBeenCalledWith(
      { Entity: "ticket", EntityId: 7, file: { uri: "file:///shot.jpg", name: "IMG_1.jpg", type: "image/jpeg" } },
    ),
  );
  await waitFor(() => expect(fetchAttachments).toHaveBeenCalledTimes(2));
});

it.each([
  [{ assetId: "A1" }, "photo-A1.jpg"],
  [{}, "photo-capture.jpg"],
])("a camera shot with no file name gets one (%j)", async (asset, name) => {
  jest.mocked(ImagePicker.launchCameraAsync).mockResolvedValue(photo(asset));
  await mount();
  await screen.findByText("invoice.pdf");
  await fireEvent.press(screen.getByText("Take a photo"));
  await waitFor(() =>
    expect(uploadAttachment).toHaveBeenCalledWith(
      expect.objectContaining({ file: { uri: "file:///shot.jpg", name, type: "image/jpeg" } }),
    ),
  );
});

it("camera access off: says how to fix it, uploads nothing, and the note dismisses", async () => {
  jest.mocked(ImagePicker.requestCameraPermissionsAsync).mockResolvedValue(denied);
  await mount();
  await screen.findByText("invoice.pdf");
  await fireEvent.press(screen.getByText("Take a photo"));
  expect(await screen.findByText(/Camera access is off/)).toBeOnTheScreen();
  expect(ImagePicker.launchCameraAsync).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByLabelText("Dismiss the error"));
  expect(screen.queryByText(/Camera access is off/)).toBeNull();
});

it("backing out of a picker uploads nothing", async () => {
  await mount();
  await screen.findByText("invoice.pdf");
  await fireEvent.press(screen.getByText("Take a photo"));
  await fireEvent.press(screen.getByText("Choose from library"));
  await fireEvent.press(screen.getByText("Choose a file"));
  await waitFor(() => expect(DocumentPicker.getDocumentAsync).toHaveBeenCalled());
  expect(uploadAttachment).not.toHaveBeenCalled();
});

it("an image from the library is uploaded", async () => {
  jest.mocked(ImagePicker.launchImageLibraryAsync).mockResolvedValue(photo({ uri: "file:///lib.png", mimeType: "image/png", fileName: "site.png" }));
  await mount();
  await screen.findByText("invoice.pdf");
  await fireEvent.press(screen.getByText("Choose from library"));
  await waitFor(() =>
    expect(uploadAttachment).toHaveBeenCalledWith(
      expect.objectContaining({ file: { uri: "file:///lib.png", name: "site.png", type: "image/png" } }),
    ),
  );
});

it("a library image with no name or type falls back to a JPEG name", async () => {
  jest.mocked(ImagePicker.launchImageLibraryAsync).mockResolvedValue(photo({ uri: "file:///lib" }));
  await mount();
  await screen.findByText("invoice.pdf");
  await fireEvent.press(screen.getByText("Choose from library"));
  await waitFor(() =>
    expect(uploadAttachment).toHaveBeenCalledWith(
      expect.objectContaining({ file: { uri: "file:///lib", name: "image.jpg", type: "image/jpeg" } }),
    ),
  );
});

it("photo access off: says how to fix it", async () => {
  jest.mocked(ImagePicker.requestMediaLibraryPermissionsAsync).mockResolvedValue(denied);
  await mount();
  await screen.findByText("invoice.pdf");
  await fireEvent.press(screen.getByText("Choose from library"));
  expect(await screen.findByText(/Photo access is off/)).toBeOnTheScreen();
  expect(uploadAttachment).not.toHaveBeenCalled();
});

it("a document is copied to cache and uploaded with its type", async () => {
  jest.mocked(DocumentPicker.getDocumentAsync).mockResolvedValue({
    canceled: false,
    assets: [{ uri: "file:///q.pdf", name: "q.pdf", mimeType: "application/pdf", size: 1000, lastModified: 0 }],
  });
  await mount();
  await screen.findByText("invoice.pdf");
  await fireEvent.press(screen.getByText("Choose a file"));
  await waitFor(() =>
    expect(uploadAttachment).toHaveBeenCalledWith(
      expect.objectContaining({ file: { uri: "file:///q.pdf", name: "q.pdf", type: "application/pdf" } }),
    ),
  );
  // ATT-01 + ATT-03: the picker offers only types the server takes, several at once.
  expect(DocumentPicker.getDocumentAsync).toHaveBeenCalledWith({ copyToCacheDirectory: true, multiple: true, type: PICKER_TYPES });
});

// parity: ATT-01 — a type upload.js refuses is stopped before it uploads in full.
it("a file type the server refuses is stopped before any upload", async () => {
  jest.mocked(DocumentPicker.getDocumentAsync).mockResolvedValue({
    canceled: false,
    assets: [{ uri: "file:///n.txt", name: "notes.txt", mimeType: "text/plain", size: 10, lastModified: 0 }],
  });
  await mount();
  await screen.findByText("invoice.pdf");
  await fireEvent.press(screen.getByText("Choose a file"));
  expect(await screen.findByText('"notes.txt" — file type .txt is not allowed')).toBeOnTheScreen();
  expect(uploadAttachment).not.toHaveBeenCalled();
});

// parity: ATT-02 — JPEG bytes under an iOS .HEIC name go up as .jpg, or upload.js refuses them.
it("a JPEG the library names .HEIC is uploaded as .jpg", async () => {
  jest.mocked(ImagePicker.launchImageLibraryAsync).mockResolvedValue(
    photo({ uri: "file:///lib/IMG_2.jpg", fileName: "IMG_2.HEIC", mimeType: "image/jpeg" }),
  );
  await mount();
  await screen.findByText("invoice.pdf");
  await fireEvent.press(screen.getByText("Choose from library"));
  await waitFor(() =>
    expect(uploadAttachment).toHaveBeenCalledWith(
      expect.objectContaining({ file: { uri: "file:///lib/IMG_2.jpg", name: "IMG_2.jpg", type: "image/jpeg" } }),
    ),
  );
});

// parity: ATT-03 — several files in one pick, each uploaded; a refused one does not stop the rest.
it("several library images are each uploaded", async () => {
  jest.mocked(ImagePicker.launchImageLibraryAsync).mockResolvedValue({
    canceled: false,
    assets: [
      { uri: "file:///1.jpg", width: 1, height: 1, fileName: "1.jpg", mimeType: "image/jpeg" },
      { uri: "file:///2.png", width: 1, height: 1, fileName: "2.png", mimeType: "image/png" },
    ],
  });
  await mount();
  await screen.findByText("invoice.pdf");
  await fireEvent.press(screen.getByText("Choose from library"));
  await waitFor(() => expect(uploadAttachment).toHaveBeenCalledTimes(2));
  expect(ImagePicker.launchImageLibraryAsync).toHaveBeenCalledWith({ quality: 0.7, allowsMultipleSelection: true });
  expect(jest.mocked(uploadAttachment).mock.calls.map(([v]) => v.file.name)).toEqual(["1.jpg", "2.png"]);
});

it("several documents: the allowed ones upload, the refused one is named", async () => {
  jest.mocked(DocumentPicker.getDocumentAsync).mockResolvedValue({
    canceled: false,
    assets: [
      { uri: "file:///a.pdf", name: "a.pdf", mimeType: "application/pdf", size: 10, lastModified: 0 },
      { uri: "file:///b.csv", name: "b.csv", mimeType: "text/csv", size: 10, lastModified: 0 },
      { uri: "file:///c.docx", name: "c.docx", size: 10, lastModified: 0 },
    ],
  });
  await mount();
  await screen.findByText("invoice.pdf");
  await fireEvent.press(screen.getByText("Choose a file"));
  expect(await screen.findByText('"b.csv" — file type .csv is not allowed')).toBeOnTheScreen();
  await waitFor(() => expect(uploadAttachment).toHaveBeenCalledTimes(2));
  // A document with no mime goes with the one upload.js pairs with its extension.
  expect(jest.mocked(uploadAttachment).mock.calls.map(([v]) => v.file)).toEqual([
    { uri: "file:///a.pdf", name: "a.pdf", type: "application/pdf" },
    { uri: "file:///c.docx", name: "c.docx", type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
  ]);
});

// One at a time, so the spinner means "still uploading" and a failure can be named.
it("several files upload one after another, and the failed ones are named", async () => {
  let finishFirst!: () => void;
  jest.mocked(uploadAttachment)
    .mockImplementationOnce(() => new Promise((resolve) => { finishFirst = () => resolve(envelope({ attachmentId: 1 })); }))
    .mockRejectedValueOnce(new Error("Disk full"))
    .mockRejectedValueOnce(new Error("Disk full"));
  jest.mocked(DocumentPicker.getDocumentAsync).mockResolvedValue({
    canceled: false,
    assets: ["a.pdf", "b.pdf", "c.pdf"].map((name) => ({ uri: `file:///${name}`, name, mimeType: "application/pdf", size: 10, lastModified: 0 })),
  });
  await mount();
  await screen.findByText("invoice.pdf");
  await fireEvent.press(screen.getByText("Choose a file"));
  await waitFor(() => expect(uploadAttachment).toHaveBeenCalledTimes(1));
  expect(uploadAttachment).toHaveBeenCalledTimes(1);
  await act(async () => finishFirst());
  expect(await screen.findByText("2 files failed to upload: b.pdf, c.pdf")).toBeOnTheScreen();
  expect(uploadAttachment).toHaveBeenCalledTimes(3);
  await waitFor(() => expect(fetchAttachments).toHaveBeenCalledTimes(2));
});

it("a document with no type or size is sent as a generic binary", async () => {
  jest.mocked(DocumentPicker.getDocumentAsync).mockResolvedValue({
    canceled: false,
    assets: [{ uri: "file:///b.apk", name: "b.apk", lastModified: 0 }],
  });
  await mount();
  await screen.findByText("invoice.pdf");
  await fireEvent.press(screen.getByText("Choose a file"));
  await waitFor(() =>
    expect(uploadAttachment).toHaveBeenCalledWith(
      expect.objectContaining({ file: { uri: "file:///b.apk", name: "b.apk", type: "application/octet-stream" } }),
    ),
  );
});

it("a file over 200MB is refused before any upload", async () => {
  jest.mocked(DocumentPicker.getDocumentAsync).mockResolvedValue({
    canceled: false,
    assets: [{ uri: "file:///big.apk", name: "big.apk", size: 201 * MB, lastModified: 0 }],
  });
  await mount();
  await screen.findByText("invoice.pdf");
  await fireEvent.press(screen.getByText("Choose a file"));
  expect(await screen.findByText('"big.apk" is larger than the 200 MB limit.')).toBeOnTheScreen();
  expect(uploadAttachment).not.toHaveBeenCalled();
});

it("a refused upload shows the server's reason", async () => {
  jest.mocked(uploadAttachment).mockRejectedValue(new Error("File type not allowed"));
  jest.mocked(ImagePicker.launchCameraAsync).mockResolvedValue(photo({ fileName: "a.jpg" }));
  await mount();
  await screen.findByText("invoice.pdf");
  await fireEvent.press(screen.getByText("Take a photo"));
  expect(await screen.findByText('Could not upload "a.jpg": File type not allowed')).toBeOnTheScreen();
});

it("delete asks first, then removes the file and reloads", async () => {
  await mount();
  await fireEvent.press(await screen.findByLabelText("Delete invoice.pdf"));
  expect(await screen.findByText('"invoice.pdf" will be deleted for everyone.')).toBeOnTheScreen();
  expect(deleteAttachment).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByText("Remove"));
  await waitFor(() => expect(deleteAttachment).toHaveBeenCalledWith({ Id: 1 }, expect.anything()));
  await waitFor(() => expect(fetchAttachments).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(screen.queryByText("Remove file?")).toBeNull());
});

it("cancelling the delete keeps the file", async () => {
  await mount();
  await fireEvent.press(await screen.findByLabelText("Delete invoice.pdf"));
  await fireEvent.press(await screen.findByText("Cancel"));
  await waitFor(() => expect(screen.queryByText("Remove file?")).toBeNull());
  expect(deleteAttachment).not.toHaveBeenCalled();
});

it("a refused delete shows the server's reason and keeps the dialog", async () => {
  jest.mocked(deleteAttachment).mockRejectedValue(new Error("Only the uploader can delete this"));
  await mount();
  await fireEvent.press(await screen.findByLabelText("Delete invoice.pdf"));
  await fireEvent.press(await screen.findByText("Remove"));
  expect(await screen.findByText("Only the uploader can delete this")).toBeOnTheScreen();
  expect(screen.getByText("Remove file?")).toBeOnTheScreen();
});

it("download without a session says to sign in", async () => {
  jest.mocked(attachmentDownloadRequest).mockReturnValue(null);
  await mount(false);
  await fireEvent.press(await screen.findByLabelText("Download invoice.pdf"));
  expect(await screen.findByText("You are signed out. Sign in and try again.")).toBeOnTheScreen();
});

it("tapping a file opens it in the viewer", async () => {
  await mount(false);
  await fireEvent.press(await screen.findByText("invoice.pdf"));
  expect(await screen.findByLabelText("Close")).toBeOnTheScreen();
  await fireEvent.press(screen.getByLabelText("Close"));
  await waitFor(() => expect(screen.queryByLabelText("Close")).toBeNull());
});
