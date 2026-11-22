// tests/live/shape.live.js — bad reporting data (Review Focus 5).
//
// Through users/saveUser as am_amit:
//   * a "Reports to" loop (vinod -> vivek -> vinod): sp_SaveUser refuses the
//     closing edge (400 "Reporting line would loop back to this user"), so the
//     API cannot make one; the lists must still answer with the first edge in.
//   * an inactive manager in the chain (vinod -> am_gone, who is inactive and
//     reports to rohit).
// Neither may hang a list (5 s), or lose anyone's own records. Restored in
// `finally`. Mutating only for its own duration. Lists are narrowed to this
// run's records (fixtures.js), so earlier runs' rows never push a held
// complaint past the page.

const { live, saveUser } = require("./client");
const { currentRun } = require("./fixtures");

const c = live();
let id;
let tag;

beforeAll(async () => {
  id = await c.ids();
  tag = (await currentRun()).tag;
});

const post = (who, path, body) => c.as(who).post(path, body);

async function heldBy(who) {
  const r = await post("amit", "/api/tickets/fetchTickets", { AssignedTo: id.users[who], SearchTerm: tag, PageSize: 200 });
  return r.body.data.tickets.map((t) => t.Id);
}

/** Each persona's list and picker answer 200 within 5 s, and the list keeps `held`. */
async function listsHold(people, held) {
  for (const who of people) {
    let t = Date.now();
    const list = await post(who, "/api/tickets/fetchTickets", { SearchTerm: tag, PageSize: 200 });
    expect({ who, status: list.status, slow: Date.now() - t > 5000 }).toEqual({ who, status: 200, slow: false });
    const got = list.body.data.tickets.map((x) => x.Id);
    expect({ who, lost: (held[who] ?? []).filter((x) => !got.includes(x)) }).toEqual({ who, lost: [] });

    t = Date.now();
    const picker = await post(who, "/api/users/fetchAssignableUsers", { Module: "complaints" });
    expect({ who, status: picker.status, slow: Date.now() - t > 5000 }).toEqual({ who, status: 200, slow: false });
  }
}

describe("bad reporting data", () => {
  it("a loop is refused at the source; with half of it in place nothing hangs or is lost", async () => {
    const held = { vinod: await heldBy("vinod"), vivek: await heldBy("vivek") };
    expect(held.vinod.length).toBeGreaterThan(0); // this run gave him some, so "lost" can fail
    const original = id.people.vinod.ReportsTo;
    try {
      expect((await saveUser(c, "vinod", { ReportsTo: id.users.vivek })).status).toBe(200);
      const closing = await saveUser(c, "vivek", { ReportsTo: id.users.vinod });
      expect(closing.status).toBe(400);
      expect(closing.body.message).toBe("Reporting line would loop back to this user");
      await listsHold(["vinod", "vivek", "rohit"], held);
      // Not widened: being vivek's report gives vinod none of vivek's complaints.
      const vinodList = (await post("vinod", "/api/tickets/fetchTickets", { SearchTerm: tag, PageSize: 200 })).body.data.tickets.map((t) => t.Id);
      expect(vinodList.filter((t) => held.vivek.includes(t))).toEqual([]);
    } finally {
      expect((await saveUser(c, "vinod", { ReportsTo: original })).status).toBe(200);
    }
  });

  it("an inactive manager in the chain hangs nothing and loses nothing", async () => {
    const held = { vinod: await heldBy("vinod") };
    const original = id.people.vinod.ReportsTo;
    try {
      expect((await saveUser(c, "vinod", { ReportsTo: id.users.gone })).status).toBe(200);
      await listsHold(["vinod", "rohit"], held);
    } finally {
      expect((await saveUser(c, "vinod", { ReportsTo: original })).status).toBe(200);
    }
  });
});
