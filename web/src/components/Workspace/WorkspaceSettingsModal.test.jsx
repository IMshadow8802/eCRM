import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import WorkspaceSettingsModal from "./WorkspaceSettingsModal";
import useAuthStore from "../../stores/useAuthStore";
import { workspaceFixture } from "../../test/mocks/handlers";
import renderWithProviders from "../../test/renderWithProviders";

const renderModal = (workspace, props = {}) =>
  renderWithProviders(
    <WorkspaceSettingsModal workspace={workspace} onClose={() => {}} {...props} />,
    { router: false },
  );

const personalOwned = (over = {}) => ({
  Id: 10,
  Name: "My Tasks",
  Type: "personal",
  OwnerUserId: 1,
  MyRole: "owner",
  IsArchived: false,
  ...over,
});

describe("WorkspaceSettingsModal", () => {
  beforeEach(() => {
    workspaceFixture.reset();
    useAuthStore.setState({
      isAuthenticated: true,
      token: null,
      user: { Id: 1, IsAdmin: false },
      API_BASE_URL: "https://prdinfotech.in/CRM",
    });
  });

  describe("archive confirm", () => {
    it("archive asks for confirmation first, then archives", async () => {
      workspaceFixture.seed(personalOwned());
      const onChanged = vi.fn();
      renderModal(personalOwned(), { onChanged });
      const user = userEvent.setup();

      await user.click(await screen.findByTestId("workspace-settings-archive"));
      expect(await screen.findByText("Archive workspace?")).toBeInTheDocument();
      expect(
        screen.getByText(
          /It will be hidden, not deleted\. You can restore it any time from the Archived section\./,
        ),
      ).toBeInTheDocument();

      await user.click(screen.getByTestId("workspace-archive-confirm-confirm"));
      await waitFor(() => {
        expect(onChanged).toHaveBeenCalledWith(
          expect.objectContaining({ kind: "archive" }),
        );
      });
      expect(workspaceFixture.list[0].IsArchived).toBe(true);
    });

    it("cancelling the archive confirm does nothing", async () => {
      workspaceFixture.seed(personalOwned());
      const onChanged = vi.fn();
      renderModal(personalOwned(), { onChanged });
      const user = userEvent.setup();

      await user.click(await screen.findByTestId("workspace-settings-archive"));
      await user.click(
        await screen.findByTestId("workspace-archive-confirm-cancel"),
      );
      expect(onChanged).not.toHaveBeenCalled();
      expect(workspaceFixture.list[0].IsArchived).toBe(false);
    });
  });

  describe("share a personal workspace", () => {
    it("owner of a personal workspace can share it after picking people and confirming", async () => {
      workspaceFixture.seed(personalOwned());
      const onChanged = vi.fn();
      renderModal(personalOwned(), { onChanged });
      const user = userEvent.setup();

      const shareBtn = await screen.findByTestId("workspace-share-button");
      expect(shareBtn).toBeDisabled(); // nobody picked yet

      await user.click(screen.getByLabelText(/invite people/i));
      await user.click(await screen.findByText("Bob"));
      await user.click(screen.getByTestId("workspace-share-button"));

      // Both exposures spelled out verbatim
      expect(
        await screen.findByText(
          /Everything in this workspace — all tasks, comments and files — will become visible to the people you invite AND to company admins\. This cannot be undone\./,
        ),
      ).toBeInTheDocument();

      await user.click(screen.getByTestId("workspace-share-confirm-confirm"));
      await waitFor(() => {
        expect(onChanged).toHaveBeenCalledWith(
          expect.objectContaining({
            kind: "edit",
            workspace: expect.objectContaining({ Type: "shared" }),
          }),
        );
      });
      expect(workspaceFixture.list[0].Type).toBe("shared");
    });

    it("share section is hidden on shared workspaces and for non-owners", async () => {
      renderModal({
        Id: 20,
        Name: "Team Board",
        Type: "shared",
        OwnerUserId: 2,
        MyRole: "member",
        IsArchived: false,
      });
      await screen.findByTestId("workspace-settings-modal");
      expect(screen.queryByTestId("workspace-share-button")).toBeNull();
    });
  });

  describe("delete workspace", () => {
    it("shows a hint instead of delete while the workspace is not archived", async () => {
      renderModal(personalOwned());
      await screen.findByTestId("workspace-settings-modal");
      expect(
        screen.getByText(/Archive the workspace first to delete it\./),
      ).toBeInTheDocument();
      expect(screen.queryByTestId("workspace-delete-button")).toBeNull();
    });

    it("archived workspace: shows the blast radius and requires typing the name when tasks exist", async () => {
      const ws = personalOwned({ IsArchived: true });
      workspaceFixture.seed({ ...ws });
      const onChanged = vi.fn();
      renderModal(ws, { onChanged });
      const user = userEvent.setup();

      await user.click(await screen.findByTestId("workspace-delete-button"));
      expect(
        await screen.findByText(
          /This will permanently delete 14 tasks, 32 comments, 6 files\. This cannot be undone\./,
        ),
      ).toBeInTheDocument();

      const confirmBtn = screen.getByTestId("workspace-delete-confirm-confirm");
      expect(confirmBtn).toBeDisabled();

      await user.type(
        screen.getByTestId("workspace-delete-name"),
        "My Tasks",
      );
      expect(confirmBtn).not.toBeDisabled();

      await user.click(confirmBtn);
      await waitFor(() => {
        expect(onChanged).toHaveBeenCalledWith(
          expect.objectContaining({ kind: "delete" }),
        );
      });
      expect(workspaceFixture.list).toHaveLength(0);
    });

    it("skips the type-the-name gate when there are no tasks", async () => {
      workspaceFixture.deleteCounts = {
        taskCount: 0,
        commentCount: 0,
        attachmentCount: 0,
        memberCount: 1,
      };
      const ws = personalOwned({ IsArchived: true });
      workspaceFixture.seed({ ...ws });
      renderModal(ws);
      const user = userEvent.setup();

      await user.click(await screen.findByTestId("workspace-delete-button"));
      expect(
        await screen.findByText(/permanently delete 0 tasks/),
      ).toBeInTheDocument();
      expect(screen.queryByTestId("workspace-delete-name")).toBeNull();
      expect(
        screen.getByTestId("workspace-delete-confirm-confirm"),
      ).not.toBeDisabled();
    });
  });

  describe("leave workspace", () => {
    it("a non-owner member can leave after confirming", async () => {
      const ws = {
        Id: 30,
        Name: "Ops",
        Type: "shared",
        OwnerUserId: 2,
        MyRole: "member",
        IsArchived: false,
      };
      workspaceFixture.seed({ ...ws });
      const onChanged = vi.fn();
      renderModal(ws, { onChanged });
      const user = userEvent.setup();

      await user.click(await screen.findByTestId("workspace-leave-button"));
      expect(await screen.findByText("Leave workspace?")).toBeInTheDocument();
      await user.click(screen.getByTestId("workspace-leave-confirm-confirm"));

      await waitFor(() => {
        expect(onChanged).toHaveBeenCalledWith(
          expect.objectContaining({ kind: "leave" }),
        );
      });
      expect(workspaceFixture.list).toHaveLength(0);
    });

    it("the owner never sees a leave button", async () => {
      renderModal({
        Id: 31,
        Name: "Ops",
        Type: "shared",
        OwnerUserId: 1,
        MyRole: "owner",
        IsArchived: false,
      });
      await screen.findByTestId("workspace-settings-modal");
      expect(screen.queryByTestId("workspace-leave-button")).toBeNull();
    });
  });

  describe("transfer ownership", () => {
    it("owner picks a new owner and hands over; note says they stay as manager", async () => {
      const ws = {
        Id: 40,
        Name: "Ops",
        Type: "shared",
        OwnerUserId: 1,
        MyRole: "owner",
        IsArchived: false,
      };
      workspaceFixture.seed({ ...ws });
      const onChanged = vi.fn();
      renderModal(ws, { onChanged });
      const user = userEvent.setup();

      expect(
        await screen.findByText(/You will stay in the workspace as a manager\./),
      ).toBeInTheDocument();
      const transferBtn = screen.getByTestId("workspace-transfer-button");
      expect(transferBtn).toBeDisabled();

      await user.click(screen.getByLabelText(/new owner/i));
      await user.click(await screen.findByText("Bob"));
      await user.click(transferBtn);

      await waitFor(() => {
        expect(onChanged).toHaveBeenCalledWith(
          expect.objectContaining({
            kind: "edit",
            workspace: expect.objectContaining({
              OwnerUserId: 2,
              MyRole: "manager",
            }),
          }),
        );
      });
      expect(workspaceFixture.list[0].OwnerUserId).toBe(2);
    });

    it("plain members don't see the change-owner section", async () => {
      renderModal({
        Id: 41,
        Name: "Ops",
        Type: "shared",
        OwnerUserId: 2,
        MyRole: "member",
        IsArchived: false,
      });
      await screen.findByTestId("workspace-settings-modal");
      expect(screen.queryByTestId("workspace-transfer-button")).toBeNull();
    });
  });

  describe("members roster", () => {
    const sharedOwned = (over = {}) => ({
      Id: 60,
      Name: "Ops",
      Type: "shared",
      OwnerUserId: 1,
      MyRole: "owner",
      IsArchived: false,
      ...over,
    });
    const seedRoster = () => {
      workspaceFixture.members = [
        { UserId: 1, FullName: "Me", Username: "me", Role: "owner", InviteStatus: "active", IsActive: 1, IsOwner: 1 },
        { UserId: 2, FullName: "Bob", Username: "bob", Role: "member", InviteStatus: "active", IsActive: 1, IsOwner: 0 },
        { UserId: 3, FullName: "Aman", Username: "aman", Role: "member", InviteStatus: "pending", IsActive: 1, IsOwner: 0 },
        { UserId: 4, FullName: "Ayush", Username: "ayush", Role: "member", InviteStatus: "removed", IsActive: 0, IsOwner: 0 },
      ];
    };

    it("renders active, pending and removed members correctly", async () => {
      seedRoster();
      renderModal(sharedOwned());

      const ownerRow = await screen.findByTestId("member-row-1");
      expect(within(ownerRow).getByText("owner")).toBeInTheDocument();
      expect(
        within(screen.getByTestId("member-row-3")).getByText("Waiting for reply"),
      ).toBeInTheDocument();
      expect(screen.getByTestId("member-reinvite-4")).toBeInTheDocument();

      // Remove (X) on other active members, never on the owner or self.
      expect(screen.getByTestId("member-remove-2")).toBeInTheDocument();
      expect(screen.queryByTestId("member-remove-1")).toBeNull();
      expect(screen.queryByTestId("member-remove-3")).toBeNull();
    });

    it("Re-invite resets a removed member and shows the server's message", async () => {
      seedRoster();
      renderModal(sharedOwned());
      const user = userEvent.setup();

      await user.click(await screen.findByTestId("member-reinvite-4"));

      expect(await screen.findByText("Invite resent")).toBeInTheDocument();
      const row = workspaceFixture.members.find((m) => m.UserId === 4);
      expect(row.InviteStatus).toBe("pending");
    });

    it("invite picker adds a fresh member and shows the server's message", async () => {
      // Bob is not on the board yet — he's the only invitable company user.
      workspaceFixture.members = [
        { UserId: 1, FullName: "Me", Username: "me", Role: "owner", InviteStatus: "active", IsActive: 1, IsOwner: 1 },
      ];
      renderModal(sharedOwned());
      const user = userEvent.setup();

      await user.click(await screen.findByLabelText(/invite people/i));
      await user.click(await screen.findByText("Bob"));
      await user.click(screen.getByTestId("member-invite-button"));

      expect(await screen.findByText("Invite sent")).toBeInTheDocument();
      expect(
        workspaceFixture.members.find((m) => m.UserId === 2)?.InviteStatus,
      ).toBe("pending");
    });

    it("removing an active member marks them removed", async () => {
      seedRoster();
      renderModal(sharedOwned());
      const user = userEvent.setup();

      await user.click(await screen.findByTestId("member-remove-2"));

      await waitFor(() => {
        expect(
          workspaceFixture.members.find((m) => m.UserId === 2)?.InviteStatus,
        ).toBe("removed");
      });
    });

    it("plain members see the roster but no manage controls", async () => {
      seedRoster();
      renderModal(
        sharedOwned({ OwnerUserId: 2, MyRole: "member" }),
      );

      await screen.findByTestId("member-row-1");
      expect(screen.queryByTestId("member-remove-2")).toBeNull();
      expect(screen.queryByTestId("member-reinvite-4")).toBeNull();
      expect(screen.queryByTestId("member-invite-select")).toBeNull();
    });
  });

  describe("failures", () => {
    it("archive failure leaves the workspace alone", async () => {
      const { server } = await import("../../test/mocks/server");
      const { http, HttpResponse } = await import("msw");
      server.use(
        http.post("*/api/workspaces/archiveWorkspace", async () =>
          HttpResponse.json(
            { success: false, message: "nope", responseCode: 500 },
            { status: 500 },
          ),
        ),
      );
      workspaceFixture.seed(personalOwned());
      const onChanged = vi.fn();
      renderModal(personalOwned(), { onChanged });
      const user = userEvent.setup();

      await user.click(await screen.findByTestId("workspace-settings-archive"));
      await user.click(
        await screen.findByTestId("workspace-archive-confirm-confirm"),
      );
      await screen.findByText("nope");
      expect(onChanged).not.toHaveBeenCalled();
      expect(workspaceFixture.list[0].IsArchived).toBe(false);
    });

    it("share failure keeps the workspace personal", async () => {
      const { server } = await import("../../test/mocks/server");
      const { http, HttpResponse } = await import("msw");
      server.use(
        http.post("*/api/workspaces/convertWorkspaceToShared", async () =>
          HttpResponse.json(
            { success: false, message: "cannot share", responseCode: 400 },
            { status: 400 },
          ),
        ),
      );
      workspaceFixture.seed(personalOwned());
      const onChanged = vi.fn();
      renderModal(personalOwned(), { onChanged });
      const user = userEvent.setup();

      await user.click(await screen.findByLabelText(/invite people/i));
      await user.click(await screen.findByText("Bob"));
      await user.click(screen.getByTestId("workspace-share-button"));
      await user.click(
        await screen.findByTestId("workspace-share-confirm-confirm"),
      );
      await screen.findByText("cannot share");
      expect(onChanged).not.toHaveBeenCalled();
      expect(workspaceFixture.list[0].Type).toBe("personal");
    });

    it("delete failure keeps the workspace", async () => {
      const { server } = await import("../../test/mocks/server");
      const { http, HttpResponse } = await import("msw");
      const ws = personalOwned({ IsArchived: true });
      workspaceFixture.seed({ ...ws });
      workspaceFixture.deleteCounts = {
        taskCount: 0,
        commentCount: 0,
        attachmentCount: 0,
        memberCount: 1,
      };
      const onChanged = vi.fn();
      renderModal(ws, { onChanged });
      const user = userEvent.setup();

      await user.click(await screen.findByTestId("workspace-delete-button"));
      await screen.findByTestId("workspace-delete-confirm-confirm");
      // Fail only the real delete, after the dry run succeeded.
      server.use(
        http.post("*/api/workspaces/deleteWorkspace", async () =>
          HttpResponse.json(
            { success: false, message: "delete blocked", responseCode: 400 },
            { status: 400 },
          ),
        ),
      );
      await user.click(screen.getByTestId("workspace-delete-confirm-confirm"));
      await screen.findByText("delete blocked");
      expect(onChanged).not.toHaveBeenCalled();
      expect(workspaceFixture.list).toHaveLength(1);
    });
  });

  it("reads PascalCase blast-radius counts from the contract shape", async () => {
    workspaceFixture.deleteCounts = {
      TaskCount: 3,
      CommentCount: 2,
      AttachmentCount: 1,
      MemberCount: 1,
    };
    const ws = personalOwned({ IsArchived: true });
    workspaceFixture.seed({ ...ws });
    renderModal(ws);
    const user = userEvent.setup();

    await user.click(await screen.findByTestId("workspace-delete-button"));
    expect(
      await screen.findByText(
        /This will permanently delete 3 tasks, 2 comments, 1 files\./,
      ),
    ).toBeInTheDocument();
  });

  describe("sync members from team", () => {
    it("a manager on a project workspace can sync too", async () => {
      renderModal({
        Id: 52,
        Name: "Phoenix",
        Type: "project",
        OwnerUserId: 2,
        MyRole: "manager",
        ProjectId: 7,
        IsArchived: false,
      });
      expect(
        await screen.findByTestId("workspace-sync-button"),
      ).toBeInTheDocument();
    });

    it("project owner syncs and sees added/removed counts in a toast", async () => {
      const ws = {
        Id: 50,
        Name: "Phoenix",
        Type: "project",
        OwnerUserId: 1,
        MyRole: "owner",
        ProjectId: 7,
        IsArchived: false,
      };
      workspaceFixture.seed({ ...ws });
      renderModal(ws);
      const user = userEvent.setup();

      await user.click(await screen.findByTestId("workspace-sync-button"));
      expect(await screen.findByText("2 added, 1 removed")).toBeInTheDocument();
    });

    it("sync is not offered on shared workspaces", async () => {
      renderModal({
        Id: 51,
        Name: "Ops",
        Type: "shared",
        OwnerUserId: 1,
        MyRole: "owner",
        IsArchived: false,
      });
      await screen.findByTestId("workspace-settings-modal");
      expect(screen.queryByTestId("workspace-sync-button")).toBeNull();
    });
  });
});
