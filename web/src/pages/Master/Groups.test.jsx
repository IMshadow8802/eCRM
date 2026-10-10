import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThemeProvider } from "@mui/material/styles";
import { buildTheme } from "../../theme";

const postMock = vi.fn();

let groupsData;
let groupsError = false;
const refetchGroups = vi.fn();
let modulesByGroup;
let modulesCache;
const refetchModules = vi.fn();

// Groups.jsx writes through api/masterQueries → the one shared apiClient.
vi.mock("../../utils/axiosConfig", () => ({
  __esModule: true,
  apiClient: { post: (...args) => postMock(...args) },
}));

vi.mock("../../hooks/useApiQuery", () => ({
  useApiQuery: ({ endpoint, params = {}, enabled = true }) => {
    if (endpoint.endsWith("fetchUserGroups")) {
      if (groupsError) return { data: undefined, isLoading: false, isError: true, refetch: refetchGroups };
      return { data: { userGroups: groupsData }, isLoading: false, refetch: vi.fn() };
    }
    if (endpoint.endsWith("fetchGroupModules")) {
      if (!enabled || !params.GroupId) {
        return { data: undefined, isLoading: false, refetch: vi.fn() };
      }
      const spec = modulesByGroup[params.GroupId];
      if (spec === "pending") return { data: undefined, isLoading: true, refetch: vi.fn() };
      if (spec === "error") {
        return { data: undefined, isLoading: false, isError: true, refetch: refetchModules };
      }
      // Stable reference per group so the seed effect doesn't loop.
      if (!modulesCache[params.GroupId]) {
        modulesCache[params.GroupId] = modulesByGroup[params.GroupId] || {
          modules: [], canSeeSensitive: false, isAdmin: false,
        };
      }
      return { data: modulesCache[params.GroupId], isLoading: false, refetch: refetchModules };
    }
    return { data: undefined, isLoading: false, refetch: vi.fn() };
  },
}));

// confirmDelete immediately runs onConfirm so the delete path is exercised.
vi.mock("../../hooks", () => ({
  useConfirmation: () => ({
    isOpen: false,
    confirmDelete: (opts) => opts.onConfirm(),
    confirmationState: {},
    hideConfirmation: vi.fn(),
    handleConfirm: vi.fn(),
    isLoading: false,
  }),
}));

const enqueueSnackbar = vi.fn();
vi.mock("notistack", async () => {
  const actual = await vi.importActual("notistack");
  return { ...actual, useSnackbar: () => ({ enqueueSnackbar }) };
});

import Groups from "./Groups";

const renderPage = () =>
  render(
    <ThemeProvider theme={buildTheme("light")}>
      <Groups />
    </ThemeProvider>
  );

describe("Roles & Permissions (Groups) page", () => {
  beforeEach(() => {
    postMock.mockReset();
    postMock.mockResolvedValue({ data: { success: true, data: { groupId: 5 } } });
    modulesCache = {};
    groupsError = false;
    refetchGroups.mockReset();
    refetchModules.mockReset();
    enqueueSnackbar.mockReset();
    groupsData = [
      { Id: 1, Name: "Salesperson", Description: "Sells things", IsActive: true },
      { Id: 2, Name: "Complaints Team", Description: "", IsActive: true },
      { Id: 3, Name: "Loading Role", Description: "", IsActive: true },
      { Id: 4, Name: "Broken Role", Description: "", IsActive: true },
    ];
    modulesByGroup = {
      1: {
        modules: [
          { Module: "leads", CanView: 1, CanAdd: 1, CanEdit: 1, CanDelete: 0, Reach: "Office" },
          { Module: "tasks", CanView: 1, CanAdd: 0, CanEdit: 0, CanDelete: 0, Reach: null },
        ],
        canSeeSensitive: false,
        isAdmin: false,
      },
      2: { modules: [], canSeeSensitive: true, isAdmin: true },
      3: "pending",
      4: "error",
    };
  });

  it("renders the group list from the mocked fetch", () => {
    renderPage();
    expect(screen.getByText("Salesperson")).toBeInTheDocument();
    expect(screen.getByText("Complaints Team")).toBeInTheDocument();
  });

  it("a failed roles fetch shows an error with Retry, not 'No roles yet'", async () => {
    groupsError = true;
    renderPage();
    expect(screen.getByText("Couldn't load roles")).toBeInTheDocument();
    expect(screen.queryByText("No roles yet.")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(refetchGroups).toHaveBeenCalled();
  });

  it("an empty roles list still says 'No roles yet'", () => {
    groupsData = [];
    renderPage();
    expect(screen.getByText("No roles yet.")).toBeInTheDocument();
  });

  it("shows a prompt (no matrix) when no group is selected", () => {
    renderPage();
    expect(screen.getByText("Select a role")).toBeInTheDocument();
    expect(screen.queryByTestId("save-permissions-btn")).not.toBeInTheDocument();
  });

  const openRole = async (id = 1) => {
    renderPage();
    const user = userEvent.setup();
    await user.click(screen.getByTestId(`group-item-${id}`));
    return user;
  };
  const savedBody = () =>
    postMock.mock.calls.find((c) => c[0] === "/api/user-groups/saveGroupModules")?.[1];

  it("renders one row per grantable module with a reach select only on reach modules", async () => {
    await openRole(1);
    expect(await screen.findByText(/Salesperson — Permissions/)).toBeInTheDocument();
    const labels = [
      "Leads, follow-ups, quotations", "Sales reports", "Partners & commission", "Complaints", "Support reports",
      "Customers", "People", "Tasks & My Work", "Teams", "Projects",
      "Attendance (team presence)", "Settings & products", "Dashboard",
    ];
    for (const l of labels) expect(screen.getByText(l)).toBeInTheDocument();
    expect(screen.getAllByTestId(/^module-row-/)).toHaveLength(13);
    expect(screen.queryByTestId("module-row-roles")).toBeNull();
    expect(screen.queryByTestId("module-row-offices")).toBeNull();

    // B: a reach select shows only where View is ticked (here: leads); the rest show a dash.
    expect(screen.getByTestId("reach-leads-input")).toBeInTheDocument();
    for (const k of ["complaints", "customers", "people"]) {
      expect(screen.queryByTestId(`reach-${k}-input`)).toBeNull();
      expect(screen.getByTestId(`reach-${k}-none`)).toHaveTextContent("—");
    }
    for (const k of ["sales_reports", "partners", "support_reports", "tasks", "teams", "projects", "attendance", "settings", "dashboard"]) {
      expect(screen.queryByTestId(`reach-${k}-input`)).toBeNull();
    }
    expect(screen.getByTestId("reach-leads-input")).toHaveValue("Their office");
    expect(screen.getByTestId("perm-leads-CanAdd")).toBeChecked();
    expect(screen.getByTestId("perm-leads-CanDelete")).not.toBeChecked();
    // A: access is re-read on every request; nobody has to log in again.
    expect(screen.getByText("Changes apply on the user's next action.")).toBeInTheDocument();
    expect(screen.queryByText(/re-login/i)).toBeNull();
  });

  it("has an attendance row whose reach select appears once View is ticked", async () => {
    await openRole(1);
    await screen.findByText(/Salesperson — Permissions/);
    expect(screen.queryByTestId("reach-attendance-input")).toBeNull();
    fireEvent.click(screen.getByTestId("perm-attendance-CanView"));
    expect(screen.getByTestId("reach-attendance-input")).toHaveValue("Own records");
  });

  it("saving the attendance row with Office reach sends Reach Office", async () => {
    const user = await openRole(1);
    await screen.findByText(/Salesperson — Permissions/);
    fireEvent.click(screen.getByTestId("perm-attendance-CanView"));
    await user.click(screen.getByLabelText("Attendance (team presence)"));
    await user.click(await screen.findByRole("option", { name: "Their office" }));
    await user.click(screen.getByTestId("save-permissions-btn"));
    await waitFor(() => expect(savedBody()).toBeDefined());
    expect(savedBody().Modules).toContainEqual(expect.objectContaining({ Module: "attendance", CanView: true, Reach: "Office" }));
  });

  it("ticking Add ticks View; unticking View clears the row", async () => {
    await openRole(1);
    await screen.findByText(/Salesperson — Permissions/);

    fireEvent.click(screen.getByTestId("perm-complaints-CanAdd"));
    expect(screen.getByTestId("perm-complaints-CanView")).toBeChecked();
    expect(screen.getByTestId("reach-complaints-input")).toHaveValue("Own records");

    fireEvent.click(screen.getByTestId("perm-leads-CanView"));
    for (const f of ["CanView", "CanAdd", "CanEdit", "CanDelete"]) {
      expect(screen.getByTestId(`perm-leads-${f}`)).not.toBeChecked();
    }
    expect(screen.queryByTestId("reach-leads-input")).toBeNull();
    expect(screen.getByTestId("reach-leads-none")).toBeInTheDocument();
  });

  it("saves Modules + CanSeeSensitive", async () => {
    const user = await openRole(1);
    await screen.findByText(/Salesperson — Permissions/);

    // Change Leads reach to Company, grant Dashboard view, tick sensitive.
    await user.click(screen.getByLabelText("Leads, follow-ups, quotations"));
    await user.click(await screen.findByRole("option", { name: "Whole company" }));
    fireEvent.click(screen.getByTestId("perm-dashboard-CanView"));
    fireEvent.click(screen.getByTestId("can-see-sensitive"));
    await user.click(screen.getByTestId("save-permissions-btn"));

    await waitFor(() => expect(savedBody()).toBeDefined());
    const body = savedBody();
    expect(body.GroupId).toBe(1);
    expect(body.CanSeeSensitive).toBe(true);
    expect(body.Modules.map((m) => m.Module).sort()).toEqual(["dashboard", "leads", "tasks"]);
    expect(body.Modules).toContainEqual({
      Module: "leads", CanView: true, CanAdd: true, CanEdit: true, CanDelete: false, Reach: "Company",
    });
    expect(body.Modules).toContainEqual({
      Module: "dashboard", CanView: true, CanAdd: false, CanEdit: false, CanDelete: false, Reach: null,
    });
  });

  it("reports a refused save", async () => {
    postMock.mockResolvedValueOnce({ data: { success: false, message: "nope" } });
    const user = await openRole(1);
    await screen.findByText(/Salesperson — Permissions/);
    await user.click(screen.getByTestId("save-permissions-btn"));
    await waitFor(() => expect(enqueueSnackbar).toHaveBeenCalledWith("nope", { variant: "error" }));

    postMock.mockRejectedValueOnce({ response: { data: { message: "403 no" } } });
    await user.click(screen.getByTestId("save-permissions-btn"));
    await waitFor(() => expect(enqueueSnackbar).toHaveBeenCalledWith("403 no", { variant: "error" }));
  });

  it("switching to a role that is still loading shows no grid, no Save and no stale rows", async () => {
    const user = await openRole(1);
    await screen.findByText(/Salesperson — Permissions/);
    fireEvent.click(screen.getByTestId("perm-dashboard-CanView")); // unsaved edit on role 1

    await user.click(screen.getByTestId("group-item-3"));
    expect(await screen.findByText(/Loading Role — Permissions/)).toBeInTheDocument();
    expect(screen.getByText("Loading permissions…")).toBeInTheDocument();
    expect(screen.queryByTestId("module-row-leads")).toBeNull();
    expect(screen.queryByTestId("save-permissions-btn")).toBeNull();
  });

  it("a role whose fetch failed shows an error with a retry, and no grid", async () => {
    const user = await openRole(4);
    expect(await screen.findByText("Couldn't load this role's permissions")).toBeInTheDocument();
    expect(screen.queryByTestId("module-row-leads")).toBeNull();
    expect(screen.queryByTestId("save-permissions-btn")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(refetchModules).toHaveBeenCalled();
  });

  it("switching roles drops unsaved edits and seeds the new role", async () => {
    const user = await openRole(1);
    await screen.findByText(/Salesperson — Permissions/);
    fireEvent.click(screen.getByTestId("perm-dashboard-CanView"));
    await user.click(screen.getByTestId("group-item-2"));
    await user.click(screen.getByTestId("group-item-1"));
    await screen.findByText(/Salesperson — Permissions/);
    expect(screen.getByTestId("perm-dashboard-CanView")).not.toBeChecked();
  });

  it("a refetch of the same role (window focus) keeps unsaved edits", async () => {
    await openRole(1);
    await screen.findByText(/Salesperson — Permissions/);
    fireEvent.click(screen.getByTestId("perm-dashboard-CanView"));
    // A new data object for the same group, as a background refetch returns.
    modulesCache[1] = { ...modulesByGroup[1], modules: [...modulesByGroup[1].modules] };
    fireEvent.click(screen.getByTestId("perm-teams-CanView")); // forces a render
    expect(screen.getByTestId("perm-dashboard-CanView")).toBeChecked();
    expect(screen.getByTestId("perm-teams-CanView")).toBeChecked();
  });

  it("refetches the saved role so coming back shows what was saved", async () => {
    const user = await openRole(1);
    await screen.findByText(/Salesperson — Permissions/);
    fireEvent.click(screen.getByTestId("perm-dashboard-CanView"));
    await user.click(screen.getByTestId("save-permissions-btn"));
    await waitFor(() => expect(refetchModules).toHaveBeenCalled());

    // The refetch landed: the cache now holds the saved grid.
    modulesCache[1] = {
      ...modulesByGroup[1],
      modules: [...modulesByGroup[1].modules, { Module: "dashboard", CanView: 1, CanAdd: 0, CanEdit: 0, CanDelete: 0, Reach: null }],
    };
    await user.click(screen.getByTestId("group-item-2"));
    await user.click(screen.getByTestId("group-item-1"));
    await screen.findByText(/Salesperson — Permissions/);
    expect(screen.getByTestId("perm-dashboard-CanView")).toBeChecked();
  });

  it("checkboxes are named by module and permission", async () => {
    await openRole(1);
    await screen.findByText(/Salesperson — Permissions/);
    expect(screen.getByLabelText("Complaints Add")).toBe(screen.getByTestId("perm-complaints-CanAdd"));
  });

  it("an admin role shows a note instead of the grid", async () => {
    await openRole(2);
    expect(
      await screen.findByText("Administrators can do everything; there is nothing to set.")
    ).toBeInTheDocument();
    expect(screen.queryByTestId("module-row-leads")).toBeNull();
    expect(screen.queryByTestId("save-permissions-btn")).toBeNull();
  });

  it("creating a group posts saveUserGroup with Id:0", async () => {
    renderPage();
    const user = userEvent.setup();
    await user.click(screen.getByTestId("new-group-btn"));

    await user.type(await screen.findByLabelText(/Name/), "Support Lead");
    await user.click(screen.getByTestId("save-group-btn"));

    await waitFor(() => {
      expect(postMock).toHaveBeenCalledWith(
        "/api/user-groups/saveUserGroup",
        expect.objectContaining({ Id: 0, Name: "Support Lead", IsActive: true })
      );
    });
  });

  it("editing an existing group posts saveUserGroup with its Id", async () => {
    renderPage();
    const user = userEvent.setup();
    await user.click(screen.getByLabelText("Edit Salesperson"));

    expect(await screen.findByText("Edit Group")).toBeInTheDocument();
    await user.click(screen.getByTestId("save-group-btn"));

    await waitFor(() => {
      expect(postMock).toHaveBeenCalledWith(
        "/api/user-groups/saveUserGroup",
        expect.objectContaining({ Id: 1, Name: "Salesperson" })
      );
    });
  });

  it("blocks saving a group with an empty name", async () => {
    renderPage();
    const user = userEvent.setup();
    await user.click(screen.getByTestId("new-group-btn"));
    await user.click(screen.getByTestId("save-group-btn"));

    expect(await screen.findByText("Name is required")).toBeInTheDocument();
    expect(postMock).not.toHaveBeenCalledWith(
      "/api/user-groups/saveUserGroup",
      expect.anything()
    );
  });

  it("deleting a group posts deleteUserGroup", async () => {
    renderPage();
    const user = userEvent.setup();
    await user.click(screen.getByLabelText("Delete Complaints Team"));

    await waitFor(() => {
      expect(postMock).toHaveBeenCalledWith(
        "/api/user-groups/deleteUserGroup",
        { Id: 2 }
      );
    });
  });
});
