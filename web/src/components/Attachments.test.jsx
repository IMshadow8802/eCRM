import { createRef } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within, act } from "@testing-library/react";
import { ThemeProvider } from "@mui/material/styles";
import { buildTheme } from "../theme";

vi.mock("../api/attachmentQueries", () => ({
  fetchAttachments: vi.fn(),
  uploadAttachment: vi.fn(),
  downloadAttachment: vi.fn(),
  deleteAttachment: vi.fn(),
  fetchAttachmentBlob: vi.fn(),
}));
vi.mock("notistack", () => ({ enqueueSnackbar: vi.fn() }));

import Attachments from "./Attachments";
import {
  fetchAttachments,
  uploadAttachment,
  downloadAttachment,
  deleteAttachment,
  fetchAttachmentBlob,
} from "../api/attachmentQueries";
import { enqueueSnackbar } from "notistack";

const wrap = (ui) => render(<ThemeProvider theme={buildTheme("light")}>{ui}</ThemeProvider>);

const listResponse = (attachments) => ({ data: { data: { attachments } } });

const makeFile = (name, { size = 10, type = "" } = {}) => {
  const f = new File(["x"], name, { type });
  Object.defineProperty(f, "size", { value: size });
  return f;
};

const setInputFiles = (files) => {
  const input = screen.getByTestId("attachment-input");
  Object.defineProperty(input, "files", { value: files, configurable: true });
  fireEvent.change(input);
};

beforeEach(() => {
  vi.clearAllMocks();
  fetchAttachments.mockResolvedValue(listResponse([]));
  uploadAttachment.mockResolvedValue({ data: { data: { attachmentId: 1 } } });
  deleteAttachment.mockResolvedValue({ data: { success: true } });
  downloadAttachment.mockResolvedValue({});
  fetchAttachmentBlob.mockResolvedValue({ blob: new Blob(), url: "blob:remote" });
  // jsdom has no object URL implementation
  URL.createObjectURL = vi.fn(() => "blob:staged");
  URL.revokeObjectURL = vi.fn();
});

describe("Attachments — LIVE mode", () => {
  it("fetches and renders server rows", async () => {
    fetchAttachments.mockResolvedValueOnce(
      listResponse([{ Id: 7, FileName: "report.pdf", FileSize: 2048 }]),
    );
    wrap(<Attachments entity="lead" entityId={5} />);

    expect(await screen.findByText("report.pdf")).toBeInTheDocument();
    expect(fetchAttachments).toHaveBeenCalledWith({ Entity: "lead", EntityId: 5 });
  });

  it("uploads a picked file then refetches", async () => {
    wrap(<Attachments entity="lead" entityId={5} />);
    await waitFor(() => expect(fetchAttachments).toHaveBeenCalledTimes(1));

    setInputFiles([makeFile("pic.png", { type: "image/png" })]);

    await waitFor(() =>
      expect(uploadAttachment).toHaveBeenCalledWith(
        expect.objectContaining({ Entity: "lead", EntityId: 5 }),
      ),
    );
    // refetch after upload
    await waitFor(() => expect(fetchAttachments).toHaveBeenCalledTimes(2));
  });

  it("removes a row via confirmation then refetches", async () => {
    fetchAttachments.mockResolvedValueOnce(
      listResponse([{ Id: 9, FileName: "doc.docx", FileSize: 100 }]),
    );
    wrap(<Attachments entity="ticket" entityId={3} />);
    await screen.findByText("doc.docx");

    fireEvent.click(screen.getByRole("button", { name: /Remove doc.docx/i }));

    const dialog = await screen.findByTestId("confirmation-dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Remove" }));

    await waitFor(() => expect(deleteAttachment).toHaveBeenCalledWith({ Id: 9 }));
    await waitFor(() => expect(fetchAttachments).toHaveBeenCalledTimes(2));
  });

  it("downloads a row", async () => {
    fetchAttachments.mockResolvedValueOnce(
      listResponse([{ Id: 4, FileName: "sheet.xlsx", FileSize: 100 }]),
    );
    wrap(<Attachments entity="lead" entityId={5} />);
    await screen.findByText("sheet.xlsx");

    fireEvent.click(screen.getByRole("button", { name: /Download sheet.xlsx/i }));
    await waitFor(() =>
      expect(downloadAttachment).toHaveBeenCalledWith({ Id: 4, FileName: "sheet.xlsx" }),
    );
  });

  it("surfaces a snackbar when download fails", async () => {
    fetchAttachments.mockResolvedValueOnce(
      listResponse([{ Id: 4, FileName: "sheet.xlsx", FileSize: 100 }]),
    );
    downloadAttachment.mockRejectedValueOnce(new Error("boom"));
    wrap(<Attachments entity="lead" entityId={5} />);
    await screen.findByText("sheet.xlsx");

    fireEvent.click(screen.getByRole("button", { name: /Download sheet.xlsx/i }));
    await waitFor(() =>
      expect(enqueueSnackbar).toHaveBeenCalledWith("Download failed", expect.anything()),
    );
  });

  it("surfaces a snackbar when the initial fetch fails", async () => {
    fetchAttachments.mockRejectedValueOnce(new Error("down"));
    wrap(<Attachments entity="lead" entityId={5} />);
    await waitFor(() =>
      expect(enqueueSnackbar).toHaveBeenCalledWith(
        "Failed to load attachments",
        expect.anything(),
      ),
    );
  });

  it("surfaces a snackbar when an upload fails", async () => {
    uploadAttachment.mockRejectedValueOnce(new Error("boom"));
    wrap(<Attachments entity="lead" entityId={5} />);
    await waitFor(() => expect(fetchAttachments).toHaveBeenCalled());

    setInputFiles([makeFile("pic.png", { type: "image/png" })]);
    await waitFor(() =>
      expect(enqueueSnackbar).toHaveBeenCalledWith(
        expect.stringContaining("failed to upload"),
        expect.anything(),
      ),
    );
  });

  it("rejects an oversized file and does not upload", async () => {
    wrap(<Attachments entity="lead" entityId={5} />);
    await waitFor(() => expect(fetchAttachments).toHaveBeenCalled());

    setInputFiles([makeFile("huge.png", { size: 51 * 1024 * 1024, type: "image/png" })]);

    await waitFor(() =>
      expect(enqueueSnackbar).toHaveBeenCalledWith(
        expect.stringContaining("50MB"),
        expect.anything(),
      ),
    );
    expect(uploadAttachment).not.toHaveBeenCalled();
  });

  it("rejects a disallowed file type and does not upload", async () => {
    wrap(<Attachments entity="lead" entityId={5} />);
    await waitFor(() => expect(fetchAttachments).toHaveBeenCalled());

    setInputFiles([makeFile("malware.exe")]);

    await waitFor(() =>
      expect(enqueueSnackbar).toHaveBeenCalledWith(
        expect.stringContaining("not allowed"),
        expect.anything(),
      ),
    );
    expect(uploadAttachment).not.toHaveBeenCalled();
  });
});

describe("Attachments — STAGED mode", () => {
  it("holds files locally without uploading", async () => {
    wrap(<Attachments entity="lead" entityId={null} />);

    setInputFiles([makeFile("a.png", { type: "image/png" })]);

    expect(await screen.findByText("a.png")).toBeInTheDocument();
    expect(uploadAttachment).not.toHaveBeenCalled();
    expect(fetchAttachments).not.toHaveBeenCalled();
  });

  it("uploadStaged uploads each staged file and returns counts", async () => {
    const ref = createRef();
    wrap(<Attachments ref={ref} entity="lead" entityId={0} />);

    setInputFiles([
      makeFile("a.png", { type: "image/png" }),
      makeFile("b.pdf", { type: "application/pdf" }),
    ]);
    await screen.findByText("a.png");
    expect(ref.current.stagedCount).toBe(2);

    let result;
    await act(async () => {
      result = await ref.current.uploadStaged(42);
    });

    expect(uploadAttachment).toHaveBeenCalledTimes(2);
    expect(uploadAttachment).toHaveBeenCalledWith(
      expect.objectContaining({ Entity: "lead", EntityId: 42 }),
    );
    expect(result).toEqual({ uploaded: 2, failed: 0 });
  });

  it("uploadStaged reports failures", async () => {
    uploadAttachment.mockRejectedValueOnce(new Error("boom"));
    const ref = createRef();
    wrap(<Attachments ref={ref} entity="lead" entityId={null} />);

    setInputFiles([
      makeFile("a.png", { type: "image/png" }),
      makeFile("b.pdf", { type: "application/pdf" }),
    ]);
    await screen.findByText("a.png");

    let result;
    await act(async () => {
      result = await ref.current.uploadStaged(42);
    });
    expect(result).toEqual({ uploaded: 1, failed: 1 });
  });
});

describe("Attachments — inline previews", () => {
  it("renders a live image as a thumbnail and opens the lightbox with Download", async () => {
    fetchAttachments.mockResolvedValueOnce(
      listResponse([{ Id: 1, FileName: "pic.png", FileSize: 100, MimeType: "image/png" }]),
    );
    fetchAttachmentBlob.mockResolvedValue({ blob: new Blob(), url: "blob:pic" });
    wrap(<Attachments entity="lead" entityId={5} />);

    const thumb = await screen.findByRole("img", { name: "pic.png" });
    expect(thumb).toHaveAttribute("src", "blob:pic");
    expect(fetchAttachmentBlob).toHaveBeenCalledWith({ Id: 1 });
    expect(screen.queryByTestId("attachment-row")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Preview pic.png" }));
    const modal = await screen.findByTestId("attachment-preview");
    expect(within(modal).getByRole("img", { name: "pic.png" })).toHaveAttribute("src", "blob:pic");

    fireEvent.click(within(modal).getByRole("button", { name: "Download" }));
    await waitFor(() =>
      expect(downloadAttachment).toHaveBeenCalledWith({ Id: 1, FileName: "pic.png" }),
    );
  });

  it("shows a skeleton while a thumbnail blob loads", async () => {
    fetchAttachments.mockResolvedValueOnce(
      listResponse([{ Id: 1, FileName: "pic.png", FileSize: 100, MimeType: "image/png" }]),
    );
    fetchAttachmentBlob.mockReturnValue(new Promise(() => {})); // never resolves
    wrap(<Attachments entity="lead" entityId={5} />);

    expect(await screen.findByTestId("attachment-thumb-skeleton")).toBeInTheDocument();
  });

  it("falls back to the plain row when the thumbnail blob fails", async () => {
    fetchAttachments.mockResolvedValueOnce(
      listResponse([{ Id: 1, FileName: "pic.png", FileSize: 9, MimeType: "image/png" }]),
    );
    fetchAttachmentBlob.mockRejectedValue(new Error("boom"));
    wrap(<Attachments entity="lead" entityId={5} />);

    expect(await screen.findByTestId("attachment-row")).toHaveTextContent("pic.png");
    expect(screen.queryByTestId("attachment-tile")).not.toBeInTheDocument();
    // download still works from the fallback row
    fireEvent.click(screen.getByRole("button", { name: /Download pic.png/i }));
    await waitFor(() =>
      expect(downloadAttachment).toHaveBeenCalledWith({ Id: 1, FileName: "pic.png" }),
    );
  });

  it("renders a live video as a play tile and opens the player modal on demand", async () => {
    fetchAttachments.mockResolvedValueOnce(
      listResponse([{ Id: 2, FileName: "clip.mp4", FileSize: 100, MimeType: "video/mp4" }]),
    );
    fetchAttachmentBlob.mockResolvedValue({ blob: new Blob(), url: "blob:clip" });
    wrap(<Attachments entity="ticket" entityId={3} />);

    const tile = await screen.findByRole("button", { name: "Preview clip.mp4" });
    expect(fetchAttachmentBlob).not.toHaveBeenCalled(); // video blobs load on open
    fireEvent.click(tile);

    const modal = await screen.findByTestId("attachment-preview");
    await waitFor(() => expect(fetchAttachmentBlob).toHaveBeenCalledWith({ Id: 2 }));
    const video = await within(modal).findByTestId("attachment-video");
    expect(video).toHaveAttribute("src", "blob:clip");
    expect(video).toHaveAttribute("controls");
    expect(within(modal).getByRole("button", { name: "Download" })).toBeInTheDocument();
  });

  it("keeps office documents as download-only rows with no preview tile or view button", async () => {
    fetchAttachments.mockResolvedValueOnce(
      listResponse([
        { Id: 3, FileName: "sheet.xlsx", FileSize: 100, MimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
      ]),
    );
    wrap(<Attachments entity="lead" entityId={5} />);

    expect(await screen.findByTestId("attachment-row")).toHaveTextContent("sheet.xlsx");
    expect(screen.queryByTestId("attachment-tile")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "View sheet.xlsx" })).not.toBeInTheDocument();
    expect(fetchAttachmentBlob).not.toHaveBeenCalled();
  });

  it("renders a live PDF as a doc row and opens an inline iframe viewer on View", async () => {
    fetchAttachments.mockResolvedValueOnce(
      listResponse([{ Id: 3, FileName: "report.pdf", FileSize: 100, MimeType: "application/pdf" }]),
    );
    fetchAttachmentBlob.mockResolvedValue({ blob: new Blob(), url: "blob:pdf" });
    wrap(<Attachments entity="lead" entityId={5} />);

    expect(await screen.findByTestId("attachment-row")).toHaveTextContent("report.pdf");
    expect(screen.queryByTestId("attachment-tile")).not.toBeInTheDocument();
    expect(fetchAttachmentBlob).not.toHaveBeenCalled(); // PDF blob loads on View

    fireEvent.click(screen.getByRole("button", { name: "View report.pdf" }));

    const modal = await screen.findByTestId("attachment-preview");
    await waitFor(() => expect(fetchAttachmentBlob).toHaveBeenCalledWith({ Id: 3 }));
    const frame = await within(modal).findByTestId("attachment-pdf");
    expect(frame).toHaveAttribute("src", "blob:pdf");
    expect(within(modal).getByRole("button", { name: "Download" })).toBeInTheDocument();
  });

  it("previews a staged local image without any network call", async () => {
    wrap(<Attachments entity="lead" entityId={null} />);
    const file = makeFile("a.png", { type: "image/png" });
    setInputFiles([file]);

    const thumb = await screen.findByRole("img", { name: "a.png" });
    expect(thumb).toHaveAttribute("src", "blob:staged");
    expect(URL.createObjectURL).toHaveBeenCalledWith(file);
    expect(fetchAttachmentBlob).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Preview a.png" }));
    const modal = await screen.findByTestId("attachment-preview");
    expect(within(modal).getByRole("img", { name: "a.png" })).toBeInTheDocument();
    // staged files are already local — no Download button
    expect(within(modal).queryByRole("button", { name: "Download" })).not.toBeInTheDocument();
  });

  it("removes a staged media tile without uploading", async () => {
    wrap(<Attachments entity="lead" entityId={null} />);
    setInputFiles([makeFile("a.png", { type: "image/png" })]);
    await screen.findByRole("img", { name: "a.png" });

    fireEvent.click(screen.getByRole("button", { name: "Remove a.png" }));
    await waitFor(() =>
      expect(screen.queryByRole("img", { name: "a.png" })).not.toBeInTheDocument(),
    );
    expect(uploadAttachment).not.toHaveBeenCalled();
  });

  it("revokes object URLs on unmount", async () => {
    fetchAttachments.mockResolvedValueOnce(
      listResponse([{ Id: 1, FileName: "pic.png", FileSize: 100, MimeType: "image/png" }]),
    );
    fetchAttachmentBlob.mockResolvedValue({ blob: new Blob(), url: "blob:pic" });
    const { unmount } = wrap(<Attachments entity="lead" entityId={5} />);
    await screen.findByRole("img", { name: "pic.png" });

    unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:pic");
  });
});
