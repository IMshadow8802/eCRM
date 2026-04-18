import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import CreateWorkspaceModal from "./CreateWorkspaceModal";
import useAuthStore from "../../stores/useAuthStore";
import { workspaceFixture } from "../../test/mocks/handlers";
import renderWithProviders from "../../test/renderWithProviders";

const renderModal = (props = {}) =>
  renderWithProviders(
    <CreateWorkspaceModal open onClose={() => {}} {...props} />,
    { router: false },
  );

describe("CreateWorkspaceModal", () => {
  beforeEach(() => {
    workspaceFixture.reset();
    useAuthStore.setState({
      isAuthenticated: true,
      token: null,
      user: { UserId: 1 },
      API_BASE_URL: "https://prdinfotech.in/CRM",
    });
  });

  it("renders the default Shared type with Basic template", async () => {
    renderModal();
    const sharedBtn = await screen.findByRole("radio", { name: /Shared/i });
    expect(sharedBtn).toHaveAttribute("aria-checked", "true");
  });

  it("warns when submitting empty name", async () => {
    renderModal();
    const user = userEvent.setup();
    await user.click(await screen.findByTestId("workspace-create-submit"));
    // No workspace was created
    expect(workspaceFixture.list).toHaveLength(0);
  });

  it("disables Personal option when hasPersonal=true", async () => {
    renderModal({ hasPersonal: true });
    const personalBtn = await screen.findByRole("radio", { name: /Personal/i });
    expect(personalBtn).toBeDisabled();
  });

  it("creates workspace + applies template + calls onCreated", async () => {
    const onCreated = vi.fn();
    const onClose = vi.fn();
    renderModal({ onCreated, onClose });

    const user = userEvent.setup();
    await user.type(
      await screen.findByLabelText(/workspace name/i),
      "Marketing",
    );
    await user.click(await screen.findByTestId("workspace-create-submit"));

    await waitFor(() => {
      expect(onCreated).toHaveBeenCalledWith(
        expect.objectContaining({ Name: "Marketing", Type: "shared", MyRole: "owner" }),
      );
      expect(onClose).toHaveBeenCalled();
    });

    expect(workspaceFixture.list).toHaveLength(1);
    expect(workspaceFixture.list[0].Name).toBe("Marketing");
  });

  it("switches to Personal when hasPersonal is false", async () => {
    renderModal({ hasPersonal: false });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("radio", { name: /Personal/i }));
    const personalBtn = screen.getByRole("radio", { name: /Personal/i });
    expect(personalBtn).toHaveAttribute("aria-checked", "true");
  });

  it("does not create or apply template when name is whitespace only", async () => {
    renderModal();
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText(/workspace name/i), "   ");
    await user.click(await screen.findByTestId("workspace-create-submit"));
    await new Promise((r) => setTimeout(r, 50));
    expect(workspaceFixture.list).toHaveLength(0);
  });

  it("shows warning when template seeding fails (workspace still created)", async () => {
    const { server } = await import("../../test/mocks/server");
    const { http, HttpResponse } = await import("msw");
    server.use(
      http.post("*/api/workspaces/applyKanbanTemplate", async () =>
        HttpResponse.json(
          { success: false, message: "seed failed", responseCode: 500 },
          { status: 500 },
        ),
      ),
    );

    const onCreated = vi.fn();
    renderModal({ onCreated });
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText(/workspace name/i), "Ops");
    await user.click(await screen.findByTestId("workspace-create-submit"));

    await waitFor(() => {
      expect(onCreated).toHaveBeenCalled();
    });
    // Workspace still created even though template seeding failed
    expect(workspaceFixture.list).toHaveLength(1);
  });

  it("does not call onCreated when save fails", async () => {
    const { server } = await import("../../test/mocks/server");
    const { http, HttpResponse } = await import("msw");
    server.use(
      http.post("*/api/workspaces/saveWorkspace", async () =>
        HttpResponse.json(
          { success: false, message: "save failed", responseCode: 500 },
          { status: 500 },
        ),
      ),
    );

    const onCreated = vi.fn();
    renderModal({ onCreated });
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText(/workspace name/i), "Fail");
    await user.click(await screen.findByTestId("workspace-create-submit"));

    await new Promise((r) => setTimeout(r, 100));
    expect(onCreated).not.toHaveBeenCalled();
  });

  it("Cancel closes without creating", async () => {
    const onClose = vi.fn();
    renderModal({ onClose });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /cancel/i }));
    expect(onClose).toHaveBeenCalled();
    expect(workspaceFixture.list).toHaveLength(0);
  });
});
