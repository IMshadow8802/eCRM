import { describe, it, expect, beforeEach, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import ListFormModal, { skippedCsv } from "./ListFormModal";
import useAuthStore from "../../../stores/useAuthStore";
import renderWithProviders from "../../../test/renderWithProviders";
import { listRow, mockCallingEndpoints } from "../../../test/callingMocks";

const mockRead = vi.fn();
vi.mock("./sheetParse", async () => ({ ...(await vi.importActual("./sheetParse")), readSheet: (...a) => mockRead(...a) }));

const ADMIN = { isAdmin: true, modules: {} };
const mobiles = (n, from = 0) => Array.from({ length: n }, (_, i) => [`P${i + from}`, String(9000000000 + i + from)]);
const pickFile = () => fireEvent.change(screen.getByTestId("sheet-file"), { target: { files: [new File(["x"], "sheet.xlsx")] } });
const option = async (user, testId, name) => {
  await user.click(screen.getByTestId(`${testId}-input`));
  await user.click(await screen.findByRole("option", { name }));
};
const importedCalls = (cap) => (cap.calls.importContacts ?? []).filter((b) => b.DryRun === false).map((b) => b.rows[0].RowNo);

describe("ListFormModal", () => {
  beforeEach(() => {
    mockRead.mockReset();
    useAuthStore.setState({ isAuthenticated: true, token: null, user: { UserId: 1 }, access: ADMIN });
  });

  it("Details: needs a name and an office, saves, and moves to the sheet with the new id", async () => {
    const cap = mockCallingEndpoints();
    renderWithProviders(<ListFormModal open onClose={() => {}} />);
    const user = userEvent.setup();
    await user.click(screen.getByTestId("list-next"));
    expect(await screen.findByText("Name is required")).toBeInTheDocument();
    expect(screen.getByText("Pick the office")).toBeInTheDocument();
    await user.type(screen.getByTestId("list-Name"), "Surat traders, Nov");
    await option(user, "list-BranchId", "Delhi");
    await user.type(screen.getByTestId("list-Cost"), "18500");
    await user.click(screen.getByTestId("list-next"));
    expect(await screen.findByText("Drop the sheet here, or browse")).toBeInTheDocument();
    expect(cap.saveList).toMatchObject({ Id: 0, BranchId: 1, Name: "Surat traders, Nov", Cost: 18500, AutoTopUp: false, HoldSize: 10, MaxAttempts: 3, RetryGapHours: 4, Status: "active" });
    expect(screen.getByText(/Step 2 of 3 · Surat traders, Nov/)).toBeInTheDocument();
  });

  it("Details: shows the server's refusal in the step", async () => {
    mockCallingEndpoints({ fail: { saveList: "A list with this name already exists" } });
    renderWithProviders(<ListFormModal open onClose={() => {}} />);
    const user = userEvent.setup();
    await user.type(screen.getByTestId("list-Name"), "Dup");
    await option(user, "list-BranchId", "Delhi");
    await user.click(screen.getByTestId("list-next"));
    expect(await screen.findByTestId("list-error")).toHaveTextContent("A list with this name already exists");
  });

  it("Sheet: pre-maps the real layout, shows the first rows, and blocks Preview until a column is Mobile", async () => {
    mockCallingEndpoints();
    mockRead.mockResolvedValue({
      headers: ["Ref No.", "Name", "Anniversary", "Contact", "Mobile2", "Address", "GroupName", "BranchName"],
      rows: Array.from({ length: 12 }, (_, i) => [`MLSS-${i}`, `Person ${i}`, "12-Feb", i === 2 ? "" : String(9810823700 + i), i === 2 ? "9873301145" : "", "Delhi", "LUCKY DRAW", "MLSS-DELHI"]),
    });
    renderWithProviders(<ListFormModal open onClose={() => {}} list={listRow()} />);
    const user = userEvent.setup();
    pickFile();
    expect(await screen.findByTestId("map-3-input")).toHaveValue("Mobile");
    expect(screen.getByTestId("map-4-input")).toHaveValue("Alt mobile");
    expect(screen.getByTestId("map-6-input")).toHaveValue("Keep as extra");
    expect(screen.getAllByTestId(/^preview-row-/)).toHaveLength(10);
    expect(within(screen.getByTestId("preview-row-3")).getByText("9873301145")).toBeInTheDocument();
    expect(screen.getByTestId("preview-btn")).toBeEnabled();
    await option(user, "map-3", "Keep as extra");
    expect(screen.getByTestId("no-mobile")).toHaveTextContent("Choose which column is the mobile number");
    expect(screen.getByTestId("preview-btn")).toBeDisabled();
  });

  it("Sheet: a header-only or oversized sheet says so and sends nothing", async () => {
    const cap = mockCallingEndpoints();
    mockRead.mockResolvedValueOnce({ headers: ["Name", "Mobile"], rows: [] });
    renderWithProviders(<ListFormModal open onClose={() => {}} list={listRow()} />);
    pickFile();
    expect(await screen.findByTestId("sheet-error")).toHaveTextContent("This sheet has no rows");
    mockRead.mockResolvedValueOnce({ headers: ["Name", "Mobile"], rows: Array.from({ length: 50001 }, () => ["a", "9825012345"]) });
    pickFile();
    expect(await screen.findByText("A sheet can have at most 50,000 rows")).toBeInTheDocument();
    mockRead.mockRejectedValueOnce(new Error("zip"));
    pickFile();
    expect(await screen.findByText(/Could not read this file/)).toBeInTheDocument();
    expect(cap.calls.importContacts).toBeUndefined();
  });

  it("Preview: dry-runs every chunk of 500, sums the counts, adds the sheet's own repeats, and marks each row", async () => {
    const cap = mockCallingEndpoints({ skipped: (b) => (b.rows[0].RowNo === 1 ? [{ RowNo: 2, Reason: "Already a lead" }] : []) });
    mockRead.mockResolvedValue({ headers: ["Name", "Mobile"], rows: [...mobiles(1001), ["Again", "9000000000"]] });
    renderWithProviders(<ListFormModal open onClose={() => {}} list={listRow()} />);
    const user = userEvent.setup();
    pickFile();
    await user.click(await screen.findByTestId("preview-btn"));
    await screen.findByTestId("import-counts");
    expect(cap.calls.importContacts.map((b) => [b.DryRun, b.rows.length, b.CallListId])).toEqual([[true, 500, 5], [true, 500, 5], [true, 1, 5]]);
    expect(screen.getByTestId("count-Added")).toHaveTextContent("9");
    expect(screen.getByTestId("count-Repeated")).toHaveTextContent("1");
    expect(within(screen.getByTestId("preview-row-2")).getByText("Already a lead")).toBeInTheDocument();
    expect(within(screen.getByTestId("preview-row-1")).getByText("Will be added")).toBeInTheDocument();
    expect(screen.getByTestId("download-skipped")).toHaveTextContent("Download 2 skipped rows");
    const url = vi.fn(() => "blob:x");
    URL.createObjectURL = url; URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    await user.click(screen.getByTestId("download-skipped"));
    expect(url).toHaveBeenCalled();
  });

  it("builds the skipped-rows CSV from the original rows plus a Reason", () => {
    expect(skippedCsv(["Name", "Mobile"], [["A", "1"], ["B", "9.8E+09"], ["C", "x"]], [{ RowNo: 3, Reason: "Bad number" }, { RowNo: 2, Reason: "Bad number" }]))
      .toBe("Name,Mobile,Reason\nB,9.8E+09,Bad number\nC,x,Bad number");
  });

  it("Import: resumes from the chunk that failed and not the ones that succeeded, then finishes", async () => {
    let failOnce = true;
    const cap = mockCallingEndpoints({ fail: { importContacts: (b) => (b.DryRun === false && b.rows[0].RowNo === 501 && failOnce ? ((failOnce = false), { message: "Network", status: 500 }) : null) } });
    mockRead.mockResolvedValue({ headers: ["Name", "Mobile"], rows: mobiles(1200) });
    const onClose = vi.fn();
    renderWithProviders(<ListFormModal open onClose={onClose} list={listRow()} />);
    const user = userEvent.setup();
    pickFile();
    await user.click(await screen.findByTestId("preview-btn"));
    await user.click(await screen.findByTestId("import-btn"));
    expect(await screen.findByText("Stopped at row 501. Nothing is lost — press Import to continue")).toBeInTheDocument();
    await user.click(screen.getByTestId("import-btn"));
    expect(await screen.findByTestId("import-done")).toHaveTextContent("9 contacts added");
    expect(importedCalls(cap)).toEqual([1, 501, 501, 1001]);
    await user.click(screen.getByTestId("sheet-next"));
    expect(onClose).toHaveBeenCalled();
  });

  describe("Callers step", () => {
    const toCallers = async (user) => {
      await user.type(screen.getByTestId("list-Name"), "Surat traders");
      await option(user, "list-BranchId", "Delhi");
      await user.click(screen.getByTestId("list-next"));
      await screen.findByText("Drop the sheet here, or browse");
      pickFile();
      await user.click(await screen.findByTestId("preview-btn"));
      await user.click(await screen.findByTestId("import-btn"));
      await user.click(await screen.findByTestId("sheet-next"));
      await screen.findByTestId("caller-17");
    };
    beforeEach(() => mockRead.mockResolvedValue({ headers: ["Name", "Mobile"], rows: mobiles(3) }));

    it("lists the people one may assign leads to, grouped, and gives a typed number now", async () => {
      const cap = mockCallingEndpoints();
      renderWithProviders(<ListFormModal open onClose={() => {}} />);
      const user = userEvent.setup();
      await toCallers(user);
      expect(cap.assignable).toEqual({ Module: "leads" });
      expect(screen.getByText("Your manager and team")).toBeInTheDocument();
      expect(screen.getByText("Other offices")).toBeInTheDocument();
      await user.type(screen.getByTestId("give-17"), "30");
      await user.click(screen.getByTestId("callers-save"));
      expect(await screen.findByTestId("callers-result")).toHaveTextContent("18 given, the list has no more");
      expect(cap.assign).toEqual({ CallListId: 9, Assign: [{ UserId: 17, Count: 30 }] });
      expect(cap.saveCallers).toBeUndefined();
    });

    it("turns on automatic with a hold size and the picked callers, alongside a hand-out", async () => {
      const cap = mockCallingEndpoints();
      renderWithProviders(<ListFormModal open onClose={() => {}} />);
      const user = userEvent.setup();
      await toCallers(user);
      await user.type(screen.getByTestId("give-20"), "5");
      fireEvent.click(screen.getByTestId("auto-switch"));
      await user.click(screen.getByTestId("callers-save"));
      expect(await screen.findByTestId("callers-error")).toHaveTextContent("Pick at least one caller");
      fireEvent.click(screen.getByTestId("auto-18"));
      await user.clear(screen.getByTestId("hold-size"));
      await user.type(screen.getByTestId("hold-size"), "5");
      await user.click(screen.getByTestId("callers-save"));
      expect(await screen.findByTestId("callers-result")).toHaveTextContent("Automatic hand-out is on: 1 caller holds 5 at a time.");
      expect(cap.assign.Assign).toEqual([{ UserId: 20, Count: 5 }]);
      expect(cap.saveList).toMatchObject({ Id: 9, Name: "Surat traders", AutoTopUp: true, HoldSize: 5 });
      expect(cap.saveCallers).toEqual({ CallListId: 9, Callers: [{ UserId: 18, IsPaused: false }] });
    });

    it("a refused hand-out shows in the step and nothing else is posted", async () => {
      const cap = mockCallingEndpoints({ fail: { assign: { message: "You cannot give contacts to that person", status: 403 } } });
      renderWithProviders(<ListFormModal open onClose={() => {}} />);
      const user = userEvent.setup();
      await toCallers(user);
      const saves = cap.calls.saveList.length;
      await user.type(screen.getByTestId("give-20"), "5");
      fireEvent.click(screen.getByTestId("auto-switch"));
      fireEvent.click(screen.getByTestId("auto-18"));
      await user.click(screen.getByTestId("callers-save"));
      expect(await screen.findByTestId("callers-error")).toHaveTextContent("You cannot give contacts to that person");
      expect(cap.calls.saveList).toHaveLength(saves);
      expect(cap.saveCallers).toBeUndefined();
    });

    it("finds a person and skips without posting", async () => {
      const cap = mockCallingEndpoints();
      const onClose = vi.fn();
      renderWithProviders(<ListFormModal open onClose={onClose} />);
      const user = userEvent.setup();
      await toCallers(user);
      await user.type(screen.getByLabelText("Find a person"), "noida");
      expect(screen.queryByTestId("caller-17")).toBeNull();
      expect(screen.getByTestId("caller-20")).toBeInTheDocument();
      await user.click(screen.getByTestId("callers-save"));
      expect(onClose).toHaveBeenCalled();
      expect(cap.assign).toBeUndefined();
    });
  });
});
