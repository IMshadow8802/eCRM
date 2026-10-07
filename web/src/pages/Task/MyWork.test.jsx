import { describe, it, expect, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";

import MyWork from "./MyWork";
import useWorkspaceStore from "../../stores/useWorkspaceStore";
import useAuthStore from "../../stores/useAuthStore";
import { taskFixture, workspaceFixture } from "../../test/mocks/handlers";
import { server } from "../../test/mocks/server";
import renderWithProviders from "../../test/renderWithProviders";

const iso = (days) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const mine = JSON.stringify([{ UserId: 7, FullName: "Me" }]);
const seed = (o) =>
  taskFixture.seed({ WorkspaceId: 2, WorkspaceName: "Ops", ColumnId: 1, Priority: "medium", CreatedByUserId: 9, AssigneesJson: mine, ...o });

describe("MyWork", () => {
  beforeEach(() => {
    taskFixture.reset();
    workspaceFixture.reset();
    workspaceFixture.seed({ Id: 2, Name: "Ops", Type: "shared", MyRole: "member" });
    useWorkspaceStore.getState().setActiveWorkspace({ Id: 1, Type: "personal", MyRole: "owner" });
    useAuthStore.setState({ isAuthenticated: true, token: null, user: { UserId: 7 }, UserId: 7, API_BASE_URL: "https://x/CRM" });
  });

  it("asks the server for my open tasks across boards", async () => {
    let body;
    server.use(
      http.post("*/api/tasks/fetchTasks", async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ success: true, message: "ok", responseCode: 200, data: { tasks: [] } });
      }),
    );
    renderWithProviders(<MyWork />);
    await waitFor(() => expect(body).toBeDefined());
    expect(body).toMatchObject({ AssigneeUserId: 7, OnlyOpen: true, WorkspaceId: null });
  });

  it("renders overdue before a later-due task, only mine and open", async () => {
    seed({ Id: 11, Title: "Later one", DueDate: iso(5) });
    seed({ Id: 12, Title: "Overdue one", DueDate: iso(-3) });
    seed({ Id: 13, Title: "Not mine", DueDate: iso(-9), AssigneesJson: JSON.stringify([{ UserId: 8 }]) });
    seed({ Id: 14, Title: "Finished", DueDate: iso(-9), IsCompleted: 1 });
    renderWithProviders(<MyWork />);
    await screen.findByText("Overdue one");
    const text = screen.getAllByTestId("my-work-item").map((n) => n.textContent);
    expect(text).toHaveLength(2);
    expect(text[0]).toContain("Overdue one");
    expect(text[1]).toContain("Later one");
    expect(screen.getByText("2 open · 1 overdue")).toBeInTheDocument();
  });

  it("opening a card shows the detail and switches to the task's workspace", async () => {
    seed({ Id: 11, Title: "Open me", DueDate: iso(1) });
    renderWithProviders(<MyWork />);
    await userEvent.setup().click(await screen.findByText("Open me"));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    await waitFor(() => expect(useWorkspaceStore.getState().activeWorkspaceId).toBe(2));
  });

  it("empty list shows the empty state", async () => {
    renderWithProviders(<MyWork />);
    expect(await screen.findByText("Nothing assigned to you")).toBeInTheDocument();
  });

  it("a failed fetch shows an error state, not the empty state", async () => {
    server.use(
      http.post("*/api/tasks/fetchTasks", async () =>
        HttpResponse.json({ success: false, message: "boom", responseCode: 500 }, { status: 500 })),
    );
    renderWithProviders(<MyWork />);
    expect(await screen.findByText("Couldn't load your tasks", {}, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.queryByText("Nothing assigned to you")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });
});
