// e2e/global-setup.js — before any project: create THIS run's records through
// the API (backend/tests/live/fixtures.js createRun(), owned by the live suite)
// and write their ids to e2e/.auth/run.json (git-ignored). The specs use only
// those records, so a run never depends on what an earlier run moved.
//
// fixtures.js signs in with LIVE_PASSWORD from backend/.env.live at run time;
// nothing here reads, prints or stores the password. The base URL is checked
// first: the web under test is local, so the records must land on the backend
// it talks to (http://localhost:5001), or the hosted TestCRM.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { RUN_FILE, WEB_URL, checkTarget } from "./personas.js";

const require = createRequire(import.meta.url);
const LIVE = path.join(path.dirname(RUN_FILE), "..", "..", "..", "backend", "tests", "live");

const KEYS = {
  complaints: Array.from({ length: 20 }, (_, i) => `C${String(i + 1).padStart(2, "0")}`),
  leads: Array.from({ length: 9 }, (_, i) => `L${String(i + 1).padStart(2, "0")}`),
  customers: ["HO", "ND", "SE"],
};

// Plain copy of every record the run offers (an accessor that throws or
// returns nothing = that key is not part of the run).
const grab = (get, keys) => Object.fromEntries(keys.flatMap((k) => {
  try {
    const rec = get(k);
    return rec?.id ? [[k, { ...rec }]] : [];
  } catch {
    return [];
  }
}));

export default async function globalSetup() {
  require(path.join(LIVE, "env.js")); // loads backend/.env.live into process.env
  checkTarget(WEB_URL, process.env.LIVE_BASE_URL);
  const { createRun } = require(path.join(LIVE, "fixtures.js"));
  const run = await createRun();
  const out = {
    runId: run.runId,
    tag: run.tag,
    complaints: grab((k) => run.complaint(k), KEYS.complaints),
    leads: grab((k) => run.lead(k), KEYS.leads),
    customers: grab((k) => run.customer(k), KEYS.customers),
  };
  fs.mkdirSync(path.dirname(RUN_FILE), { recursive: true });
  fs.writeFileSync(RUN_FILE, JSON.stringify(out, null, 2));
}
