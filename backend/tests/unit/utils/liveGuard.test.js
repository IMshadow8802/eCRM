// The live suite's guards (tests/live/client.js), with a mocked fetch: it must
// refuse a non-local, non-TestCRM base URL before any request, and refuse a
// backend whose database does not hold the 136 seed.
const { checkBaseUrl, makeClient, isRefusal, day } = require("../../live/client");
const { rank } = require("../../live/sequencer");
const LiveSequencer = require("../../live/sequencer");

const json = (status, body) => ({
  status,
  headers: { get: () => "application/json; charset=utf-8" },
  json: async () => body,
  text: async () => JSON.stringify(body),
});

// A fake backend: sign-in works for any am_ persona; lists come from `data`.
function fakeBackend(data, { loginStatus = 200 } = {}) {
  return jest.fn(async (url, init) => {
    const path = new URL(url).pathname.replace(/^\/TestCRM/, "");
    if (path === "/api/auth/loginUser") {
      return loginStatus === 200
        ? json(200, { success: true, data: { token: "t" } })
        : json(loginStatus, { success: false, message: "Invalid username or password" });
    }
    expect(init.headers.Authorization).toBe("Bearer t");
    const key = {
      "/api/tickets/fetchTickets": "tickets",
      "/api/leads/fetchLeads": "leads",
      "/api/customers/fetchCustomers": "customers",
      "/api/users/fetchUsers": "users",
    }[path];
    return json(200, { success: true, data: { [key]: data[key] ?? [] } });
  });
}

const PERSONAS = ["amit", "neha", "nitin", "rohit", "vinod", "vivek", "prasant", "kasak", "roshan",
  "stl", "field", "imran", "vikram", "pooja", "ndmgr", "hr", "gone", "readonly"];
const seeded = () => ({
  tickets: Array.from({ length: 20 }, (_, i) => ({ Id: 1170 + i, Subject: `AM-C${String(i + 1).padStart(2, "0")} x` })),
  leads: Array.from({ length: 9 }, (_, i) => ({ Id: 1831 + i, Name: `AM-L0${i + 1} x` })),
  customers: [{ Id: 1174, Name: "AM-Cust-HO" }, { Id: 1175, Name: "AM-Cust-ND" }, { Id: 1176, Name: "AM-Cust-SE" }],
  users: PERSONAS.map((p, i) => ({ Id: 86 + i, Username: `am_${p}`, FullName: `AM ${p}` })),
});

describe("checkBaseUrl", () => {
  it.each([
    "http://localhost:5001",
    "http://127.0.0.1:5001/",
    "https://shadowcodes.in/TestCRM",
    "https://shadowcodes.in/TestCRM/",
  ])("accepts %s", (u) => {
    expect(checkBaseUrl(u)).toBe(u.replace(/\/$/, ""));
  });

  it.each([
    "https://shadowcodes.in/CRM",
    "https://shadowcodes.in/SolarCRM",
    "https://shadowcodes.in/TestCRM/../CRM",
    "http://shadowcodes.in/TestCRM", // not https
    "http://localhost.evil.com:5001",
    "http://10.0.0.5:5001",
    "",
    undefined,
    "not a url",
  ])("refuses %s", (u) => {
    expect(() => checkBaseUrl(u)).toThrow(/Live suite refused/);
  });
});

describe("makeClient", () => {
  it("refuses a live company URL before any request", () => {
    const fetch = jest.fn();
    expect(() => makeClient({ baseUrl: "https://shadowcodes.in/CRM", password: "x", fetch })).toThrow(/Live suite refused/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("refuses without a password, before any request", () => {
    const fetch = jest.fn();
    expect(() => makeClient({ baseUrl: "http://localhost:5001", fetch })).toThrow(/LIVE_PASSWORD/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("resolves every tag on the seeded TestCRM", async () => {
    const fetch = fakeBackend(seeded());
    const ids = await makeClient({ baseUrl: "http://localhost:5001", password: "x", fetch }).ids();
    expect(ids.C01).toBe(1170);
    expect(ids.C20).toBe(1189);
    expect(ids.L09).toBe(1839);
    expect(ids.customers).toEqual({ HO: 1174, ND: 1175, SE: 1176 });
    expect(ids.users.readonly).toBe(103);
    // Signs in once as am_amit, never printing the password in the URL.
    const logins = fetch.mock.calls.filter(([u]) => u.endsWith("/api/auth/loginUser"));
    expect(logins).toHaveLength(1);
    expect(JSON.parse(logins[0][1].body).username).toBe("am_amit");
  });

  it("refuses when the AM- tags do not resolve (a database without the seed)", async () => {
    const data = seeded();
    data.tickets = data.tickets.filter((t) => !t.Subject.startsWith("AM-C07"));
    data.users = data.users.filter((u) => u.Username !== "am_gone");
    const c = makeClient({ baseUrl: "http://localhost:5001", password: "x", fetch: fakeBackend(data) });
    await expect(c.ids()).rejects.toThrow(/not the seeded TestCRM database \(missing AM-C07, am_gone\)/);
  });

  it("refuses when am_amit cannot sign in (eCRM+ behind a local backend), without echoing the password", async () => {
    const c = makeClient({ baseUrl: "http://localhost:5001", password: "secret-pw", fetch: fakeBackend(seeded(), { loginStatus: 401 }) });
    const err = await c.ids().catch((e) => e);
    expect(err.message).toMatch(/Live suite refused: could not prove .* is TestCRM: am_amit could not sign in/);
    expect(err.message).not.toContain("secret-pw");
  });

  it("re-signs in once after a session-ended 401", async () => {
    let calls = 0;
    const fetch = jest.fn(async (url) => {
      if (url.endsWith("/api/auth/loginUser")) return json(200, { data: { token: "t" } });
      calls += 1;
      return calls === 1 ? json(401, { code: "SESSION_ENDED" }) : json(200, { success: true, data: {} });
    });
    const r = await makeClient({ baseUrl: "http://localhost:5001", password: "x", fetch }).as("nitin").post("/api/x");
    expect(r.status).toBe(200);
    expect(fetch.mock.calls.filter(([u]) => u.endsWith("/api/auth/loginUser"))).toHaveLength(2);
  });
});

describe("suite helpers against a fake backend", () => {
  const { lookups, noticeMark, noticesSince, saveUser } = require("../../live/client");
  const routes = {
    "/api/config/fetchLookups": (b) => ({
      lookups: {
        transfer_reason: [{ Id: 39, Code: "sent_back" }, { Id: 40, Code: "overloaded" }],
        resolution: [{ Id: 7 }],
        ticket_status: [{ Id: 1, Code: "open" }, { Id: 2, Code: "onhold" }],
        lead_status: [{ Id: 11, Code: "open" }, { Id: 12, Code: "lost" }],
      }[b.Kind],
    }),
    "/api/notifications/fetchNotifications": () => ({
      notifications: [{ Id: "12", Type: "ticket_assigned" }, { Id: "10", Type: "ticket_moved_away" }, { Id: "9", Type: "ticket_assigned" }],
    }),
    "/api/users/fetchUsers": () => ({
      users: [{ Id: 102, Username: "am_vinod", FullName: "AM Vinod", GroupId: 5, BranchId: "1", ReportsTo: 98, IsActive: true }],
    }),
    "/api/users/saveUser": (b) => ({ echo: b }),
  };
  const fetch = jest.fn(async (url, init) => {
    const path = new URL(url).pathname;
    if (path === "/api/auth/loginUser") return json(200, { data: { token: "t" } });
    return json(200, { success: true, data: routes[path](JSON.parse(init.body)) });
  });
  const c = makeClient({ baseUrl: "http://localhost:5001", password: "x", fetch });
  c.ids = async () => ({ users: { vinod: 102 } });

  it("lookups skips the sent-back reason", async () => {
    expect(await lookups(c)).toEqual({
      reasonId: 40, resolutionId: 7, ticketOpen: 1, ticketOnHold: 2, leadOpen: 11, leadLost: 12,
    });
  });

  it("notice marks compare numerically (BIGINT ids arrive as strings)", async () => {
    expect(await noticeMark(c, "vivek")).toBe(12);
    expect((await noticesSince(c, "vivek", 9)).map((n) => n.Id)).toEqual(["12", "10"]);
    expect((await noticesSince(c, "vivek", 9, "ticket_assigned")).map((n) => n.Id)).toEqual(["12"]);
  });

  it("saveUser resends the fresh row with only the change, never a password", async () => {
    const r = await saveUser(c, "vinod", { ReportsTo: 99 });
    expect(r.body.data.echo).toEqual({
      Id: 102, Username: "am_vinod", FullName: "AM Vinod", Email: undefined, JobTitle: undefined, HourlyRate: 0,
      GroupId: 5, BranchId: "1", Mobile: undefined, ReportsTo: 99, UserActive: true,
    });
    expect(r.body.data.echo).not.toHaveProperty("Password");
  });

  it("upload sends Entity before the file, as multipart", async () => {
    const up = jest.fn(async (url, init) => (url.endsWith("/loginUser")
      ? json(200, { data: { token: "t" } })
      : json(404, { success: false, message: "Complaint not found" })));
    const r = await makeClient({ baseUrl: "http://localhost:5001", password: "x", fetch: up })
      .as("nitin").upload("/api/attachments/save", { Entity: "ticket", EntityId: 5 });
    expect(r.status).toBe(404);
    const form = up.mock.calls[1][1].body;
    expect([...form.keys()]).toEqual(["Entity", "EntityId", "file"]);
  });
});

describe("helpers", () => {
  it("isRefusal: 403/404 without data only", () => {
    expect(isRefusal({ status: 404, body: { success: false } })).toBe(true);
    expect(isRefusal({ status: 403, body: { success: false, data: null } })).toBe(true);
    expect(isRefusal({ status: 200, body: { success: true, data: {} } })).toBe(false);
    expect(isRefusal({ status: 403, body: { success: false, data: { leak: 1 } } })).toBe(false);
    expect(isRefusal({ status: 400, body: { success: false } })).toBe(false);
  });

  it("day() is a local YYYY-MM-DD", () => {
    expect(day(0)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("the sequencer runs matrix, legacy, flows, shape in that order", () => {
    const paths = ["shape", "flows", "legacy", "matrix"].map((n) => ({ path: `/x/tests/live/${n}.live.js` }));
    expect(new LiveSequencer().sort(paths).map((t) => t.path.split("/").pop())).toEqual([
      "matrix.live.js", "legacy.live.js", "flows.live.js", "shape.live.js",
    ]);
    expect(rank("/x/other.live.js")).toBe(4);
  });
});
