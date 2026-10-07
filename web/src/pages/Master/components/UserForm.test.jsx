import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import renderWithProviders from "../../../test/renderWithProviders";

const post = vi.fn();

vi.mock("../../../utils/axiosConfig", () => ({
  __esModule: true,
  apiClient: { post: (...args) => post(...args) },
}));

vi.mock("../../../stores/useAuthStore", () => ({
  __esModule: true,
  default: () => ({ CompId: 1, BranchId: 2, UserId: 7 }),
}));

vi.mock("../../../hooks/useApiQuery", () => ({
  useApiQuery: vi.fn(),
}));

const enqueueSnackbar = vi.fn();
vi.mock("notistack", async () => {
  const actual = await vi.importActual("notistack");
  return { ...actual, useSnackbar: () => ({ enqueueSnackbar }) };
});

import UserForm from "./UserForm";
import { useApiQuery } from "../../../hooks/useApiQuery";

const EXISTING_USER = {
  Id: 11,
  Username: "Vikas",
  FullName: "Vikas Jaiswal",
  Email: "vikas@jaiswal.com",
  Mobile: "7972627064",
  JobTitle: "Engineer",
  HourlyRate: 12.5,
  GroupId: 8,
  BranchId: 3,
  UserActive: true,
  AllowDay: 0,
  UserIp: "",
};

const renderForm = (props = {}) =>
  renderWithProviders(
    <UserForm
      open
      onClose={vi.fn()}
      userGroups={[{ Id: 8, Name: "General Users" }]}
      onUserSaved={vi.fn()}
      {...props}
    />
  );

const submit = async (label) =>
  userEvent.click(screen.getByRole("button", { name: label }));

beforeEach(() => {
  post.mockReset();
  post.mockResolvedValue({ data: { success: true } });
  enqueueSnackbar.mockReset();
  useApiQuery.mockReset();
  useApiQuery.mockImplementation(({ endpoint }) =>
    endpoint === "/api/users/fetchBranches"
      ? { data: { branches: [{ Id: 2, BranchName: "Mumbai" }, { Id: 3, BranchName: "Delhi" }] } }
      : { data: { users: [{ Id: 4, FullName: "Meera Manager" }, { Id: 9, FullName: "Self" }] } }
  );
});

describe("UserForm password rules", () => {
  // REGRESSION: the Zod rule was an unconditional .min(6), while the field's own
  // label said "(leave empty to keep current)". Editing anything about a user
  // was impossible without also retyping their password, and doing so used to
  // overwrite the stored hash.
  it("submits an edit with a blank password and omits it from the payload", async () => {
    renderForm({ editingUser: EXISTING_USER });

    await userEvent.clear(screen.getByPlaceholderText("Enter job title"));
    await userEvent.type(screen.getByPlaceholderText("Enter job title"), "Lead");
    await submit(/update user/i);

    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    const [url, payload] = post.mock.calls[0];
    expect(url).toBe("/api/users/saveUser");
    expect(payload.Id).toBe(11);
    expect(payload.JobTitle).toBe("Lead");
    expect(payload.Password).toBeUndefined();
    expect(
      screen.queryByText(/password must be at least 6 characters/i)
    ).not.toBeInTheDocument();
  });

  it("sends the new password when the admin does type one on an edit", async () => {
    renderForm({ editingUser: EXISTING_USER });

    await userEvent.type(
      screen.getByPlaceholderText("Enter new password"),
      "brandnew1"
    );
    await submit(/update user/i);

    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post.mock.calls[0][1].Password).toBe("brandnew1");
  });

  it("still requires a password when creating a user", async () => {
    renderForm();

    await userEvent.type(screen.getByPlaceholderText("Enter username"), "newguy");
    await userEvent.type(screen.getByPlaceholderText("Enter full name"), "New Guy");
    await submit(/create user/i);

    expect(
      await screen.findByText(/password must be at least 6 characters/i)
    ).toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();
  });

  it("rejects a too-short password on edit rather than silently accepting it", async () => {
    renderForm({ editingUser: EXISTING_USER });

    await userEvent.type(screen.getByPlaceholderText("Enter new password"), "abc");
    await submit(/update user/i);

    expect(
      await screen.findByText(/password must be at least 6 characters/i)
    ).toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();
  });
});

describe("UserForm identity fields", () => {
  // REGRESSION: Users.jsx handleEdit omitted Mobile, so it rendered blank and
  // every edit sent null, wiping a login identifier. The form must round-trip
  // whatever it was handed.
  it("round-trips Mobile on edit instead of blanking it", async () => {
    renderForm({ editingUser: EXISTING_USER });

    expect(screen.getByPlaceholderText("Enter mobile number")).toHaveValue(
      "7972627064"
    );

    await submit(/update user/i);
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post.mock.calls[0][1].Mobile).toBe("7972627064");
  });

  it("keeps Username and FullName as separate values", async () => {
    renderForm({ editingUser: EXISTING_USER });

    expect(screen.getByPlaceholderText("Enter username")).toHaveValue("Vikas");
    expect(screen.getByPlaceholderText("Enter full name")).toHaveValue(
      "Vikas Jaiswal"
    );

    await submit(/update user/i);
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post.mock.calls[0][1]).toMatchObject({
      Username: "Vikas",
      FullName: "Vikas Jaiswal",
    });
  });

  it("requires a username and a full name", async () => {
    renderForm();

    await userEvent.type(
      screen.getByPlaceholderText("Enter password"),
      "goodpass1"
    );
    await submit(/create user/i);

    expect(await screen.findByText(/username is required/i)).toBeInTheDocument();
    expect(await screen.findByText(/full name is required/i)).toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();
  });
});

describe("UserForm submit outcomes", () => {
  it("reports a failure from the API without closing", async () => {
    post.mockRejectedValueOnce(new Error("Username already exists"));
    const onClose = vi.fn();
    renderForm({ editingUser: EXISTING_USER, onClose });

    await submit(/update user/i);

    await waitFor(() => expect(enqueueSnackbar).toHaveBeenCalled());
    expect(enqueueSnackbar.mock.calls[0][0]).toMatch(/failed to update user/i);
    expect(onClose).not.toHaveBeenCalled();
  });

  // REGRESSION: the SP refuses a reporting-loop with a real 400 + message
  // ("Reporting line would loop"), which axios surfaces as
  // error.response.data.message — the catch block read only error.message,
  // so the admin saw the generic "Request failed with status code 400"
  // instead of the actual reason.
  it("surfaces the server's rejection reason, not the generic HTTP status text", async () => {
    post.mockRejectedValueOnce({
      response: { data: { message: "Reporting line would loop" } },
      message: "Request failed with status code 400",
    });
    renderForm({ editingUser: EXISTING_USER });

    await submit(/update user/i);

    // notistack's useSnackbar is mocked to the enqueueSnackbar spy above (see
    // top of file) rather than a real SnackbarProvider render, so the toast
    // text is asserted on the spy call — the same pattern every other outcome
    // test in this file uses — not via a DOM findByText.
    await waitFor(() => expect(enqueueSnackbar).toHaveBeenCalled());
    expect(enqueueSnackbar.mock.calls[0][0]).toMatch(/reporting line would loop/i);
  });

  it("closes and reports success on a good save", async () => {
    const onClose = vi.fn();
    const onUserSaved = vi.fn();
    renderForm({ editingUser: EXISTING_USER, onClose, onUserSaved });

    await submit(/update user/i);

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(onUserSaved).toHaveBeenCalled();
    expect(enqueueSnackbar.mock.calls[0][0]).toMatch(/updated successfully/i);
  });

  it("cancel closes without saving", async () => {
    const onClose = vi.fn();
    renderForm({ onClose });

    await userEvent.click(screen.getByRole("button", { name: /cancel/i }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(post).not.toHaveBeenCalled();
  });
});

describe("UserForm Reports To", () => {
  // Reports To (FormSelect) is a Combobox/MUI Autocomplete, not a native
  // <select> — options render lazily in a popper on open, so exercising it
  // follows the same click-then-pick-an-option pattern already used for every
  // other Combobox-backed field in this codebase (see Combobox.test.jsx,
  // LeadDetail.test.jsx, TaskCreateModal.test.jsx).
  it("offers the company directory as Reports To, minus the user being edited", async () => {
    renderForm({ editingUser: { Id: 9, Username: "self", FullName: "Self", GroupId: 2 } });
    const user = userEvent.setup();
    await user.click(screen.getByLabelText(/Reports To/));
    expect(await screen.findByRole("option", { name: "Meera Manager" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Self" })).not.toBeInTheDocument();
  });

  it("sends ReportsTo as a number when a manager is picked", async () => {
    post.mockResolvedValue({ data: { success: true } });
    renderForm({});
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/Username/), "bob");
    await user.type(screen.getByLabelText(/^Password/), "secret1");
    await user.type(screen.getByLabelText(/Full Name/), "Bob");
    await user.click(screen.getByLabelText(/Reports To/));
    await user.click(await screen.findByRole("option", { name: "Meera Manager" }));
    await submit(/create user/i);
    await waitFor(() => expect(post.mock.calls[0][1]).toMatchObject({ ReportsTo: 4 }));
  });

  it("sends ReportsTo as null when left blank", async () => {
    post.mockResolvedValue({ data: { success: true } });
    renderForm({});
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/Username/), "bob2");
    await user.type(screen.getByLabelText(/^Password/), "secret1");
    await user.type(screen.getByLabelText(/Full Name/), "Bob Two");
    await submit(/create user/i);
    await waitFor(() => expect(post.mock.calls[0][1]).toMatchObject({ ReportsTo: null }));
  });

  it("clears ReportsTo back to null after a manager was picked", async () => {
    post.mockResolvedValue({ data: { success: true } });
    renderForm({});
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/Username/), "bob3");
    await user.type(screen.getByLabelText(/^Password/), "secret1");
    await user.type(screen.getByLabelText(/Full Name/), "Bob Three");
    await user.click(screen.getByLabelText(/Reports To/));
    await user.click(await screen.findByRole("option", { name: "Meera Manager" }));

    const label = screen.getByText("Reports To");
    await user.click(within(label.parentElement).getByTitle("Clear"));

    await submit(/create user/i);
    await waitFor(() => expect(post.mock.calls[0][1]).toMatchObject({ ReportsTo: null }));
  });

  it("falls back to an empty Reports To list before the directory has loaded", async () => {
    useApiQuery.mockImplementation(() => ({ data: undefined }));
    renderForm({});
    const user = userEvent.setup();
    await user.click(screen.getByLabelText(/Reports To/));
    expect(await screen.findByText(/Nothing found/i)).toBeInTheDocument();
  });

  it("shows the API's failure message when success is false", async () => {
    post.mockResolvedValueOnce({ data: { success: false, message: "Username taken" } });
    renderForm({});
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/Username/), "dupe");
    await user.type(screen.getByLabelText(/^Password/), "secret1");
    await user.type(screen.getByLabelText(/Full Name/), "Dup User");
    await submit(/create user/i);
    await waitFor(() =>
      expect(enqueueSnackbar).toHaveBeenCalledWith("Username taken", { variant: "error" })
    );
  });
});

const fillCreate = async (user, name) => {
  await user.type(screen.getByLabelText(/Username/), name);
  await user.type(screen.getByLabelText(/^Password/), "secret1");
  await user.type(screen.getByLabelText(/Full Name/), name);
};

describe("UserForm role, branch and admin flag", () => {
  // REGRESSION: the form had an Is Admin checkbox that the server now ignores.
  it("renders no Is Admin checkbox and sends no IsAdmin or CompId", async () => {
    renderForm({ editingUser: EXISTING_USER });
    expect(screen.queryByLabelText(/is admin/i)).toBeNull();
    await submit(/update user/i);
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post.mock.calls[0][1]).not.toHaveProperty("IsAdmin");
    expect(post.mock.calls[0][1]).not.toHaveProperty("CompId");
  });

  // REGRESSION (audit B4): a null GroupId used to post as 0 and hit the FK.
  it("refuses an edit with no role instead of posting GroupId 0", async () => {
    renderForm({ editingUser: { ...EXISTING_USER, GroupId: null } });
    await submit(/update user/i);
    expect(await screen.findByText("Pick a role")).toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();
  });

  it("defaults the Branch to the admin's and sends a picked one", async () => {
    renderForm({});
    const user = userEvent.setup();
    expect(screen.getByLabelText(/^Branch/)).toHaveValue("Mumbai");
    await fillCreate(user, "bran");
    await user.click(screen.getByLabelText(/^Branch/));
    await user.click(await screen.findByRole("option", { name: "Delhi" }));
    await submit(/create user/i);
    await waitFor(() => expect(post.mock.calls[0][1]).toMatchObject({ BranchId: 3 }));
  });

  it("create sends the admin's branch when untouched", async () => {
    renderForm({});
    const user = userEvent.setup();
    await fillCreate(user, "bran2");
    await submit(/create user/i);
    await waitFor(() => expect(post.mock.calls[0][1]).toMatchObject({ BranchId: 2 }));
  });

  // REGRESSION: onSubmit used to overwrite BranchId with the admin's.
  it("edit prefills the user's branch and sends it, not the admin's", async () => {
    renderForm({ editingUser: EXISTING_USER });
    expect(screen.getByLabelText(/^Branch/)).toHaveValue("Delhi");
    await submit(/update user/i);
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post.mock.calls[0][1].BranchId).toBe(3);
  });

  it("falls back to an empty branch list before branches load", async () => {
    useApiQuery.mockImplementation(() => ({ data: undefined }));
    renderForm({});
    await userEvent.click(screen.getByLabelText(/^Branch/));
    expect(await screen.findByText(/Nothing found/i)).toBeInTheDocument();
  });
});

describe("UserForm deactivation", () => {
  const HANDOVER = {
    OpenTasks: 3, OpenLeads: 5, OpenTickets: 2, OwnedWorkspaces: 1, DirectReports: 1,
    workspaces: [{ Id: 1, Name: "Ops", Type: "shared" }],
    reports: [{ Id: 5, FullName: "Asha" }],
  };
  const route = (handover) => (url) =>
    url === "/api/users/fetchUserHandover"
      ? handover instanceof Error
        ? Promise.reject(handover)
        : Promise.resolve({ data: { success: true, data: { handover } } })
      : Promise.resolve({ data: { success: true, data: { unassignedTasks: 3 } } });

  const deactivate = async () => {
    const user = userEvent.setup();
    await user.click(screen.getByText("User Active"));
    await submit(/update user/i);
  };
  const saves = () => post.mock.calls.filter(([u]) => u === "/api/users/saveUser");

  it("fetches the handover first, shows it, and saves only on confirm", async () => {
    post.mockImplementation(route(HANDOVER));
    const onClose = vi.fn();
    renderForm({ editingUser: EXISTING_USER, onClose });
    await deactivate();

    expect(await screen.findByText(/3 open tasks will be unassigned/i)).toBeInTheDocument();
    expect(post.mock.calls[0]).toEqual(["/api/users/fetchUserHandover", { Id: 11 }]);
    expect(saves()).toHaveLength(0);
    expect(screen.getByText(/5 open leads/i)).toBeInTheDocument();
    expect(screen.getByText(/2 open complaints/i)).toBeInTheDocument();
    expect(screen.getByText(/1 workspace they own: Ops/i)).toBeInTheDocument();
    expect(screen.getByText(/1 person reports to them: Asha/i)).toBeInTheDocument();
    const links = screen.getAllByRole("link", { name: "Transfer" });
    expect(links[0].getAttribute("href")).toMatch(/\/sales\/leads\?OwnerId=11$/);
    expect(links[1].getAttribute("href")).toMatch(/\/support\/tickets\?AssignedTo=11$/);

    await userEvent.click(screen.getByRole("button", { name: "Deactivate" }));
    await waitFor(() => expect(saves()).toHaveLength(1));
    expect(saves()[0][1].UserActive).toBe(false);
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(enqueueSnackbar.mock.calls.at(-1)[0]).toBe(
      "User updated successfully! 3 open tasks were unassigned."
    );
  });

  it("cancel saves nothing", async () => {
    post.mockImplementation(route(HANDOVER));
    renderForm({ editingUser: EXISTING_USER });
    await deactivate();
    await screen.findByText(/3 open tasks/i);
    const cancels = screen.getAllByRole("button", { name: /^cancel$/i });
    await userEvent.click(cancels[cancels.length - 1]); // the confirm dialog portals last
    expect(saves()).toHaveLength(0);
    await waitFor(() => expect(screen.queryByText(/3 open tasks/i)).toBeNull());
  });

  it("says nothing is assigned when every count is zero", async () => {
    post.mockImplementation(route({ OpenTasks: 0, OpenLeads: 0, OpenTickets: 0, OwnedWorkspaces: 0, DirectReports: 0, workspaces: [], reports: [] }));
    renderForm({ editingUser: EXISTING_USER });
    await deactivate();
    expect(await screen.findByText(/nothing assigned/i)).toBeInTheDocument();
  });

  it("still opens, and still saves, when the handover lookup fails", async () => {
    post.mockImplementation(route(new Error("down")));
    renderForm({ editingUser: EXISTING_USER });
    await deactivate();
    expect(await screen.findByText(/Couldn't load what this user holds/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Deactivate" }));
    await waitFor(() => expect(saves()).toHaveLength(1));
  });

  it("keeps the dialog's failure visible when the confirmed save is refused", async () => {
    post.mockImplementation((url) =>
      url === "/api/users/fetchUserHandover"
        ? Promise.resolve({ data: { data: { handover: HANDOVER } } })
        : Promise.reject({ response: { data: { message: "last active admin" } }, message: "409" })
    );
    renderForm({ editingUser: EXISTING_USER });
    await deactivate();
    await userEvent.click(await screen.findByRole("button", { name: "Deactivate" }));
    await waitFor(() => expect(enqueueSnackbar.mock.calls.at(-1)[0]).toMatch(/last active admin/));
  });

  it("saves directly, with no handover call, when Active is unchanged", async () => {
    renderForm({ editingUser: EXISTING_USER });
    await submit(/update user/i);
    await waitFor(() => expect(saves()).toHaveLength(1));
    expect(post.mock.calls.some(([u]) => u === "/api/users/fetchUserHandover")).toBe(false);
  });

  it("saves directly when re-activating an inactive user", async () => {
    renderForm({ editingUser: { ...EXISTING_USER, UserActive: false } });
    await userEvent.click(screen.getByText("User Active"));
    await submit(/update user/i);
    await waitFor(() => expect(saves()).toHaveLength(1));
    expect(post.mock.calls.some(([u]) => u === "/api/users/fetchUserHandover")).toBe(false);
  });
});
