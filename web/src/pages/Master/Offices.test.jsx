import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import renderWithProviders from "../../test/renderWithProviders";

const postMock = vi.fn();
const refetch = vi.fn();
let branches;

vi.mock("../../utils/axiosConfig", () => ({
  __esModule: true,
  apiClient: { post: (...args) => postMock(...args) },
}));

vi.mock("../../hooks/useApiQuery", () => ({
  useApiQuery: () => ({ data: { branches }, isLoading: false, refetch }),
}));

const enqueueSnackbar = vi.fn();
vi.mock("notistack", async () => {
  const actual = await vi.importActual("notistack");
  return { ...actual, useSnackbar: () => ({ enqueueSnackbar }) };
});

import Offices from "./Offices";

const savedBody = () => postMock.mock.calls.find((c) => c[0] === "/api/branches/saveBranch")?.[1];

beforeEach(() => {
  postMock.mockReset();
  postMock.mockResolvedValue({ data: { success: true, data: { id: 9 } } });
  refetch.mockReset();
  enqueueSnackbar.mockReset();
  branches = [
    { Id: 4, BranchName: "West HO", ParentId: null, IsActive: true, Address: "", PeopleCount: 0 },
    { Id: 3, BranchName: "Noida", ParentId: 1, IsActive: false, Address: "", PeopleCount: 1 },
    { Id: 1, BranchName: "HO", ParentId: null, IsActive: true, Address: "MG Road", PeopleCount: 12 },
    { Id: 2, BranchName: "Delhi", ParentId: 1, IsActive: true, Address: "", PeopleCount: 4 },
  ];
});

describe("Offices", () => {
  it("draws the tree from ParentId", () => {
    renderWithProviders(<Offices />);
    const rows = screen.getAllByTestId(/^office-row-/);
    expect(rows.map((r) => r.dataset.testid)).toEqual([
      "office-row-1", "office-row-2", "office-row-3", "office-row-4",
    ]);
    const indent = (id) => screen.getByTestId(`office-name-${id}`).style.paddingLeft;
    expect(indent(1)).toBe("0px");
    expect(indent(2)).toBe("24px");
    expect(indent(3)).toBe("24px");
    expect(indent(4)).toBe("0px");
    expect(within(rows[0]).getByText("12 people")).toBeInTheDocument();
    expect(within(rows[2]).getByText("1 person")).toBeInTheDocument();
    expect(within(rows[2]).getByText("Inactive")).toBeInTheDocument();
    expect(within(rows[0]).queryByText("Inactive")).toBeNull();
  });

  it("shows an empty state with no offices", () => {
    branches = [];
    renderWithProviders(<Offices />);
    expect(screen.getByText("No offices yet")).toBeInTheDocument();
  });

  it("adds an office under a parent", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Offices />);
    await user.click(screen.getByLabelText("Add under HO"));
    expect(screen.getByLabelText(/^Parent office/)).toHaveValue("HO");
    expect(screen.queryByText("Active")).toBeNull(); // only on edit
    await user.type(screen.getByLabelText(/^Name/), "Gurgaon");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(savedBody()).toBeDefined());
    expect(savedBody()).toEqual({ Id: 0, BranchName: "Gurgaon", ParentId: 1, Address: "", IsActive: true });
    await waitFor(() => expect(refetch).toHaveBeenCalled());
  });

  it("adds a top-level office and refuses a blank name", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Offices />);
    await user.click(screen.getByRole("button", { name: /new office/i }));
    expect(screen.getByLabelText(/^Parent office/)).toHaveValue("Top level");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Name is required")).toBeInTheDocument();
    expect(savedBody()).toBeUndefined();
    await user.type(screen.getByLabelText(/^Name/), "  East  ");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(savedBody()).toMatchObject({ Id: 0, BranchName: "East", ParentId: null }));
  });

  it("moving offers no descendants as parents", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Offices />);
    await user.click(screen.getByLabelText("Edit HO"));
    await user.click(screen.getByLabelText(/^Parent office/));
    const names = (await screen.findAllByRole("option")).map((o) => o.textContent);
    expect(names).toEqual(["Top level", "West HO"]);
  });

  it("indents parent options by depth and leaves out inactive offices", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Offices />);
    await user.click(screen.getByLabelText("Edit West HO"));
    await user.click(screen.getByLabelText(/^Parent office/));
    const names = (await screen.findAllByRole("option")).map((o) => o.textContent);
    expect(names).toEqual(["Top level", "HO", "— Delhi"]);
  });

  it("still shows an inactive current parent", async () => {
    branches.push({ Id: 7, BranchName: "Sector 18", ParentId: 3, IsActive: true, PeopleCount: 0 });
    const user = userEvent.setup();
    renderWithProviders(<Offices />);
    await user.click(screen.getByLabelText("Edit Sector 18"));
    expect(screen.getByLabelText(/^Parent office/)).toHaveValue("— Noida");
  });

  it("edits an office: moves it, renames it and deactivates it", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Offices />);
    await user.click(screen.getByLabelText("Edit Delhi"));
    expect(screen.getByLabelText(/^Name/)).toHaveValue("Delhi");
    await user.click(screen.getByLabelText(/^Parent office/));
    await user.click(await screen.findByRole("option", { name: "West HO" }));
    await user.type(screen.getByLabelText(/^Address/), "CP");
    await user.click(screen.getByText("Active"));
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(savedBody()).toEqual({ Id: 2, BranchName: "Delhi", ParentId: 4, Address: "CP", IsActive: false })
    );
  });

  it("shows the server's refusal", async () => {
    postMock.mockRejectedValueOnce({
      response: { status: 409, data: { success: false, message: "Another office already has this name" } },
    });
    const user = userEvent.setup();
    renderWithProviders(<Offices />);
    await user.click(screen.getByLabelText("Edit Noida"));
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Another office already has this name")).toBeInTheDocument();
    expect(refetch).not.toHaveBeenCalled();
    // The modal stays open so the admin can fix it.
    expect(screen.getByLabelText(/^Name/)).toHaveValue("Noida");
  });

  it("shows a success:false message too", async () => {
    postMock.mockResolvedValueOnce({ data: { success: false, message: "Move or deactivate the people in this office first" } });
    const user = userEvent.setup();
    renderWithProviders(<Offices />);
    await user.click(screen.getByLabelText("Edit HO"));
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Move or deactivate the people in this office first")).toBeInTheDocument();
  });

  it("cancel closes the modal without saving", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Offices />);
    await user.click(screen.getByLabelText("Edit HO"));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByLabelText(/^Name/)).toBeNull());
    expect(postMock).not.toHaveBeenCalled();
  });
});
