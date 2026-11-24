// node setup.js <out.json> [full] — this SolarTest run's names (read only), plus,
// unless "full", one complaint escalated to Rohit (Nitin logs it for Vivek,
// Vivek escalates) for the rohit-escalated slice. Talks only to
// localhost:5001; LIVE_PASSWORD comes from the environment and is never printed.
const fs = require("node:fs");
const base = "http://localhost:5001";
const pw = process.env.LIVE_PASSWORD;
const U = { amit: "Amit", nitin: "Nitin ", vivek: "Vivek", kasak: "Kasak ", neha: "Neha ", roshan: "Roshan" };
const tok = {};
async function post(who, path, body) {
  if (!tok[who]) {
    const r = await fetch(`${base}/api/auth/loginUser`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: U[who], password: pw }) });
    tok[who] = (await r.json())?.data?.token;
    if (!tok[who]) throw new Error(`sign-in failed for ${who}`);
  }
  const r = await fetch(base + path, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${tok[who]}` }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (r.status !== 200) throw new Error(`${who} ${path}: ${r.status} ${j?.message ?? ""}`);
  return j.data;
}
(async () => {
  const tag = `SOLARTEST-${new Date().toISOString().slice(5, 16).replace(/[-T:]/g, "")}`;
  const users = (await post("amit", "/api/users/fetchUsers", { PageSize: 200 })).users;
  const id = (u) => users.find((x) => x.Username === u).Id;
  const kasak = await post("kasak", "/api/leads/fetchLeads", { PageNumber: 1, PageSize: 1 });
  const mine = await post("kasak", "/api/leads/fetchLeads", { PageNumber: 1, PageSize: 1, OwnerId: id("Kasak ") });
  const t60 = (await post("amit", "/api/tickets/fetchTicketDetail", { TicketId: 60 })).ticket;
  const reason = (await post("amit", "/api/config/fetchLookups", { Kind: "transfer_reason" })).lookups.find((x) => x.Code !== "sent_back");
  const subject = `${tag} escalated to Rohit`;
  if (process.argv[3] !== "full") {
    const saved = await post("nitin", "/api/tickets/saveTicket", { CustomerId: t60.CustomerId, Subject: subject, Description: tag, AssignedTo: id("Vivek") });
    await post("vivek", "/api/tickets/escalateTicket", { TicketId: saved.Id, ToUserId: id("Rohit "), Remarks: `${tag} need senior` });
  }
  const roshan = await post("roshan", "/api/leads/fetchLeads", { PageNumber: 1, PageSize: 1, OwnerId: id("Roshan") });
  const resolution = (await post("amit", "/api/config/fetchLookups", { Kind: "resolution" })).lookups[0];
  const resolved = (await post("amit", "/api/config/fetchLookups", { Kind: "ticket_status" })).lookups.find((x) => x.Code === "resolved");
  const out = {
    TAG: tag, CUST: t60.CustomerName.trim(), REASON: reason.Value, ESC: subject,
    KASAK_ALL: kasak.pagination.totalRecords, KASAK_MINE: mine.pagination.totalRecords,
    NEHA_LEAD: kasak.leads[0].Name.trim(), T60: t60.TicketNo,
    ROSHAN_LEAD: roshan.leads[0].Name.trim(), RESOLUTION: resolution.Value.trim(), RESOLVED_LABEL: resolved.Value.trim(),
  };
  fs.writeFileSync(process.argv[2], JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out));
})().catch((e) => { console.error(e.message); process.exit(1); });
