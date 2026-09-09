import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";

import TransferLeadModal from "./TransferLeadModal";
import useAuthStore from "../../stores/useAuthStore";
import { server } from "../../test/mocks/server";
import renderWithProviders from "../../test/renderWithProviders";

const json = (data) => HttpResponse.json({ success: true, message: "ok", responseCode: 200, data });

const mocks = (capture = {}) =>
  server.use(
    http.post("*/api/users/fetchAssignableUsers", async ({ request }) => {
      const body = await request.json();
      capture.roster = body;
      return json({
        users: body?.BranchId === 4
          ? [{ Id: 9, FullName: "Nashik Nina", BranchId: 4 }]
          : [{ Id: 2, FullName: "Bob", BranchId: 2 }, { Id: 3, FullName: "Priya", BranchId: 2 }],
      });
    }),
    http.post("*/api/users/fetchBranches", async () =>
      json({ branches: [{ Id: 2, BranchName: "Pune" }, { Id: 4, BranchName: "Nashik" }] }),
    ),
    http.post("*/api/config/fetchLookups", async () =>
      json({ lookups: [{ Id: 1, Value: "Absent" }, { Id: 2, Value: "Wrong branch" }] }),
    ),
    http.post("*/api/leads/transferLead", async ({ request }) => {
      capture.single = await request.json();
      return json({ Id: 7, ResponseCode: 200, ResponseMess: "Lead transferred successfully" });
    }),
    http.post("*/api/leads/bulkTransferLeads", async ({ request }) => {
      capture.bulk = await request.json();
      return json({ Transferred: 2, Skipped: 0, ResponseCode: 200, ResponseMess: "2 lead(s) transferred" });
    }),
  );

const pick = async (user, testId, name) => {
  await user.click(screen.getByTestId(`${testId}-input`));
  await user.click(await screen.findByRole("option", { name }));
};

describe("TransferLeadModal", () => {
  beforeEach(() => {
    useAuthStore.setState({ isAuthenticated: true, token: null, user: { UserId: 1 }, UserId: 1, API_BASE_URL: "https://prdinfotech.in/CRM" });
  });

  it("posts transferLead with person, reason and remarks", async () => {
    const cap = {};
    mocks(cap);
    const onTransferred = vi.fn();
    renderWithProviders(<TransferLeadModal open leadIds={[7]} onClose={() => {}} onTransferred={onTransferred} />, { router: false });
    const user = userEvent.setup();

    await pick(user, "transfer-owner", "Priya");
    await pick(user, "transfer-reason", "Absent");
    await user.type(screen.getByTestId("transfer-remarks"), "On leave this week");
    await user.click(screen.getByTestId("transfer-submit"));

    await waitFor(() => expect(cap.single).toBeTruthy());
    expect(cap.single).toEqual({ LeadId: 7, ToUserId: 3, ToBranchId: null, ReasonId: 1, Remarks: "On leave this week" });
    expect(onTransferred).toHaveBeenCalled();
  });

  it("refuses to submit without remarks", async () => {
    const cap = {};
    mocks(cap);
    renderWithProviders(<TransferLeadModal open leadIds={[7]} onClose={() => {}} />, { router: false });
    const user = userEvent.setup();
    await pick(user, "transfer-owner", "Bob");
    await pick(user, "transfer-reason", "Absent");
    expect(screen.getByTestId("transfer-submit")).toBeDisabled();
    await user.click(screen.getByTestId("transfer-submit"));
    expect(cap.single).toBeUndefined();
  });

  it("cross-branch: picking a branch reloads the roster for it and sends ToBranchId", async () => {
    const cap = {};
    mocks(cap);
    renderWithProviders(<TransferLeadModal open leadIds={[7]} canCrossBranch onClose={() => {}} />, { router: false });
    const user = userEvent.setup();

    await pick(user, "transfer-branch", "Nashik");
    await waitFor(() => expect(cap.roster).toEqual({ BranchId: 4 }));
    await pick(user, "transfer-owner", "Nashik Nina");
    await pick(user, "transfer-reason", "Wrong branch");
    await user.type(screen.getByTestId("transfer-remarks"), "Address is Nashik");
    await user.click(screen.getByTestId("transfer-submit"));

    await waitFor(() => expect(cap.single).toBeTruthy());
    expect(cap.single).toMatchObject({ ToUserId: 9, ToBranchId: 4, ReasonId: 2 });
  });

  it("hides the branch picker when the caller cannot cross branches", () => {
    mocks();
    renderWithProviders(<TransferLeadModal open leadIds={[7]} onClose={() => {}} />, { router: false });
    expect(screen.queryByTestId("transfer-branch-input")).toBeNull();
  });

  it("several leads → bulkTransferLeads with the id list", async () => {
    const cap = {};
    mocks(cap);
    renderWithProviders(<TransferLeadModal open leadIds={[7, 8]} onClose={() => {}} />, { router: false });
    const user = userEvent.setup();
    expect(screen.getByText(/Transfer 2 leads/)).toBeInTheDocument();

    await pick(user, "transfer-owner", "Bob");
    await pick(user, "transfer-reason", "Absent");
    await user.type(screen.getByTestId("transfer-remarks"), "Covering");
    await user.click(screen.getByTestId("transfer-submit"));

    await waitFor(() => expect(cap.bulk).toBeTruthy());
    expect(cap.bulk).toEqual({ LeadIds: [7, 8], ToUserId: 2, ToBranchId: null, ReasonId: 1, Remarks: "Covering" });
  });
});
