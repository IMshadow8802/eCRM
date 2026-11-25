// node calling-setup.mjs <out.json>   — the phone run's calling list on SolarTest
// node calling-setup.mjs teardown     — pull everything back, archive, restore calling hours
//
// Amit makes "CALLTEST b<N> PHONE" from the fake sheet (auto top-up, holds 5) with
// Ashish and Pawan as its callers, and opens calling hours for a night run. Both
// callers are topped up here (what opening the Calling screen does), so the flows
// know each one's 5 names, and the names of the next batch: the pool hands out by
// Id, and none of the flows' results puts a contact back in reach today.
// localhost:5001 only; LIVE_PASSWORD from backend/.env.live, never printed.
import fs from "node:fs";
import { PEOPLE, must, proveSolarTest, leftovers, nextBlock, createList, openHours, restoreHours } from "../../../web/e2e/solartest/calling-run.js";
import { makeSheet } from "../../../web/e2e/solartest/calling-fixtures.mjs";

const out = process.argv[2];
await proveSolarTest();
if (out === "teardown") {
  await leftovers();
  await restoreHours();
  process.exit(0);
}

await leftovers();
await openHours(20);
const block = await nextBlock();
const sheet = makeSheet(block);
const tag = `CALLTEST b${block}`;
const H = sheet.headers;
const rows = sheet.rows.map((r, i) => ({
  RowNo: i + 1, Name: r[1], Mobile: String(r[3] ?? ""), AltMobile: r[4] ? String(r[4]) : null, Address: r[5],
  Extra: { [H[0]]: r[0], [H[2]]: r[2], [H[6]]: r[6], [H[7]]: r[7] },
}));
const listId = await createList(`${tag} PHONE`);
await must("amit", "/api/calling/importContacts", { CallListId: listId, DryRun: false, rows });
await must("amit", "/api/calling/saveCallers", { CallListId: listId, Callers: [{ UserId: PEOPLE.ashish.id, HoldSize: 5 }, { UserId: PEOPLE.pawan.id, HoldSize: 5 }] });

const names = async (who) => (await must(who, "/api/calling/myList", { TopUp: 1 })).toCall.map((c) => c.Name);
const ashish = await names("ashish");
const pawan = await names("pawan");
if (ashish.length !== 5 || pawan.length !== 5) throw new Error(`top-up gave ${ashish.length} / ${pawan.length}, not 5 each`);
const pool = ((await must("amit", "/api/calling/fetchContacts", { CallListId: listId, Status: "pool", PageSize: 500 })).contacts ?? [])
  .sort((a, b) => a.Id - b.Id);
const env = { TAG: tag, LIST: `${tag} PHONE`, ANEXT: pool[0].Name, PNEXT: pool[5].Name };
ashish.forEach((n, i) => { env[`A${i + 1}`] = n; });
pawan.forEach((n, i) => { env[`P${i + 1}`] = n; });
fs.writeFileSync(out, JSON.stringify(env, null, 2));
console.log(JSON.stringify({ tag, list: listId }));
