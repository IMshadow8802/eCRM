// The detail screen's read side and its checklist. Menu actions, comments and
// time are in TaskDetailScreen.actions.test.tsx.
import { fireEvent, screen, waitFor } from "@testing-library/react-native";

import { fetchAttachments } from "../../api/attachmentQueries";
import { fetchLookups } from "../../api/configQueries";
import { fetchKanbanColumns } from "../../api/kanbanQueries";
import { fetchTaskTat, saveTatReason } from "../../api/tatQueries";
import {
  deleteTaskChecklist,
  fetchTaskById,
  fetchTaskDependencies,
  fetchTasks,
  getTaskActivity,
  getTaskChecklist,
  getTaskComments,
  getTaskTimeEntries,
  saveTaskChecklist,
} from "../../api/taskQueries";
import { fetchWorkspaces } from "../../api/workspaceQueries";
import type { Lookup, Task, TaskChecklistItem, TaskTatClock, Workspace } from "../../types/api";
import { assigneesJson, envelope, localDay, makeTask, makeWorkspace, pagination, serverError } from "../../test/fixtures";
import { makeNavigation, makeRoute, renderWithProviders, seedAuth } from "../../test/renderWithProviders";
import { spySheets } from "../../test/sheets";
import { chipTones } from "../../theme";
import { shortDay } from "./taskHelpers";
import TaskDetailScreen from "./TaskDetailScreen";

jest.mock("../../api/taskQueries");
jest.mock("../../api/attachmentQueries");
jest.mock("../../api/kanbanQueries");
jest.mock("../../api/workspaceQueries");
jest.mock("../../api/tatQueries");
jest.mock("../../api/configQueries", () => ({
  ...jest.requireActual("../../api/configQueries"),
  fetchLookups: jest.fn(),
}));

const ME = 42;

const item = (Id: number, ItemText: string, IsCompleted = false): TaskChecklistItem => ({
  Id,
  TaskId: 1,
  ItemText,
  IsCompleted,
  SortOrder: Id,
});

const breachedClock: TaskTatClock = {
  Id: 500,
  UserId: ME,
  FullName: "Asha Rao",
  AssignedAt: "2026-10-08 09:00:00",
  FirstSeenAt: null,
  AcknowledgedAt: "2026-10-08 09:10:00",
  DueAt: "2026-10-08 17:00:00",
  ClosedAt: "2026-10-09 10:00:00",
  CloseReason: "completed",
  BreachedAt: "2026-10-08 17:00:00",
  BreachReasonId: null,
  BreachReason: null,
  BreachRemarks: null,
  ReasonAt: null,
  Verdict: null,
  VerdictByName: null,
  VerdictRemarks: null,
  VerdictAt: null,
  CanJudge: false,
};
const reasonLookup: Lookup = { Id: 2, CompId: 1, Kind: "task_breach_reason", Value: "Parts late", SortOrder: 1, IsActive: true, Code: null };

const TASK = makeTask({
  Id: 1,
  Title: "Fit the inverter",
  WorkspaceId: 10,
  WorkspaceName: "Ops board",
  ColumnTitle: "To do",
  CreatedByUserId: ME,
  AssigneesJson: assigneesJson([ME, "Asha Rao"]),
});

function serve({ task = TASK, ws = makeWorkspace({ Id: 10 }), items = [item(1, "Order parts", true), item(2, "Fit it")] }: {
  task?: Task | null;
  ws?: Workspace;
  items?: TaskChecklistItem[];
} = {}) {
  jest.mocked(fetchTaskById).mockResolvedValue(task);
  jest.mocked(fetchWorkspaces).mockResolvedValue([ws]);
  jest.mocked(getTaskChecklist).mockResolvedValue(items);
  jest.mocked(getTaskComments).mockResolvedValue([]);
  jest.mocked(fetchAttachments).mockResolvedValue([]);
  jest.mocked(fetchKanbanColumns).mockResolvedValue([]);
  jest.mocked(fetchTasks).mockResolvedValue(envelope({ tasks: [], pagination: pagination(0) }));
  jest.mocked(fetchTaskDependencies).mockResolvedValue({ blockers: [], dependents: [] });
  jest.mocked(getTaskTimeEntries).mockResolvedValue([]);
  jest.mocked(getTaskActivity).mockResolvedValue([]);
  jest.mocked(fetchTaskTat).mockResolvedValue({ clocks: [], holds: [], events: [] });
  jest.mocked(fetchLookups).mockResolvedValue([]);
  jest.mocked(saveTaskChecklist).mockResolvedValue(envelope(null));
  jest.mocked(deleteTaskChecklist).mockResolvedValue(envelope(null));
  jest.mocked(saveTatReason).mockResolvedValue(envelope(null));
}

const mount = async (extra: { tab?: "tat"; explainTatId?: number } = {}) => {
  const navigation = makeNavigation<"TaskDetail">();
  await renderWithProviders(
    <TaskDetailScreen navigation={navigation} route={makeRoute("TaskDetail", { taskId: 1, workspaceId: 10, ...extra })} />,
  );
  return navigation;
};

/** Loaded, with the board role known (abilities depend on it). */
const loaded = async () => {
  await screen.findByText("Fit the inverter");
  await waitFor(() => expect(fetchWorkspaces).toHaveBeenCalled());
  await screen.findByText("Order parts");
};

beforeEach(() => {
  seedAuth({ UserId: ME });
  serve();
});

describe("loading", () => {
  it("a failed load keeps a back button and offers a retry", async () => {
    jest.mocked(fetchTaskById).mockRejectedValueOnce(new Error("boom"));
    const navigation = await mount();
    expect(await screen.findByText(/could not be loaded/)).toBeOnTheScreen();
    await fireEvent.press(screen.getByLabelText("Go back"));
    expect(navigation.goBack).toHaveBeenCalled();
    await fireEvent.press(screen.getByText("Try again"));
    expect(await screen.findByText("Fit the inverter")).toBeOnTheScreen();
  });

  it("a task that is gone or hidden says so, without a retry", async () => {
    serve({ task: null });
    await mount();
    expect(await screen.findByText("Task not available")).toBeOnTheScreen();
    expect(screen.queryByText("Try again")).toBeNull();
  });

  // TAT-06: My Work's "Needs you" rows land on the deadline, not the checklist.
  it("opens on the Deadline tab when asked to", async () => {
    await mount({ tab: "tat" });
    expect(await screen.findByText("No deadline on this task")).toBeOnTheScreen();
    expect(screen.queryByText("Order parts")).toBeNull();
  });

  it("asked to explain a clock, opens the reason sheet on that clock", async () => {
    jest.mocked(fetchTaskTat).mockResolvedValue({ clocks: [breachedClock], holds: [], events: [] });
    jest.mocked(fetchLookups).mockResolvedValue([reasonLookup]);
    const { present } = spySheets();
    await mount({ tab: "tat", explainTatId: 500 });
    expect(await screen.findByText("Why was the deadline missed?")).toBeOnTheScreen();
    await waitFor(() => expect(present).toHaveBeenCalledTimes(1));
    await fireEvent.press(await screen.findByText("Parts late"));
    await fireEvent.press(screen.getByText("Save reason"));
    await waitFor(() => expect(saveTatReason).toHaveBeenCalled());
    expect(jest.mocked(saveTatReason).mock.calls[0]![0]).toEqual({ TaskId: 1, TatId: 500, ReasonId: 2, Remarks: null });
  });
});

describe("summary", () => {
  it("shows the board, column, title and facts", async () => {
    serve({
      task: {
        ...TASK,
        Description: "Sector 4",
        Priority: "high",
        DueDate: localDay(-1),
        LoggedHours: 5,
        EstimatedHours: 4,
        BlockerCount: 2,
      },
    });
    await mount();
    await loaded();
    // 08: the band leads with "Workspace · Column", the title, then the chip row.
    expect(screen.getByText("Ops board · To do")).toBeOnTheScreen();
    expect(screen.getByRole("header", { name: "Fit the inverter" })).toBeOnTheScreen();
    expect(screen.getByText("high")).toHaveStyle({ color: chipTones.red.text });
    // A past due date is a red date chip in the band.
    expect(screen.getByText(shortDay(localDay(-1)))).toHaveStyle({ color: chipTones.red.text });
    expect(screen.getByText("AR")).toBeOnTheScreen();
    // Details: the description and the facts.
    await fireEvent.press(screen.getByRole("tab", { name: "Details" }));
    expect(screen.getByText("Sector 4")).toBeOnTheScreen();
    expect(screen.getByText("5h of 4h")).toBeOnTheScreen();
    expect(screen.getByText("2 tasks")).toBeOnTheScreen();
  });

  // E §1.4: urgent has no tone of its own; it wears high's red, with its own label.
  it("urgent wears the red tone, labelled urgent", async () => {
    serve({ task: { ...TASK, Priority: "urgent" } });
    await mount();
    await loaded();
    expect(screen.getByText("urgent")).toHaveStyle({ color: chipTones.red.text });
  });

  it("a lone blocker, logged time with no estimate, and nobody on it", async () => {
    serve({ task: { ...TASK, AssigneesJson: null, BlockerCount: 1, LoggedHours: 2, DueDate: localDay(3) } });
    await mount();
    await loaded();
    expect(screen.getByText("Unassigned")).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("tab", { name: "Details" }));
    expect(screen.getByText("1 task")).toBeOnTheScreen();
    expect(screen.getByText("2h")).toBeOnTheScreen();
  });

  // TASK-07: the web's header shows Done (with the date) and Blocked.
  it("a finished task shows Done with its IST date; a blocked one says Blocked", async () => {
    serve({ task: { ...TASK, IsCompleted: true, CompletedDate: "2026-11-02T19:00:00.000Z", IsBlocked: true } });
    await mount();
    await loaded();
    expect(screen.getByText("Done 03 Nov 2026")).toBeOnTheScreen();
    expect(screen.getByText("Blocked")).toBeOnTheScreen();
  });

  it("Done without a date, and no Blocked on an unblocked task", async () => {
    serve({ task: { ...TASK, IsCompleted: true, CompletedDate: null } });
    await mount();
    await loaded();
    expect(screen.getByText("Done")).toBeOnTheScreen();
    expect(screen.queryByText("Blocked")).toBeNull();
  });

  it("falls back to 'Task' with no board name", async () => {
    serve({ task: { ...TASK, WorkspaceName: null, ColumnTitle: null } });
    await mount();
    await loaded();
    expect(screen.getByText("Task")).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("tab", { name: "Details" }));
    // No facts to give: dashes, and an empty blocker reads Nothing.
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
    expect(screen.getByText("Nothing")).toBeOnTheScreen();
  });
});

describe("checklist", () => {
  it("shows completion derived from the checklist", async () => {
    await mount();
    await loaded();
    expect(screen.getByText("1 of 2")).toBeOnTheScreen();
    expect(screen.getByText("50%")).toBeOnTheScreen();
    expect(getTaskChecklist).toHaveBeenCalledWith({ TaskId: 1 });
  });

  it("ticking a step flips it on the server", async () => {
    await mount();
    await loaded();
    await fireEvent.press(screen.getByRole("checkbox", { name: "Fit it" }));
    await waitFor(() => expect(saveTaskChecklist).toHaveBeenCalled());
    expect(jest.mocked(saveTaskChecklist).mock.calls[0]![0]).toEqual({
      Id: 2,
      TaskId: 1,
      ItemText: "Fit it",
      IsCompleted: true,
      SortOrder: 2,
      WorkspaceId: 10,
    });
  });

  // TASK-03: the reply says the task just finished, and — when the caller ran
  // over — which of their clocks owes a reason. Both used to be dropped.
  it("finishing the task says so, and asks at once why the deadline was missed", async () => {
    jest.mocked(saveTaskChecklist).mockResolvedValue(
      envelope({ checklistId: 2, completionChange: "completed", tatReasonNeeded: 500 }),
    );
    jest.mocked(fetchTaskTat).mockResolvedValue({ clocks: [breachedClock], holds: [], events: [] });
    jest.mocked(fetchLookups).mockResolvedValue([reasonLookup]);
    await mount();
    await loaded();
    const { present } = spySheets();
    await fireEvent.press(screen.getByRole("checkbox", { name: "Fit it" }));
    expect(await screen.findByText("Task completed — the creator has been told")).toBeOnTheScreen();
    // Switched to Deadline with the reason sheet up.
    expect(await screen.findByText("Why was the deadline missed?")).toBeOnTheScreen();
    expect(screen.getByText("Explain delay")).toBeOnTheScreen();
    await waitFor(() => expect(present).toHaveBeenCalledTimes(1));

    // The reason is saved against the clock the server named.
    await fireEvent.press(await screen.findByText("Parts late"));
    await fireEvent.press(screen.getByText("Save reason"));
    await waitFor(() => expect(saveTatReason).toHaveBeenCalled());
    expect(jest.mocked(saveTatReason).mock.calls[0]![0]).toEqual({ TaskId: 1, TatId: 500, ReasonId: 2, Remarks: null });

    // Coming back to the tab later does not pop the sheet again.
    await fireEvent.press(screen.getByText("Checklist"));
    await fireEvent.press(screen.getByText("Deadline"));
    await screen.findByText("Explain delay");
    expect(present).toHaveBeenCalledTimes(1);
  });

  it("finishing on time only toasts and stays on the checklist", async () => {
    jest.mocked(saveTaskChecklist).mockResolvedValueOnce(
      envelope({ checklistId: 2, completionChange: "completed", tatReasonNeeded: null }),
    );
    await mount();
    await loaded();
    await fireEvent.press(screen.getByRole("checkbox", { name: "Fit it" }));
    expect(await screen.findByText("Task completed — the creator has been told")).toBeOnTheScreen();
    expect(screen.getByText("1 of 2")).toBeOnTheScreen();
    expect(fetchTaskTat).not.toHaveBeenCalled();
  });

  it("unticking sends IsCompleted false; a step with no order sends 0", async () => {
    serve({ items: [{ ...item(1, "Order parts", true), SortOrder: null }] });
    await mount();
    await loaded();
    await fireEvent.press(screen.getByRole("checkbox", { name: "Order parts" }));
    await waitFor(() => expect(saveTaskChecklist).toHaveBeenCalled());
    expect(jest.mocked(saveTaskChecklist).mock.calls[0]![0]).toMatchObject({ IsCompleted: false, SortOrder: 0 });
  });

  it("a refused tick is explained in a toast", async () => {
    jest.mocked(saveTaskChecklist).mockRejectedValue(serverError(400, "Finish the blocking task first"));
    await mount();
    await loaded();
    await fireEvent.press(screen.getByRole("checkbox", { name: "Fit it" }));
    expect(await screen.findByText("Finish the blocking task first")).toBeOnTheScreen();
  });

  it("removing a step deletes it on the server", async () => {
    await mount();
    await loaded();
    await fireEvent(screen.getByRole("checkbox", { name: "Fit it" }), "longPress");
    await fireEvent.press(screen.getByText("Remove step"));
    await waitFor(() => expect(deleteTaskChecklist).toHaveBeenCalled());
    expect(jest.mocked(deleteTaskChecklist).mock.calls[0]![0]).toEqual({ Id: 2, TaskId: 1, WorkspaceId: 10 });
  });

  it("a refused removal is explained in a toast", async () => {
    jest.mocked(deleteTaskChecklist).mockRejectedValue(serverError(400, "A task needs at least one step"));
    await mount();
    await loaded();
    await fireEvent(screen.getByRole("checkbox", { name: "Fit it" }), "longPress");
    await fireEvent.press(screen.getByText("Remove step"));
    expect(await screen.findByText("A task needs at least one step")).toBeOnTheScreen();
  });

  it("a step moves down or up by swapping places with its neighbour", async () => {
    await mount();
    await loaded();
    await fireEvent(screen.getByRole("checkbox", { name: "Order parts" }), "longPress");
    // The first step cannot go up.
    expect(screen.queryByText("Move up")).toBeNull();
    await fireEvent.press(screen.getByText("Move down"));
    await waitFor(() => expect(saveTaskChecklist).toHaveBeenCalledTimes(2));
    expect(jest.mocked(saveTaskChecklist).mock.calls.map((c) => c[0])).toEqual([
      { Id: 1, TaskId: 1, ItemText: "Order parts", IsCompleted: true, SortOrder: 1, WorkspaceId: 10 },
      { Id: 2, TaskId: 1, ItemText: "Fit it", IsCompleted: false, SortOrder: 0, WorkspaceId: 10 },
    ]);
    await fireEvent(screen.getByRole("checkbox", { name: "Fit it" }), "longPress");
    expect(screen.queryByText("Move down")).toBeNull();
    await fireEvent.press(screen.getByText("Move up"));
    await waitFor(() => expect(saveTaskChecklist).toHaveBeenCalledTimes(4));
  });

  it("a refused move says why; the last step cannot be removed", async () => {
    serve({ items: [item(1, "Only step")] });
    jest.mocked(saveTaskChecklist).mockRejectedValue(serverError(400, "Nope"));
    await mount();
    await screen.findByText("Only step");
    await fireEvent(screen.getByRole("checkbox", { name: "Only step" }), "longPress");
    expect(screen.queryByText("Remove step")).toBeNull();
    expect(screen.queryByText("Move up")).toBeNull();
  });

  it("the FAB adds a step at the end of the list", async () => {
    await mount();
    await loaded();
    const { present, dismiss } = spySheets();
    await fireEvent.press(screen.getByRole("button", { name: "Add a step" }));
    expect(present).toHaveBeenCalledTimes(1);
    await fireEvent.changeText(screen.getByPlaceholderText("What needs doing?"), " Test run ");
    await fireEvent.press(screen.getByText("Add item"));
    await waitFor(() => expect(saveTaskChecklist).toHaveBeenCalled());
    // Success closes the sheet.
    await waitFor(() => expect(dismiss).toHaveBeenCalledTimes(1));
    expect(jest.mocked(saveTaskChecklist).mock.calls[0]![0]).toEqual({
      TaskId: 1,
      ItemText: "Test run",
      SortOrder: 2,
      WorkspaceId: 10,
    });
  });

  it("a refused add keeps the sheet's text and shows why", async () => {
    jest.mocked(saveTaskChecklist).mockRejectedValue(serverError(403, "You cannot edit this task"));
    await mount();
    await loaded();
    const { dismiss } = spySheets();
    await fireEvent.press(screen.getByRole("button", { name: "Add a step" }));
    await fireEvent.changeText(screen.getByPlaceholderText("What needs doing?"), "Test run");
    await fireEvent.press(screen.getByText("Add item"));
    expect(await screen.findByText("You cannot edit this task")).toBeOnTheScreen();
    expect(screen.getByDisplayValue("Test run")).toBeOnTheScreen();
    // A refusal leaves the sheet open (the mock keeps it mounted either way).
    expect(dismiss).not.toHaveBeenCalled();
  });
});

describe("who may do what", () => {
  it("a viewer not on the task reads it: no actions, no ticking, a view-only note", async () => {
    serve({
      task: { ...TASK, CreatedByUserId: 1, AssigneesJson: assigneesJson([7, "Ravi Kumar"]) },
      ws: makeWorkspace({ Id: 10, MyRole: "viewer" }),
    });
    await mount();
    await loaded();
    expect(screen.getByText(/View only/)).toBeOnTheScreen();
    // TASK-08: the menu is always there, for the time log; nothing else on it.
    expect(screen.getByLabelText("Task actions")).toBeOnTheScreen();
    expect(screen.getByText("Time logged")).toBeOnTheScreen();
    for (const label of ["Log time", "Edit task", "Delete task", "Take this task"]) {
      expect(screen.queryByText(label)).toBeNull();
    }
    expect(screen.getByRole("checkbox", { name: "Fit it" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Add a step" })).toBeNull();
    expect(screen.queryByLabelText("Edit task")).toBeNull();
  });

  it("a personal board is private even from an admin", async () => {
    seedAuth({ UserId: ME, access: { isAdmin: true } });
    serve({
      task: { ...TASK, CreatedByUserId: 1, AssigneesJson: assigneesJson([1, "Owner"]) },
      ws: makeWorkspace({ Id: 10, Type: "personal", MyRole: null }),
    });
    // A column to move to, so a wrongly-granted "Move to column" would show.
    jest.mocked(fetchKanbanColumns).mockResolvedValue([
      { Id: 101, WorkspaceId: 10, Title: "Doing", Color: null, SortOrder: 1, MaxTasks: null, IsActive: true, CompId: 1, BranchId: 1, CreatedDate: null, IsCompanyWide: false },
    ]);
    await mount();
    await loaded();
    await screen.findByText("Doing");
    expect(screen.getByText(/View only/)).toBeOnTheScreen();
    for (const label of ["Log time", "Edit task", "Delete task", "Take this task"]) {
      expect(screen.queryByText(label)).toBeNull();
    }
    // "Move to column" also titles the (always-mounted) move sheet; only that one may show.
    expect(screen.getAllByText("Move to column")).toHaveLength(1);
  });

  it("an admin works any task on a shared board", async () => {
    seedAuth({ UserId: ME, access: { isAdmin: true } });
    serve({
      task: { ...TASK, CreatedByUserId: 1, AssigneesJson: assigneesJson([1, "Owner"]) },
      ws: makeWorkspace({ Id: 10, Type: "shared", MyRole: null }),
    });
    await mount();
    await loaded();
    expect(screen.queryByText(/View only/)).toBeNull();
    expect(screen.getByLabelText("Task actions")).toBeOnTheScreen();
  });
});

describe("tabs", () => {
  // TASK-07: a personal board has no deadline clocks, so the tab was always empty there.
  it("a personal board has no Deadline tab", async () => {
    serve({ ws: makeWorkspace({ Id: 10, Type: "personal", MyRole: "owner" }) });
    await mount();
    await loaded();
    expect(screen.getByRole("tab", { name: "Details" })).toBeOnTheScreen();
    expect(screen.queryByText("Deadline")).toBeNull();
  });

  it("each tab shows its own panel, with counts on the badges", async () => {
    jest.mocked(getTaskComments).mockResolvedValue([
      {
        Id: 1,
        TaskId: 1,
        Comment: "Parts arrive Monday",
        UserId: 7,
        UserName: null,
        Avatar: null,
        ParentCommentId: null,
        IsPinned: null,
        IsDeleted: null,
        IsEdited: null,
        CreatedDate: new Date().toISOString(),
        UpdatedDate: null,
      },
    ]);
    await mount();
    await loaded();
    // E 08: Details · Checklist · Comments n · Deadline — Files and History live in Details.
    expect(screen.getAllByRole("tab").map((t) => t.props.accessibilityLabel)).toEqual([
      "Details", "Checklist", "Comments, 1", "Deadline",
    ]);
    expect(screen.getByRole("tab", { name: "Checklist", selected: true })).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole("tab", { name: "Details" }));
    expect(await screen.findByText("No history yet")).toBeOnTheScreen();
    expect(screen.getByText("0 files")).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("button", { name: "Files" }));
    await waitFor(() => expect(fetchAttachments).toHaveBeenCalledWith({ Entity: "task", EntityId: 1 }));
    await fireEvent.press(screen.getByRole("link", { name: "Back to details" }));
    expect(screen.getByRole("tab", { name: "Details", selected: true })).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole("tab", { name: "Comments, 1" }));
    expect(screen.getByText("Parts arrive Monday")).toBeOnTheScreen();
    expect(screen.getByText("Someone")).toBeOnTheScreen();

    await fireEvent.press(screen.getByText("Deadline"));
    expect(await screen.findByText("No deadline on this task")).toBeOnTheScreen();
  });
});
