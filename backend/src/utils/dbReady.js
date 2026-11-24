// Start-up check for the access model (plan 2026-11-22, Task 17).
// The new backend reads leads, complaints and follow-ups through objects created
// by scripts 131-133. Without them those screens error, so server.js says so at
// boot, naming the database it actually reached (DB_NAME() from the server, not
// the env file), so a local run pointed at the wrong database is seen at once.
// ponytail: 134 is cleanup only (drops two dead procs) and adds nothing the
// code calls, so it has no marker here.
const ACCESS_MODEL_OBJECTS = [
  "fn_VisibleTickets", //               131
  "fn_VisibleLeads", //                 131
  "fn_VisibleFollowUps", //             131
  "fn_AssignableUsers", //              131
  "sp_FetchLoggedByMe", //              132
  "fn_ReassignGate", //                 133
  "sp_FetchTicketEscalationTargets", // 133
];

const QUERY = `SELECT DB_NAME() AS Db, ${ACCESS_MODEL_OBJECTS.map(
  (n) => `CASE WHEN OBJECT_ID('dbo.${n}') IS NULL THEN 0 ELSE 1 END AS [${n}]`,
).join(", ")}`;

// Never throws: a DB that is down, or a cards-only database, must still boot.
async function checkAccessModel(database) {
  try {
    const row = (await database.executeQuery(QUERY)).recordset?.[0] || {};
    const missing = ACCESS_MODEL_OBJECTS.filter((n) => !row[n]);
    return { ready: missing.length === 0, missing, database: row.Db ?? null };
  } catch (error) {
    return { ready: false, missing: [...ACCESS_MODEL_OBJECTS], database: null, error };
  }
}

// The one line server.js prints. Returns it so tests can read it.
async function reportAccessModel(database, envDbName, log = console) {
  const r = await checkAccessModel(database);
  const db = r.database || envDbName;
  if (r.database) log.log(`🗄️  Connected database: ${r.database}`);
  if (r.ready) {
    log.log(`✅ Access model present on ${db}`);
    return r;
  }
  log.error(
    `ACCESS MODEL NOT APPLIED on ${db}: missing ${r.missing.join(", ")} - leads and complaints will error until scripts 130-134 are applied` +
      (r.error ? ` (check failed: ${r.error.message})` : ""),
  );
  return r;
}

module.exports = { checkAccessModel, reportAccessModel, ACCESS_MODEL_OBJECTS };
