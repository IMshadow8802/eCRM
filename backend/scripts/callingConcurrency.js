// scripts/callingConcurrency.js — two-caller race check for calling lists (149).
//
//   node scripts/callingConcurrency.js <CallListId> <UserIdA> <UserIdB> [rounds=20]
//
// It WRITES (sp_FetchMyCallList tops up), so it runs against TestCRM only and refuses
// anything else. Each round fires two parallel top-ups, one per caller, plus a duplicate
// for A in the same tick; at the end no contact may be held by both and neither may hold
// more than the list's hold size. Exit 0 = OK, 1 = a problem (ids printed).
require("dotenv").config({ path: process.env.ENV_FILE || ".env.testcrm" });
const database = require("../src/config/database");

async function main() {
  if (process.env.DB_NAME !== "TestCRM") throw new Error(`Refusing to run against ${process.env.DB_NAME || "(no DB_NAME)"}; TestCRM only`);
  const [listId, a, b, rounds = 20] = process.argv.slice(2).map(Number);
  if (!listId || !a || !b) throw new Error("usage: node scripts/callingConcurrency.js <CallListId> <UserIdA> <UserIdB> [rounds=20]");
  const meta = await database.executeQuery("SELECT CompId, HoldSize FROM dbo.tblCallList WHERE Id = @Id", { Id: listId });
  const { CompId, HoldSize } = meta.recordset?.[0] ?? {};
  if (!CompId) throw new Error(`List ${listId} not found`);

  const fetch = (UserId) => database.executeStoredProcedure("sp_FetchMyCallList", { CompId, UserId, TopUp: 1 });
  for (let i = 0; i < rounds; i++) await Promise.all([fetch(a), fetch(b), fetch(a)]);

  const held = async (UserId) => ((await database.executeStoredProcedure("sp_FetchMyCallList", { CompId, UserId, TopUp: 0 }))
    .recordsets?.[1] ?? []).filter((r) => r.CallListId === listId).map((r) => r.Id);
  const [ha, hb] = [await held(a), await held(b)];
  const shared = ha.filter((id) => hb.includes(id));
  const over = [[a, ha], [b, hb]].filter(([, ids]) => ids.length > HoldSize);
  if (shared.length || over.length) {
    if (shared.length) console.error(`FAIL: held by both: ${shared.join(", ")}`);
    for (const [u, ids] of over) console.error(`FAIL: user ${u} holds ${ids.length} > ${HoldSize}: ${ids.join(", ")}`);
    return 1;
  }
  console.log(`OK: ${ha.length} held by A, ${hb.length} by B, no shared contact`);
  return 0;
}

main()
  .then((code) => { process.exitCode = code; })
  .catch((err) => { console.error(err.message); process.exitCode = 1; })
  .finally(() => database.close());
