import { describe, it, expect } from "vitest";
import { workspaceAbilities, taskAbilities } from "./taskAbilities";

const T = (o = {}) => ({ CreatedByUserId: 9, Assignees: [], ...o });
const as = (u) => [{ UserId: u }];
const run = (ctx) => taskAbilities({ userId: 1, ...ctx });
const ALL = ["view","createTask","manageColumns","pinComment","comment","changeStatus","logTime","manageArtifacts","editFields","deleteTask"];
const truthy = (a, keys) => keys.every((k) => a[k]);
const falsy = (a, keys) => keys.every((k) => !a[k]);

describe("taskAbilities (mirror of sp_CheckTaskPermission)", () => {
  it("personal owner gets everything", () => {
    const a = run({ wsType: "personal", role: "owner", isAdmin: false, task: T() });
    expect(truthy(a, ALL)).toBe(true);
  });
  it("personal + admin + no role gets nothing (B13 inverse)", () => {
    const a = run({ wsType: "personal", role: null, isAdmin: true, task: T() });
    expect(falsy(a, [...ALL, "claim"])).toBe(true);
  });
  it("shared + admin + no role gets everything", () => {
    const a = run({ wsType: "shared", role: null, isAdmin: true, task: T() });
    expect(truthy(a, ALL)).toBe(true);
  });
  // REGRESSION: "Take this task" showed to a non-member admin, then sp_ClaimTask 400'd.
  it("shared + admin + no role cannot claim; admin who is a member can", () => {
    expect(run({ wsType: "shared", role: null, isAdmin: true, task: T() }).claim).toBe(false);
    expect(run({ wsType: "project", role: "member", isAdmin: true, task: T() }).claim).toBe(true);
  });
  it("admin without a workspace type grants nothing", () => {
    expect(workspaceAbilities({ wsType: null, role: null, isAdmin: true }).full).toBe(false);
  });
  it("pending invitee (role null) gets nothing", () => {
    const a = run({ wsType: "shared", role: null, isAdmin: false, task: T() });
    expect(falsy(a, [...ALL, "claim"])).toBe(true);
  });
  it.each(["owner", "manager"])("%s gets everything", (role) => {
    const a = run({ wsType: "project", role, isAdmin: false, task: T() });
    expect(truthy(a, [...ALL, "claim"])).toBe(true);
  });
  it("a viewer cannot claim", () => {
    expect(run({ wsType: "shared", role: "viewer", isAdmin: false, task: T() }).claim).toBe(false);
  });

  describe("member", () => {
    const ctx = { wsType: "shared", role: "member", isAdmin: false };
    it("neither assignee nor creator", () => {
      const a = run({ ...ctx, task: T({ Assignees: as(5) }) });
      expect(falsy(a, ["changeStatus", "logTime", "manageArtifacts", "editFields", "deleteTask", "claim"])).toBe(true);
      expect(truthy(a, ["comment", "createTask"])).toBe(true);
    });
    it("creator edits; deletes only with no other assignee", () => {
      expect(run({ ...ctx, task: T({ CreatedByUserId: 1 }) }).editFields).toBe(true);
      expect(run({ ...ctx, task: T({ CreatedByUserId: 1 }) }).deleteTask).toBe(true);
      expect(run({ ...ctx, task: T({ CreatedByUserId: 1, Assignees: as(5) }) }).deleteTask).toBe(false);
    });
    it("assignee manages artifacts but cannot edit fields", () => {
      const a = run({ ...ctx, task: T({ Assignees: as(1) }) });
      expect(a.manageArtifacts && a.changeStatus && a.logTime).toBe(true);
      expect(a.editFields).toBe(false);
    });
  });

  describe("viewer", () => {
    const ctx = { wsType: "shared", role: "viewer", isAdmin: false };
    it("assignee changes status but cannot manage artifacts or create", () => {
      const a = run({ ...ctx, task: T({ Assignees: as(1) }) });
      expect(a.changeStatus && a.logTime).toBe(true);
      expect(falsy(a, ["manageArtifacts", "createTask"])).toBe(true);
    });
    it("viewer-creator cannot edit", () => {
      expect(run({ ...ctx, task: T({ CreatedByUserId: 1 }) }).editFields).toBe(false);
    });
  });

  it("claim only when the task has no assignees", () => {
    const ctx = { wsType: "shared", role: "member", isAdmin: false };
    expect(run({ ...ctx, task: T() }).claim).toBe(true);
    expect(run({ ...ctx, task: T({ Assignees: as(5) }) }).claim).toBe(false);
  });
  it("task = null leaves task flags false, workspace flags intact", () => {
    const a = run({ wsType: "shared", role: "member", isAdmin: false, task: null });
    expect(falsy(a, ["changeStatus", "logTime", "editFields", "claim", "deleteTask", "manageArtifacts"])).toBe(true);
    expect(a.createTask).toBe(true);
  });
});
