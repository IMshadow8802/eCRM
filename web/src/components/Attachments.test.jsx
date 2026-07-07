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
}));
vi.mock("notistack", () => ({ enqueueSnackbar: vi.fn() }));

import Attachments from "./Attachments";
import {
  fetchAttachments,
  uploadAttachment,
  downloadAttachment,
  deleteAttachment,
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
