const { MODULES, REACH_MODULES, buildAccess, scopeFor, isWide, stripSensitive, publicAccess, roleWithin } = require("../../../src/middleware/access");

// recordsets as sp_FetchUserAccess returns them
const rs = ({ admin = false, sensitive = false, modules = [], lists = [], owners = [] } = {}) => [
  [{ PrimaryBranchId: 2, IsActive: true, IsAdmin: admin, CanSeeSensitive: sensitive }],
  modules,
  lists,
  owners.map((OwnerId) => ({ OwnerId })),
];
const mod = (Module, Reach = null, v = 1, a = 0, e = 0, d = 0) =>
  ({ Module, Reach, CanView: v, CanAdd: a, CanEdit: e, CanDelete: d });
const LISTS = [
  { Reach: "Own", BranchId: 2, CanWrite: 1 },
  { Reach: "Team", BranchId: 2, CanWrite: 1 }, { Reach: "Team", BranchId: 3, CanWrite: 1 },
  { Reach: "Office", BranchId: 2, CanWrite: 1 }, { Reach: "Office", BranchId: 4, CanWrite: 0 },
  { Reach: "OfficeTree", BranchId: 2, CanWrite: 1 }, { Reach: "OfficeTree", BranchId: 4, CanWrite: 0 },
  { Reach: "OfficeTree", BranchId: 5, CanWrite: 0 },
  { Reach: "Company", BranchId: 1, CanWrite: 1 }, { Reach: "Company", BranchId: 2, CanWrite: 1 },
];

describe("module list", () => {
  it("holds the spec keys and the four reach modules", () => {
    expect(MODULES).toEqual(["leads", "sales_reports", "complaints", "support_reports", "customers", "people",
      "tasks", "teams", "projects", "roles", "offices", "settings", "dashboard", "attendance"]);
    expect([...REACH_MODULES]).toEqual(["leads", "complaints", "customers", "people", "attendance"]);
  });
});

describe("scopeFor", () => {
  const access = buildAccess(rs({
    modules: [mod("leads", "Own", 1, 1, 1, 0), mod("customers", "Office", 1, 1), mod("people", "Team"),
      mod("complaints", "OfficeTree"), mod("sales_reports"), mod("teams", null, 1, 1, 1)],
    lists: LISTS, owners: [7, 8],
  }), 7);

  it("Own = home office, owner = me", () => {
    const s = scopeFor(access, "leads", 7);
    expect(s).toMatchObject({ reach: "Own", branchIds: [2], canWriteBranchIds: [2], ownerIds: [7] });
    expect(s.can).toEqual({ view: true, add: true, edit: true, delete: false });
  });
  it("Team = subtree offices + subtree owners", () => {
    expect(scopeFor(access, "people", 7)).toMatchObject({ reach: "Team", branchIds: [2, 3], ownerIds: [7, 8] });
  });
  it("Office = home + extra offices, read-only extras not writable, no owner filter", () => {
    expect(scopeFor(access, "customers", 7)).toMatchObject({ branchIds: [2, 4], canWriteBranchIds: [2], ownerIds: null });
  });
  it("OfficeTree includes offices below", () => {
    expect(scopeFor(access, "complaints", 7).branchIds).toEqual([2, 4, 5]);
  });
  it("attendance is a reach module: Team reach gives the team owners; no grant gives nothing", () => {
    const a = buildAccess(rs({ modules: [mod("attendance", "Team"), mod("people", "Own")], lists: LISTS, owners: [7, 8] }), 7);
    expect(scopeFor(a, "attendance", 7)).toMatchObject({ reach: "Team", ownerIds: [7, 8], branchIds: [2, 3] });
    expect(scopeFor(access, "attendance", 7)).toMatchObject({ reach: null, branchIds: [], ownerIds: [] });
  });
  it("report modules borrow the source module's reach but keep their own rights", () => {
    const s = scopeFor(access, "sales_reports", 7);
    expect(s.reach).toBe("Own");
    expect(s.can).toEqual({ view: true, add: false, edit: false, delete: false });
  });
  it("plain modules borrow people's lists", () => {
    const s = scopeFor(access, "teams", 7);
    expect(s.branchIds).toEqual([2, 3]);
    expect(s.can.edit).toBe(true);
  });
  it("a module with no grant matches nothing and allows nothing", () => {
    const s = scopeFor(access, "settings", 7);
    expect(s.can).toEqual({ view: false, add: false, edit: false, delete: false });
    expect(s.branchIds).toEqual([]);
    expect(s.ownerIds).toEqual([]);
  });
});

describe("admin", () => {
  it("passes every module with Company reach and every office", () => {
    const access = buildAccess(rs({ admin: true, lists: LISTS }), 1);
    for (const m of MODULES) expect(scopeFor(access, m, 1).can).toEqual({ view: true, add: true, edit: true, delete: true });
    expect(scopeFor(access, "leads", 1)).toMatchObject({ reach: "Company", branchIds: [1, 2], ownerIds: null });
    expect(access.canSeeSensitive).toBe(true);
  });
});

describe("isWide", () => {
  it("Office and up, or admin", () => {
    expect(isWide({ reach: "Own" })).toBe(false);
    expect(isWide({ reach: "Team" })).toBe(false);
    expect(isWide({ reach: "Office" })).toBe(true);
    expect(isWide({ reach: "Company" })).toBe(true);
    expect(isWide({ reach: "Own", isAdmin: true })).toBe(true);
    expect(isWide(undefined)).toBe(false);
  });
});

describe("stripSensitive", () => {
  const user = { Id: 9, FullName: "A", BranchId: 4, HourlyRate: 500, Mobile: "9999999999", Email: "a@x.in" };
  const staff = buildAccess(rs({ modules: [mod("people", "Office")], lists: LISTS }), 7);
  const hr = buildAccess(rs({ sensitive: true, modules: [mod("people", "Office")], lists: LISTS }), 7);
  it("removes rate/mobile/email/username for a caller without the permission", () => {
    expect(stripSensitive(staff, 7, { ...user, Username: "a.k" }))
      .toEqual({ Id: 9, FullName: "A", BranchId: 4, HourlyRate: null, Mobile: null, Email: null, Username: null });
  });
  it("keeps them for the caller's own row", () => {
    expect(stripSensitive(staff, 9, user)).toEqual(user);
  });
  it("keeps them for a sensitive caller within people reach, strips outside it", () => {
    expect(stripSensitive(hr, 7, user)).toEqual(user);
    expect(stripSensitive(hr, 7, { ...user, BranchId: 99 }).Mobile).toBeNull();
    expect(stripSensitive(hr, 7, { ...user, Username: "a.k" }).Username).toBe("a.k");
  });
});

describe("roleWithin", () => {
  const row = (Module, r, Reach = null) => ({ Module, Reach, CanView: +r.includes("v"), CanAdd: +r.includes("a"),
    CanEdit: +r.includes("e"), CanDelete: +r.includes("d") });
  const hr = buildAccess(rs({ modules: [mod("people", "Office", 1, 1, 1, 0), mod("tasks", null)], lists: LISTS }), 7);
  it("passes a role inside the actor's grants and reach", () => {
    expect(roleWithin(hr, [row("people", "v", "Own"), row("tasks", "v")])).toBe(true);
    expect(roleWithin(hr, [row("people", "vae", "Office")])).toBe(true);
    expect(roleWithin(hr, [])).toBe(true);
  });
  it("refuses a module the actor lacks", () => {
    expect(roleWithin(hr, [row("leads", "v", "Own")])).toBe(false);
  });
  it("refuses an action the actor lacks", () => {
    expect(roleWithin(hr, [row("people", "vd", "Own")])).toBe(false);
  });
  it("refuses a wider reach", () => {
    expect(roleWithin(hr, [row("people", "v", "OfficeTree")])).toBe(false);
    expect(roleWithin(hr, [row("people", "v", "Company")])).toBe(false);
  });
  it("ignores reach on a row that grants no view", () => {
    expect(roleWithin(hr, [row("people", "", "Company")])).toBe(true);
  });
  it("lets an admin hand out anything", () => {
    expect(roleWithin(buildAccess(rs({ admin: true }), 7), [row("leads", "vaed", "Company")])).toBe(true);
  });
  it("treats no access as nothing", () => {
    expect(roleWithin(undefined, [row("tasks", "v")])).toBe(false);
  });
});

describe("publicAccess", () => {
  it("keeps what the client needs and drops the office lists", () => {
    const a = buildAccess(rs({ sensitive: true, modules: [mod("leads", "Office")], lists: LISTS }), 7);
    const pub = publicAccess(a);
    expect(pub).toEqual({ isAdmin: false, canSeeSensitive: true, primaryBranchId: 2, modules: a.modules });
    expect(pub).not.toHaveProperty("lists");
  });
});
