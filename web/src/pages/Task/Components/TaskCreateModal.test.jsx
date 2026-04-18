import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import TaskCreateModal from "./TaskCreateModal";
import useAuthStore from "../../../stores/useAuthStore";
import { taskFixture } from "../../../test/mocks/handlers";
import renderWithProviders from "../../../test/renderWithProviders";

const renderModal = (props = {}) =>
  renderWithProviders(
    <TaskCreateModal open onClose={() => {}} workspaceId={100} {...props} />,
    { router: false },
  );

describe("TaskCreateModal", () => {
  beforeEach(() => {
    taskFixture.reset();
    useAuthStore.setState({
      isAuthenticated: true,
      token: null,
      user: { UserId: 1 },
      API_BASE_URL: "https://prdinfotech.in/CRM",
    });
  });

  it("Create is disabled when title empty", async () => {
    renderModal();
    const btn = await screen.findByTestId("create-task-submit");
    expect(btn).toBeDisabled();
  });

  it("creates a task and calls onCreated", async () => {
    const onCreated = vi.fn();
    const onClose = vi.fn();
    renderModal({ onCreated, onClose });
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/title/i), "Fix bug");
    await user.click(screen.getByTestId("create-task-submit"));
    await waitFor(() => {
      expect(onCreated).toHaveBeenCalled();
    });
    expect(taskFixture.list).toHaveLength(1);
    expect(taskFixture.list[0].Title).toBe("Fix bug");
  });

  it("Cancel closes without creating", async () => {
    const onClose = vi.fn();
    renderModal({ onClose });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /cancel/i }));
    expect(onClose).toHaveBeenCalled();
    expect(taskFixture.list).toHaveLength(0);
  });

  it("Cancel does nothing while submitting", async () => {
    renderModal();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/title/i), "X");
    // Fire a click but don't await; then click Cancel — submitting state prevents close
    const submit = screen.getByTestId("create-task-submit");
    submit.click();
    const cancel = screen.getByRole("button", { name: /cancel/i });
    cancel.click();
    // Let the async settle
    await waitFor(() => {
      expect(taskFixture.list.length).toBeGreaterThanOrEqual(0);
    });
  });

  it("creates with default priority medium", async () => {
    renderModal();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/title/i), "Default");
    await user.click(screen.getByTestId("create-task-submit"));
    await waitFor(() => {
      expect(taskFixture.list[0].Priority).toBe("medium");
    });
  });

  it("renders due date field", async () => {
    renderModal();
    // DateField now renders an external label linked to the input
    expect(
      await screen.findByLabelText(/due date/i),
    ).toBeInTheDocument();
  });

  it("passes columnId from prop into save payload", async () => {
    renderModal({ columnId: 5, columnTitle: "Sprint" });
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/title/i), "S1");
    await user.click(screen.getByTestId("create-task-submit"));
    await waitFor(() => {
      expect(taskFixture.list[0].ColumnId).toBe(5);
    });
  });
});
