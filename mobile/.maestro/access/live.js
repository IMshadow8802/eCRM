// mobile/.maestro/access/live.js — the API side of the access-model Maestro
// run (plan 2026-11-22 Task 30, owner rulings L3 / T28-pw2 / SELFSEED).
//
// Reuses the live suite's client (backend/tests/live): it refuses any backend
// that is not local or the hosted TestCRM, proves the database is TestCRM
// before the first write, and reads LIVE_PASSWORD from backend/.env.live at
// run time — never printed, never written. run.sh calls it between flows.
//
//   node live.js run                 createRun() -> .run.json (git-ignored), and
//                                    marks AM Vinod "Away today" (full-day leave)
//   node live.js cleanup [day]       removes that leave mark (or the one on [day])
//   node live.js move <C..> <who>    amit reassigns a complaint (a stale screen)
//   node live.js active <who> <0|1>  amit deactivates / re-activates a persona
/* global __dirname */
const fs = require("fs");
const path = require("path");

const LIVE = path.join(__dirname, "..", "..", "..", "backend", "tests", "live");
require(path.join(LIVE, "env.js"));
const { live, lookups, saveUser, day } = require(path.join(LIVE, "client.js"));
const { createRun } = require(path.join(LIVE, "fixtures.js"));

const RUN_FILE = path.join(__dirname, "..", ".run.json");
const run = () => JSON.parse(fs.readFileSync(RUN_FILE, "utf8"));

async function main([cmd, a, b]) {
  const c = live();
  const ids = await c.ids(); // the TestCRM proof, before any write
  const amit = c.as("amit");
  const ok = (r, what) => {
    if (r.status !== 200 && r.status !== 201) throw new Error(`${what}: ${r.status} ${r.body?.message ?? ""}`);
    return r.body?.data;
  };

  if (cmd === "run") {
    const r = await createRun({ client: c });
    const awayDay = day(0); // kept, so cleanup removes this mark even past midnight
    fs.writeFileSync(RUN_FILE, JSON.stringify({
      runId: r.runId, tag: r.tag, awayDay, complaints: r.complaints, leads: r.leads, customers: r.customers, followUps: r.followUps,
    }, null, 2));
    ok(await amit.post("/api/work/saveDayMark", {
      UserId: ids.users.vinod, WorkDate: awayDay, Part: "full", Kind: "leave", Remarks: "AM maestro",
    }), "Away today mark for vinod");
    console.log(`run ${r.tag}`);
  } else if (cmd === "cleanup") {
    ok(await amit.post("/api/work/deleteDayMark", { UserId: ids.users.vinod, WorkDate: a ?? run().awayDay }), "remove vinod's mark");
  } else if (cmd === "move") {
    const lk = await lookups(c);
    ok(await amit.post("/api/tickets/transferTicket", {
      TicketId: run().complaints[a].id, ToUserId: ids.users[b], ReasonId: lk.reasonId, Remarks: "AM maestro: moved while open",
    }), `move ${a} to ${b}`);
  } else if (cmd === "active") {
    ok(await saveUser(c, a, { UserActive: b === "1" }), `${a} active=${b}`);
  } else {
    throw new Error(`unknown command ${cmd}`);
  }
}

main(process.argv.slice(2)).catch((e) => {
  console.error(`live.js: ${e.message}`);
  process.exit(1);
});
