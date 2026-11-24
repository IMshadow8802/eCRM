import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";

import TransferLeadModal from "./TransferLeadModal";
import useAuthStore from "../../stores/useAuthStore";
import { server } from "../../test/mocks/server";
import renderWithProviders from "../../test/renderWithProviders";

const json = (data, message = "ok") => HttpResponse.json({ success: true, message, responseCode: 200, data });
const refuse = (status, message) => HttpResponse.json({ success: false, message, responseCode: status }, { status });

const mocks = (capture = {}, over = {}) =>
  server.use(
    http.post("*/api/users/fetchAssignableUsers", async ({ request }) => {
      capture.roster = await request.json();
      return json({ users: [
        { Id: 2, FullName: "Bob Rao", GroupRank: 1 },
        { Id: 3, FullName: "Vivek Shah", GroupRank: 2, BranchName: "Pune" },
      ] });
    }),
    http.post("*/api/users/fetchBranches", async () => json({ branches: [{ Id: 2, BranchName: "Pune" }, { Id: 4, BranchName: "Nashik" }] })),
    http.post("*/api/config/fetchLookups", async () => json({ lookups: [{ Id: 1, Value: "Absent" }, { Id: 2, Value: "Wrong area" }] })),
    http.post("*/api/leads/transferLead", over.single ?? (async ({ request }) => {
      capture.single = await request.json();
      return json({ Id: 7, ResponseCode: 200, ResponseMess: "Lead reassigned successfully", FromUserId: 1, ToUserId: 3, ToName: "Vivek Shah" });
    })),
    http.post("*/api/leads/bulkTransferLeads", over.bulk ?? (async ({ request }) => {
      capture.bulk = await request.json();
      return json({ Transferred: 2, Skipped: 0, Moved: 2, Refused: 0, ResponseCode: 200, ResponseMess: "2 lead(s) reassigned" });
    })),
  );

const pick = async (user, testId, name) => {
  await user.click(screen.getByTestId(`${testId}-input`));
  await user.click(await screen.findByRole("option", { name: new RegExp(name) }));
};
const setReach = (reach) =>
  useAuthStore.setState({ access: { isAdmin: false, modules: { leads: { view: true, edit: true, reach } } } });
const render = (props = {}) => renderWithProviders(
  <TransferLeadModal open leadIds={[7]} onClose={() => {}} {...props} />, { router: false },
);

describe("TransferLeadModal — Reassign / Send back", () => {
  beforeEach(() => {
    useAuthStore.setState({ isAuthenticated: true, token: null, user: { UserId: 1 }, UserId: 1, API_BASE_URL: "https://prdinfotech.in/CRM" });
    setReach("Own");
  });

  it("asks the roster for this lead and reads 'Reassign to Vivek' once a person is picked", async () => {
    const cap = {};
    mocks(cap);
    const onDone = vi.fn();
    render({ onDone });
    const user = userEvent.setup();
    expect(screen.getByText("Reassign lead")).toBeInTheDocument();
    expect(screen.getByTestId("reassign-submit")).toHaveTextContent("Reassign");
    expect(screen.getByTestId("reassign-submit")).toBeDisabled();

    await pick(user, "reassign-person", "Vivek Shah");
    expect(cap.roster).toEqual({ Module: "leads", RecordId: 7 });
    expect(screen.getByTestId("reassign-submit")).toHaveTextContent("Reassign to Vivek");
    await pick(user, "reassign-reason", "Absent");
    await user.type(screen.getByTestId("reassign-remarks"), "On leave this week");
    await user.click(screen.getByTestId("reassign-submit"));

    await waitFor(() => expect(cap.single).toBeTruthy());
    expect(cap.single).toEqual({ LeadId: 7, ToUserId: 3, ToBranchId: null, ReasonId: 1, Remarks: "On leave this week" });
    expect(await screen.findByText("Reassigned to Vivek Shah")).toBeInTheDocument();
    expect(onDone).toHaveBeenCalledWith(expect.objectContaining({ ToName: "Vivek Shah" }));
  });

  it("never offers Sent back as a reason (only the Send back action writes it)", async () => {
    mocks();
    server.use(http.post("*/api/config/fetchLookups", async () => json({ lookups: [
      { Id: 1, Value: "Absent", Code: "absent" }, { Id: 39, Value: "Sent back", Code: "sent_back" },
    ] })));
    render();
    const user = userEvent.setup();
    await user.click(screen.getByTestId("reassign-reason-input"));
    expect(await screen.findByRole("option", { name: /^Absent/ })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /Sent back/ })).toBeNull();
  });

  it("never says Transfer, Branch, Owner or Assignee", async () => {
    mocks();
    setReach("Office");
    render();
    await screen.findByTestId("reassign-office-input");
    const text = screen.getByTestId("reassign-lead-modal").closest("[role=dialog]")?.textContent ?? document.body.textContent;
    expect(text).not.toMatch(/transfer|branch|owner|assignee/i);
  });

  it("refuses to submit without remarks", async () => {
    const cap = {};
    mocks(cap);
    render();
    const user = userEvent.setup();
    await pick(user, "reassign-person", "Bob Rao");
    await pick(user, "reassign-reason", "Absent");
    expect(screen.getByTestId("reassign-submit")).toBeDisabled();
    await user.click(screen.getByTestId("reassign-submit"));
    expect(cap.single).toBeUndefined();
  });

  it("Own reach: no Unassigned choice and no Move to another office", () => {
    mocks();
    render();
    expect(screen.queryByTestId("reassign-office-input")).toBeNull();
    expect(screen.queryByTestId("reassign-unassigned")).toBeNull();
    expect(screen.queryByText("Move to another office")).toBeNull();
  });

  it("Office reach: moves to another office and can leave it unassigned", async () => {
    const cap = {};
    mocks(cap, { single: async ({ request }) => {
      cap.single = await request.json();
      return json({ Id: 7, ResponseCode: 200, ToUserId: null, ToName: null });
    } });
    setReach("Office");
    render();
    const user = userEvent.setup();
    await pick(user, "reassign-office", "Nashik");
    fireEvent.click(screen.getByTestId("reassign-unassigned"));
    expect(screen.getByTestId("reassign-submit")).toHaveTextContent("Leave unassigned");
    await pick(user, "reassign-reason", "Wrong area");
    await user.type(screen.getByTestId("reassign-remarks"), "Address is Nashik");
    await user.click(screen.getByTestId("reassign-submit"));

    await waitFor(() => expect(cap.single).toBeTruthy());
    expect(cap.single).toEqual({ LeadId: 7, ToUserId: null, ToBranchId: 4, ReasonId: 2, Remarks: "Address is Nashik" });
    await waitFor(() => expect(screen.getAllByText("Unassigned")).toHaveLength(2)); // the checkbox + the snackbar
  });

  it("several leads: 'Reassign 2 leads', no record id on the roster, the server's count", async () => {
    const cap = {};
    mocks(cap);
    render({ leadIds: [7, 8] });
    const user = userEvent.setup();
    expect(screen.getByText("Reassign 2 leads")).toBeInTheDocument();

    await pick(user, "reassign-person", "Bob Rao");
    expect(cap.roster).toEqual({ Module: "leads" });
    await pick(user, "reassign-reason", "Absent");
    await user.type(screen.getByTestId("reassign-remarks"), "Covering");
    await user.click(screen.getByTestId("reassign-submit"));

    await waitFor(() => expect(cap.bulk).toBeTruthy());
    expect(cap.bulk).toEqual({ LeadIds: [7, 8], ToUserId: 2, ToBranchId: null, ReasonId: 1, Remarks: "Covering" });
    expect(await screen.findByText("2 lead(s) reassigned")).toBeInTheDocument();
  });

  it("bulk reassign of lost leads shows the server's 403 message and stays open", async () => {
    mocks({}, { bulk: () => refuse(403, "Only a manager can reassign a closed record (2 of 2 refused)") });
    const onDone = vi.fn();
    const onFailed = vi.fn();
    render({ leadIds: [7, 8], onDone, onFailed });
    const user = userEvent.setup();
    await pick(user, "reassign-person", "Bob Rao");
    await pick(user, "reassign-reason", "Absent");
    await user.type(screen.getByTestId("reassign-remarks"), "Covering");
    await user.click(screen.getByTestId("reassign-submit"));

    expect(await screen.findByText("Only a manager can reassign a closed record (2 of 2 refused)")).toBeInTheDocument();
    expect(onFailed).toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
    expect(screen.getByTestId("reassign-submit")).toBeInTheDocument();
  });

  it("send back: remarks only, posts SendBack with no reason, says who it went to", async () => {
    const cap = {};
    mocks(cap, { single: async ({ request }) => {
      cap.single = await request.json();
      return json({ Id: 7, ResponseCode: 200, ToUserId: 5, ToName: "Nitin Kale" });
    } });
    const onDone = vi.fn();
    render({ sendBackTo: { id: 5, name: "Nitin Kale" }, onDone });
    const user = userEvent.setup();
    expect(screen.getByText("Send back to Nitin Kale")).toBeInTheDocument();
    expect(screen.queryByTestId("reassign-reason-input")).toBeNull();
    expect(screen.queryByTestId("reassign-person-input")).toBeNull();
    expect(screen.getByTestId("reassign-submit")).toBeDisabled();

    await user.type(screen.getByTestId("reassign-remarks"), "Customer asked for you");
    expect(screen.getByTestId("reassign-submit")).toHaveTextContent("Send back to Nitin");
    await user.click(screen.getByTestId("reassign-submit"));

    await waitFor(() => expect(cap.single).toBeTruthy());
    expect(cap.single).toEqual({ LeadId: 7, SendBack: true, Remarks: "Customer asked for you" });
    expect(await screen.findByText("Sent back to Nitin Kale")).toBeInTheDocument();
    expect(onDone).toHaveBeenCalled();
  });

  it("send back refused (giver can no longer take it): shows the sentence and calls onFailed", async () => {
    mocks({}, { single: () => refuse(400, "Nitin Kale can no longer take this. Reassign it instead.") });
    const onFailed = vi.fn();
    render({ sendBackTo: { id: 5, name: "Nitin Kale" }, onFailed });
    const user = userEvent.setup();
    await user.type(screen.getByTestId("reassign-remarks"), "Back to you");
    await user.click(screen.getByTestId("reassign-submit"));
    expect(await screen.findByText("Nitin Kale can no longer take this. Reassign it instead.")).toBeInTheDocument();
    expect(onFailed).toHaveBeenCalled();
  });

  it("with onError the refusal goes to the caller instead of a toast (the detail leaves on a 404)", async () => {
    mocks({}, { single: () => refuse(404, "Lead not found") });
    const onError = vi.fn();
    const onFailed = vi.fn();
    render({ sendBackTo: { id: 5, name: "Nitin Kale" }, onError, onFailed });
    const user = userEvent.setup();
    await user.type(screen.getByTestId("reassign-remarks"), "Back to you");
    await user.click(screen.getByTestId("reassign-submit"));
    await waitFor(() => expect(onError).toHaveBeenCalled());
    expect(onError.mock.calls[0][0].response.status).toBe(404);
    expect(onFailed).toHaveBeenCalled();
    expect(screen.queryByText("Lead not found")).toBeNull();
  });

  it("Cancel clears the form and closes", async () => {
    mocks();
    const onClose = vi.fn();
    render({ onClose });
    const user = userEvent.setup();
    await user.type(screen.getByTestId("reassign-remarks"), "x");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalled();
  });
});
