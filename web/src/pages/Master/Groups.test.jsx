import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThemeProvider } from "@mui/material/styles";
import { buildTheme } from "../../theme";

const postMock = vi.fn();

let groupsData;
let accessByGroup;
let accessCache;

vi.mock("../../hooks/useApi", () => ({
  __esModule: true,
  default: () => ({ post: postMock }),
}));

vi.mock("../../hooks/useApiQuery", () => ({
  useApiQuery: ({ endpoint, params = {}, enabled = true }) => {
    if (endpoint.endsWith("fetchUserGroups")) {
      return { data: { userGroups: groupsData }, isLoading: false, refetch: vi.fn() };
    }
    if (endpoint.endsWith("fetchGroupAccess")) {
      if (!enabled || !params.GroupId) {
        return { data: undefined, isLoading: false, refetch: vi.fn() };
      }
      // Stable reference per group so the seed effect doesn't loop.
      if (!accessCache[params.GroupId]) {
        accessCache[params.GroupId] = { access: accessByGroup[params.GroupId] || [] };
      }
      return { data: accessCache[params.GroupId], isLoading: false, refetch: vi.fn() };
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

vi.mock("notistack", async () => {
  const actual = await vi.importActual("notistack");
  return { ...actual, useSnackbar: () => ({ enqueueSnackbar: vi.fn() }) };
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
    accessCache = {};
    groupsData = [
      { Id: 1, Name: "Salesperson", Description: "Sells things", IsActive: true },
      { Id: 2, Name: "Complaints Team", Description: "", IsActive: true },
    ];
    accessByGroup = {
      1: [
        {
          MenuId: 10, ParentId: 0, Title: "Sales", Route: "/sales",
          CanView: true, CanAdd: false, CanEdit: false, CanDelete: false,
        },
        {
          MenuId: 11, ParentId: 10, Title: "Leads", Route: "/sales/leads",
          CanView: false, CanAdd: false, CanEdit: false, CanDelete: false,
        },
      ],
    };
  });

  it("renders the group list from the mocked fetch", () => {
    renderPage();
    expect(screen.getByText("Salesperson")).toBeInTheDocument();
    expect(screen.getByText("Complaints Team")).toBeInTheDocument();
  });

  it("shows a prompt (no matrix) when no group is selected", () => {
    renderPage();
    expect(screen.getByText("Select a role")).toBeInTheDocument();
    expect(screen.queryByTestId("save-permissions-btn")).not.toBeInTheDocument();
  });

  it("selecting a group loads and renders its permission matrix", async () => {
    renderPage();
    const user = userEvent.setup();
    await user.click(screen.getByTestId("group-item-1"));

    expect(await screen.findByText(/Salesperson — Permissions/)).toBeInTheDocument();
    expect(screen.getByText("Sales")).toBeInTheDocument();
    expect(screen.getByText("Leads")).toBeInTheDocument();
    expect(screen.getByTestId("perm-11-CanView")).toBeInTheDocument();
    // Note about re-login is shown.
    expect(screen.getByText(/re-login to pick up permission changes/i)).toBeInTheDocument();
  });

  it("toggling a checkbox and saving posts saveGroupAccess with the updated matrix", async () => {
    renderPage();
    const user = userEvent.setup();
    await user.click(screen.getByTestId("group-item-1"));
    await screen.findByText(/Salesperson — Permissions/);

    // Leads/Add starts false → toggle it on. The checkbox input is visually
    // hidden (pointer-events:none), so click it via fireEvent like the ui test.
    fireEvent.click(screen.getByTestId("perm-11-CanAdd"));
    await user.click(screen.getByTestId("save-permissions-btn"));

    await waitFor(() => {
      expect(postMock).toHaveBeenCalledWith(
        "/api/user-groups/saveGroupAccess",
        expect.objectContaining({ GroupId: 1 })
      );
    });
    const body = postMock.mock.calls.find(
      (c) => c[0] === "/api/user-groups/saveGroupAccess"
    )[1];
    expect(body.Access).toContainEqual(
      expect.objectContaining({ MenuId: 11, CanAdd: true, CanView: false })
    );
    expect(body.Access).toContainEqual(
      expect.objectContaining({ MenuId: 10, CanView: true })
    );
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

  it("toggling a parent's View cascades to its child menus", async () => {
    renderPage();
    const user = userEvent.setup();
    await user.click(screen.getByTestId("group-item-1"));
    await screen.findByText(/Salesperson — Permissions/);

    // Parent (Sales) View starts true → toggle off should also clear child.
    fireEvent.click(screen.getByTestId("perm-10-CanView"));
    await user.click(screen.getByTestId("save-permissions-btn"));

    await waitFor(() => {
      expect(postMock).toHaveBeenCalledWith(
        "/api/user-groups/saveGroupAccess",
        expect.anything()
      );
    });
    const body = postMock.mock.calls.find(
      (c) => c[0] === "/api/user-groups/saveGroupAccess"
    )[1];
    expect(body.Access).toContainEqual(expect.objectContaining({ MenuId: 10, CanView: false }));
    expect(body.Access).toContainEqual(expect.objectContaining({ MenuId: 11, CanView: false }));
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
