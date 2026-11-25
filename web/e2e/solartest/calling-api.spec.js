// e2e/solartest/calling-api.spec.js — the calling-list leak matrix on SolarTest,
// API only (no browser). Amit makes a list from the fake sheet, gives 5 each to
// Deeksha and Roshan by hand and puts Kasak on auto top-up (holds 5); then every
// one of the 14 people calls every calling / phoneMark / calling-report endpoint.
// The rules (spec 2026-11-16 §3a): a salesperson sees only what they hold right
// now; support people and Neha (no Calling lists grant) manage nothing; cost is
// the Owner's alone; no reply to anyone but a list manager carries a number they
// do not hold (every reply's raw text is scanned for every fake number).
//
// Run: pnpm exec playwright test -c playwright.solartest.config.js calling-api
// Checks go to $CALLING_RESULTS (JSON lines) when set.
import { test, expect } from "@playwright/test";
import { PEOPLE, post, must, proveSolarTest, leftovers, nextBlock, createList, openHours, restoreHours, today, recorder } from "./calling-run.js";
import { makeSheet } from "./calling-fixtures.mjs";
import { buildRows, guessMapping } from "../../src/pages/Sales/CallingLists/sheetParse.js";

test.describe.configure({ mode: "serial" });

const rec = recorder("api");
const S = { held: {} };      // run state
const ALL = Object.keys(PEOPLE);
const NON_OWNER = ALL.filter((k) => k !== "amit");
const id = (k) => PEOPLE[k].id;
const kind = (k) => PEOPLE[k].kind;

/** Recorded, not thrown: one failed check must not stop the walk (test 10 fails the run if any did). */
function check(name, pass, detail = "") {
  rec.add(name, pass, detail);
}

// ---- the oracle: what the manager view says each person holds ----------------
async function contacts(body) {
  const d = await must("amit", "/api/calling/fetchContacts", { CallListId: S.list, PageSize: 500, ...body });
  return d.contacts ?? [];
}
async function snapshot() {
  const all = await contacts({});
  S.byId = Object.fromEntries(all.map((c) => [c.Id, c]));
  S.held = {};
  for (const c of all) {
    if (!["held", "callback"].includes(c.Status) || !c.HeldBy) continue;
    (S.held[c.HeldBy] ??= []).push(c);
  }
  return all;
}
const heldIds = (k, status) => (S.held[id(k)] ?? []).filter((c) => !status || c.Status === status).map((c) => c.Id).sort((a, b) => a - b);
const heldNums = (k) => (S.held[id(k)] ?? []).flatMap((c) => [c.Mobile, c.AltMobile]).filter(Boolean);

/** Every fake number in a reply that the person does not hold (before or after the call) is a leak. */
function scan(k, r, label, allowed = heldNums(k)) {
  if (kind(k) === "owner") return;
  const leaked = S.sheet.numbers.all.filter((n) => !allowed.includes(n) && r.raw.includes(n));
  check(`leak-scan ${k} ${label}`, leaked.length === 0, leaked.length ? `numbers not held: ${leaked.join(",")}` : "");
}

/** A caller write: the reply, scanned against what they held before ∪ after. */
async function act(k, route, body, label) {
  const before = heldNums(k);
  const r = await post(k, route, body);
  await snapshot();
  scan(k, r, label, [...before, ...heldNums(k)]);
  return r;
}

const ids = (rows = []) => rows.map((c) => c.Id).sort((a, b) => a - b);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const refused = (r) => r.status === 403 && r.body?.success === false && r.body?.data == null;
const freshNum = () => `9000${String(S.block).padStart(3, "0")}8${String(Math.floor(Math.random() * 90) + 10)}`;

test.beforeAll(async () => {
  await proveSolarTest();
  await leftovers();
  await openHours(1);                       // calling hours 0–24 for the night run; callback cap 1 for the cap check
  S.block = await nextBlock();
  S.sheet = makeSheet(S.block);
  S.tag = `CALLTEST b${S.block}`;
  // The sheet's "already a lead" number becomes a lead, and its do-not-call number is marked, before the import.
  await must("amit", "/api/leads/saveLeads", { Id: 0, Name: `${S.tag} existing lead FAKE`, MobileNo: S.sheet.numbers.lead, FirstFollowupAt: `${today(1)}T11:00:00` });
  await must("amit", "/api/phoneMark/set", { Mobile: S.sheet.numbers.dnc, Mark: "dnc", Note: `${S.tag} asked not to be called` });
});

test.afterAll(async () => {
  rec.flush();
  await leftovers().catch(() => {});
  await restoreHours().catch(() => {});
});

test("1. Amit makes the list and imports the sheet (mapping, preview counts, alt-mobile rule)", async () => {
  S.list = await createList(`${S.tag} API`);
  const cells = S.sheet.rows.map((r) => r.map((v) => (v == null ? "" : String(v))));
  const mapping = guessMapping(S.sheet.headers);
  check("mapping Contact→Mobile, Mobile2→Alt mobile, Name, Address, rest extra",
    same(mapping, ["extra", "Name", "extra", "Mobile", "AltMobile", "Address", "extra", "extra"]), JSON.stringify(mapping));
  const { rows, repeated } = buildRows(cells, mapping, S.sheet.headers);
  check("browser drops 3 in-sheet repeats", repeated.length === S.sheet.expect.repeated, `repeated=${repeated.length}`);
  check("57 rows go to the server", rows.length === S.sheet.expect.sent, `rows=${rows.length}`);

  const dry = await must("amit", "/api/calling/importContacts", { CallListId: S.list, DryRun: true, rows });
  const want = S.sheet.expect;
  for (const k of ["Added", "BadNumber", "IsLead", "Dnc", "InPool", "IsCustomer"]) {
    check(`preview ${k}`, Number(dry.counts[k]) === want[k], `${dry.counts[k]} vs ${want[k]}`);
  }
  const real = await must("amit", "/api/calling/importContacts", { CallListId: S.list, DryRun: false, rows });
  check("import adds 51", Number(real.counts.Added) === want.Added, `Added=${real.counts.Added}`);
  const again = await must("amit", "/api/calling/importContacts", { CallListId: S.list, DryRun: true, rows });
  check("re-import of the same sheet adds nothing (Already in pool)", Number(again.counts.Added) === 0 && Number(again.counts.InPool) === want.Added,
    JSON.stringify(again.counts));

  const all = await snapshot();
  check("pool holds exactly the 51 expected numbers", same(all.map((c) => c.Mobile).sort(), [...S.sheet.numbers.pooled].sort()), `n=${all.length}`);
  for (const n of S.sheet.numbers.altOnly) {
    const c = all.find((x) => x.Mobile === n);
    check(`alt-mobile rule: empty Contact imports on Mobile2 ${n}`, c && !c.AltMobile, JSON.stringify(c && { m: c.Mobile, a: c.AltMobile }));
  }
  const two = all.find((x) => x.Mobile === S.sheet.numbers.twoInCell[0]);
  check("two numbers in one cell → Mobile + Alt mobile", two?.AltMobile === S.sheet.numbers.twoInCell[1], JSON.stringify(two && { m: two.Mobile, a: two.AltMobile }));
  check("do-not-call number not imported", !all.some((c) => c.Mobile === S.sheet.numbers.dnc));
  check("existing-lead number not imported", !all.some((c) => c.Mobile === S.sheet.numbers.lead));
  const hist = await must("amit", "/api/calling/contactHistory", { ContactId: all.find((c) => c.Mobile === S.sheet.numbers.pooled[0]).Id });
  const labels = (hist.contact.extras ?? []).map((e) => e.label).sort();
  check("extra columns kept (Ref No., Anniversary, GroupName, BranchName)", same(labels, ["Anniversary", "BranchName", "GroupName", "Ref No."]), labels.join("|"));
});

test("2. hand out: Deeksha 5 and Roshan 5 by hand, Kasak on auto top-up (holds 5)", async () => {
  const callers = await post("amit", "/api/calling/saveCallers", { CallListId: S.list, Callers: [{ UserId: id("kasak"), HoldSize: 5 }] });
  check("saveCallers Kasak 200", callers.status === 200, callers.body?.message);
  const given = await post("amit", "/api/calling/assign", { CallListId: S.list, Assign: [{ UserId: id("deeksha"), Count: 5 }, { UserId: id("roshan"), Count: 5 }] });
  check("assign Deeksha 5 + Roshan 5 → Given 10", given.status === 200 && Number(given.body?.data?.Given) === 10, JSON.stringify(given.body?.data ?? given.body?.message));
  const support = await post("amit", "/api/calling/assign", { CallListId: S.list, Assign: [{ UserId: id("rohit"), Count: 1 }] });
  check("assign to Rohit (support, cannot add leads) is refused", support.status >= 400, `${support.status} ${support.body?.message}`);
  await snapshot();
  check("oracle: Deeksha holds 5", heldIds("deeksha").length === 5);
  check("oracle: Roshan holds 5", heldIds("roshan").length === 5);
  check("oracle: Kasak holds 0 before she opens Calling", heldIds("kasak").length === 0);
  check("oracle: Rohit holds nothing", heldIds("rohit").length === 0);
  const k = await act("kasak", "/api/calling/myList", { TopUp: 0 }, "myList TopUp0 (Home)");
  check("Home read (TopUp 0) gives Kasak nothing", (k.body?.data?.toCall ?? []).length === 0 && heldIds("kasak").length === 0);
  const k1 = await act("kasak", "/api/calling/myList", { TopUp: 1 }, "myList TopUp1");
  check("Calling screen (TopUp 1) gives Kasak 5", (k1.body?.data?.toCall ?? []).length === 5 && Number(k1.body?.data?.head?.Given) === 5, JSON.stringify(k1.body?.data?.head));
  check("Kasak's 5 are none of Deeksha's / Roshan's", !ids(k1.body?.data?.toCall).some((x) => heldIds("deeksha").includes(x) || heldIds("roshan").includes(x)));
  S.kasakFirst = ids(k1.body?.data?.toCall);
});

/** Every endpoint, once, as one person. Expectations by role family. */
async function matrix(label) {
  await snapshot();
  const pool = Object.values(S.byId).find((c) => c.Status === "pool" && !c.LastCalledBy && !c.Attempts);
  const roshanHeld = heldIds("roshan")[0] ?? heldIds("deeksha")[0];
  const marks = (await must("amit", "/api/phoneMark/fetch", { PageSize: 5 })).marks ?? [];
  for (const k of NON_OWNER) {
    const fam = kind(k);
    const manager = [
      ["/api/calling/fetchLists", {}],
      ["/api/calling/fetchLists", { Id: S.list }],
      ["/api/calling/saveList", { Id: S.list, BranchId: 1, Name: `${S.tag} hijack` }],
      ["/api/calling/saveList", { Id: 0, BranchId: 1, Name: `${S.tag} by ${k}` }],
      ["/api/calling/saveCallers", { CallListId: S.list, Callers: [{ UserId: id(k), HoldSize: 50 }] }],
      ["/api/calling/importContacts", { CallListId: S.list, DryRun: true, rows: [{ RowNo: 1, Mobile: freshNum() }] }],
      ["/api/calling/addContact", { CallListId: S.list, Mobile: freshNum(), Name: "x" }],
      ["/api/calling/fetchContacts", { CallListId: S.list }],
      ["/api/calling/fetchContacts", { CallListId: S.list, HeldBy: id(k) }],
      ["/api/calling/contactHistory", { ContactId: pool?.Id ?? 1 }],
      ["/api/calling/assign", { CallListId: S.list, Assign: [{ UserId: id(k), Count: 5 }] }],
      ["/api/calling/assign", { CallListId: S.list, ContactIds: [pool?.Id ?? 1], ToUserId: id(k) }],
      ["/api/calling/recall", { CallListId: S.list }],
      ["/api/calling/setState", { CallListId: S.list, ContactIds: [pool?.Id ?? 1], Action: "move", ToUserId: id(k) }],
      ["/api/phoneMark/fetch", {}],
      ["/api/phoneMark/set", { Mobile: freshNum(), Mark: "caution", Note: "x" }],
      ["/api/calling/deleteList", { Id: S.list }],
      ["/api/phoneMark/clear", { Id: marks[0]?.Id ?? 1, ClearNote: "x" }],
    ];
    for (const [route, body] of manager) {
      const r = await post(k, route, body);
      check(`${label} ${k} ${route}${body.Id === 0 ? " (new)" : ""} → 403`, refused(r), `${r.status} ${r.body?.message ?? ""}`);
      scan(k, r, `${label} ${route}`);
    }
    // caller routes
    const mine = await post(k, "/api/calling/myList", { TopUp: 0 });
    if (fam === "support") {
      check(`${label} ${k} myList → 403`, refused(mine), `${mine.status}`);
    } else {
      const got = mine.body?.data ?? {};
      check(`${label} ${k} myList = exactly what the oracle says they hold`,
        mine.status === 200 && same(ids(got.toCall), heldIds(k, "held")) && same(ids(got.callbacks), heldIds(k, "callback")),
        `toCall=${ids(got.toCall)} oracle=${heldIds(k, "held")} cb=${ids(got.callbacks)}/${heldIds(k, "callback")}`);
      check(`${label} ${k} myList has no Cost field`, !/"Cost"/.test(mine.raw));
    }
    scan(k, mine, `${label} myList`);
    if (roshanHeld && !heldIds(k).includes(roshanHeld)) {
      for (const [route, body] of [
        ["/api/calling/saveResult", { ContactId: roshanHeld, Result: "not_interested" }],
        ["/api/calling/convert", { ContactId: roshanHeld, Name: "stolen" }],
      ]) {
        const r = await post(k, route, body);
        const ok = fam === "support" ? refused(r) : r.status === 404 || r.status === 409;
        check(`${label} ${k} ${route} on someone else's contact → ${fam === "support" ? 403 : "404/409"}`, ok, `${r.status} ${r.body?.message}`);
        scan(k, r, `${label} ${route} other's`);
      }
    }
    if (pool) {
      const r = await post(k, "/api/calling/saveResult", { ContactId: pool.Id, Result: "busy" });
      check(`${label} ${k} saveResult on a pool contact → ${fam === "support" ? 403 : 404}`, fam === "support" ? refused(r) : r.status === 404, `${r.status}`);
    }
    if (S.otherAttempt && S.otherAttempt.by !== k) {   // never their own: that undo would succeed and move a contact
      const r = await post(k, "/api/calling/undoResult", { AttemptId: S.otherAttempt.id });
      check(`${label} ${k} undo of someone else's call → ${fam === "support" ? 403 : 404}`, fam === "support" ? refused(r) : r.status === 404, `${r.status}`);
    }
    // calling reports (sales_reports): support has none; others never see cost, numbers, the pool, or others' contact names
    for (const [route, body] of [
      ["/api/reports/sales", { GroupBy: "caller", CallListId: S.list }],
      ["/api/reports/sales", { GroupBy: "calllist" }],
      ["/api/reports/salesRows", { GroupBy: "caller", Metric: "dial", CallListId: S.list }],
      ["/api/reports/salesRows", { GroupBy: "calllist", Metric: "dial", CallListId: S.list }],
      ["/api/reports/salesRows", { GroupBy: "calllist", Metric: "contact", CallListId: S.list }],
      ["/api/reports/salesRows", { GroupBy: "caller", Metric: "dial_first", CallListId: S.list }],
    ]) {
      const r = await post(k, route, body);
      const tag = `${label} ${k} ${route} ${body.GroupBy}/${body.Metric ?? "summary"}`;
      if (fam === "support") { check(`${tag} → 403`, refused(r), `${r.status}`); continue; }
      check(`${tag} → 200`, r.status === 200, `${r.status} ${r.body?.message}`);
      const rows = r.body?.data?.rows ?? [];
      check(`${tag} no cost`, rows.every((x) => x.ListCost == null));
      if (route.endsWith("salesRows")) {
        const ownToday = (x) => x.PersonId === id(k);
        check(`${tag} no contact number`, rows.every((x) => x.MobileNo == null), JSON.stringify(rows.filter((x) => x.MobileNo).slice(0, 2)));
        check(`${tag} a contact name only on their own call`, rows.every((x) => x.LeadName == null || ownToday(x) || x.LeadId),
          JSON.stringify(rows.filter((x) => x.LeadName && !ownToday(x)).slice(0, 2).map((x) => ({ p: x.PersonId, n: x.LeadName }))));
        if (body.Metric === "contact") check(`${tag} the pool is not theirs to see (0 rows)`, rows.length === 0 && Number(r.body?.data?.total) === 0, `rows=${rows.length} total=${r.body?.data?.total}`);
      }
      scan(k, r, tag);
    }
  }
}

test("3. leak matrix — every endpoint as all 13 non-owners, after the hand-out", async () => {
  await matrix("m1");
});

test("4. Deeksha (manual, 5): every plain result, the undo, then nothing more comes", async () => {
  const start = await act("deeksha", "/api/calling/myList", { TopUp: 1 }, "myList");
  const mine = ids(start.body?.data?.toCall);
  check("Deeksha sees exactly her 5", same(mine, heldIds("deeksha", "held")) && mine.length === 5, `${mine}`);
  check("Deeksha (hand-out, not on auto) got no top-up", Number(start.body?.data?.head?.Given) === 0);
  const [a, b, c, d, e] = mine;

  let r = await act("deeksha", "/api/calling/saveResult", { ContactId: a, Result: "no_answer", DialedAt: `${today()}T${new Date().toTimeString().slice(0, 8)}` }, "no_answer");
  check("no_answer saved, contact leaves her list", r.status === 200 && !ids(r.body?.data?.toCall).includes(a), `${r.status} ${r.body?.message}`);
  check("no_answer → pool, 1 try", S.byId[a]?.Status === "pool" && S.byId[a]?.Attempts === 1, JSON.stringify({ s: S.byId[a]?.Status, t: S.byId[a]?.Attempts }));
  const att = r.body?.data?.AttemptId;
  check("Done today lists it with no number", (r.body?.data?.done ?? []).some((x) => x.ContactId === a && x.Result === "no_answer" && !("Mobile" in x)));
  S.otherAttempt = { id: att, by: "deeksha" };
  r = await act("deeksha", "/api/calling/undoResult", { AttemptId: att }, "undo");
  check("undo puts it back on her list, tries as before", r.status === 200 && ids(r.body?.data?.toCall).includes(a) && S.byId[a]?.Attempts === 0, `${r.status} ${r.body?.message}`);
  r = await act("deeksha", "/api/calling/undoResult", { AttemptId: att }, "undo twice");
  check("undo twice → 409", r.status === 409, `${r.status}`);
  r = await act("deeksha", "/api/calling/saveResult", { ContactId: a, Result: "no_answer" }, "no_answer again");
  S.otherAttempt = { id: r.body?.data?.AttemptId, by: "deeksha" };
  r = await act("deeksha", "/api/calling/saveResult", { ContactId: b, Result: "busy" }, "busy");
  check("busy → pool, 1 try, not eligible for an hour", r.status === 200 && S.byId[b]?.Status === "pool" && S.byId[b]?.Attempts === 1);
  r = await act("deeksha", "/api/calling/saveResult", { ContactId: c, Result: "not_interested", Notes: "has solar already" }, "not_interested");
  check("not_interested → closed", r.status === 200 && S.byId[c]?.Status === "closed" && S.byId[c]?.CloseReason === "not_interested");
  r = await act("deeksha", "/api/calling/saveResult", { ContactId: d, Result: "wrong_number" }, "wrong_number");
  check("wrong_number → closed", r.status === 200 && S.byId[d]?.Status === "closed" && S.byId[d]?.CloseReason === "wrong_number");
  r = await act("deeksha", "/api/calling/saveResult", { ContactId: e, Result: "dnc" }, "dnc without note");
  check("dnc without a note → 400", r.status === 400, `${r.status}`);
  r = await act("deeksha", "/api/calling/saveResult", { ContactId: e, Result: "dnc", Notes: "Do not call again (test)" }, "dnc");
  check("dnc → closed + a mark on the number", r.status === 200 && S.byId[e]?.Status === "closed" && S.byId[e]?.CloseReason === "dnc");
  const marks = (await must("amit", "/api/phoneMark/fetch", { SearchTerm: S.byId[e].Mobile })).marks ?? [];
  check("dnc mark visible to Amit on the Do not call list", marks.some((m) => m.Mobile === S.byId[e].Mobile && m.Mark === "dnc"));
  const undoDnc = r.body?.data?.AttemptId;
  r = await act("deeksha", "/api/calling/undoResult", { AttemptId: undoDnc }, "undo dnc");
  check("a dnc cannot be undone (409)", r.status === 409, `${r.status}`);
  r = await act("deeksha", "/api/calling/myList", { TopUp: 1 }, "myList after all 5");
  check("after all 5: her list is empty and no batch comes (hand-out, not on auto)", (r.body?.data?.toCall ?? []).length === 0 && heldIds("deeksha").length === 0,
    JSON.stringify(r.body?.data?.head));
  r = await act("deeksha", "/api/calling/saveResult", { ContactId: c, Result: "busy" }, "re-save finished");
  check("acting on a contact she already finished → 409", r.status === 409, `${r.status} ${r.body?.message}`);
  S.deekshaDone = mine;
});

test("5. Roshan (manual, 5): booked callback, the callback cap, callback without a time, interested → lead", async () => {
  const start = await act("roshan", "/api/calling/myList", { TopUp: 1 }, "myList");
  const [a, b, c, d, e] = ids(start.body?.data?.toCall);
  const at = `${today(1)}T16:00:00`;
  let r = await act("roshan", "/api/calling/saveResult", { ContactId: a, Result: "callback", CallbackAt: at, Notes: "call tomorrow 4" }, "callback booked");
  check("timed callback: leaves To call, sits in Callbacks", r.status === 200 && !ids(r.body?.data?.toCall).includes(a) && ids(r.body?.data?.callbacks).includes(a), `${r.status} ${r.body?.message}`);
  check("timed callback stays his (oracle)", S.byId[a]?.Status === "callback" && S.byId[a]?.HeldBy === id("roshan"));
  r = await act("roshan", "/api/calling/saveResult", { ContactId: b, Result: "callback", CallbackAt: at }, "callback over cap");
  check("a second booked callback over the cap (1) → 409", r.status === 409 && /callbacks booked/.test(r.body?.message ?? ""), `${r.status} ${r.body?.message}`);
  r = await act("roshan", "/api/calling/saveResult", { ContactId: b, Result: "callback" }, "callback no time");
  check("callback with no time → back to the pool, no try counted", r.status === 200 && S.byId[b]?.Status === "pool" && S.byId[b]?.Attempts === 0);
  r = await act("roshan", "/api/calling/convert", { ContactId: c, Name: `${S.tag} Roshan lead FAKE`, Notes: "wants 3kW", FirstFollowupAt: `${today(1)}T12:00:00` }, "convert");
  const leadId = r.body?.data?.LeadId;
  check("interested → a lead, contact status lead", r.status === 200 && leadId > 0 && S.byId[c]?.Status === "lead", `${r.status} ${r.body?.message}`);
  const leads = (await must("roshan", "/api/leads/fetchLeads", { SearchTerm: S.byId[c].Mobile, PageSize: 5 })).leads ?? [];
  check("the lead is in Roshan's Leads, his", leads.some((l) => l.Id === leadId && (l.OwnerId ?? l.AssignedTo) === id("roshan")), JSON.stringify(leads.map((l) => ({ i: l.Id, o: l.OwnerId }))));
  const kas = (await must("kasak", "/api/leads/fetchLeads", { SearchTerm: S.byId[c].Mobile, PageSize: 5 })).leads ?? [];
  check("Kasak (Own reach) does not see Roshan's new lead", !kas.some((l) => l.Id === leadId));
  r = await act("roshan", "/api/calling/saveResult", { ContactId: d, Result: "wrong_number" }, "wrong_number");
  r = await act("roshan", "/api/calling/saveResult", { ContactId: e, Result: "busy" }, "busy");
  r = await act("roshan", "/api/calling/saveResult", { ContactId: a, Result: "not_interested", Notes: "kept the callback" }, "make the callback");
  check("making the booked callback closes it", r.status === 200 && S.byId[a]?.Status === "closed" && (r.body?.data?.callbacks ?? []).length === 0);
  check("Roshan now holds nothing", heldIds("roshan").length === 0);
  S.roshanLead = leadId;
});

test("6. Kasak (auto, holds 5): next batch only when all 5 are done; convert of an existing lead's number → 409 + next batch", async () => {
  await snapshot();
  const first = heldIds("kasak", "held");
  check("Kasak still holds her first 5", same(first, S.kasakFirst), `${first} vs ${S.kasakFirst}`);
  const [a, b, c, d, e] = first;
  for (const [x, res] of [[a, "no_answer"], [b, "not_interested"], [c, "busy"]]) {
    const r = await act("kasak", "/api/calling/saveResult", { ContactId: x, Result: res }, res);
    check(`Kasak ${res}: no top-up while she still holds some (Given 0)`, r.status === 200 && Number(r.body?.data?.head?.Given ?? 0) === 0 && heldIds("kasak").length === 5 - [a, b, c].indexOf(x) - 1,
      `${r.status} held=${heldIds("kasak").length} head=${JSON.stringify(r.body?.data?.head)}`);
  }
  let r = await act("kasak", "/api/calling/convert", { ContactId: d, Name: `${S.tag} Kasak lead FAKE` }, "convert");
  check("Kasak interested → lead", r.status === 200 && r.body?.data?.LeadId > 0 && heldIds("kasak").length === 1, `${r.status} ${r.body?.message}`);
  // Her last contact's number becomes someone's lead before she gets to it.
  const eNum = S.byId[e].Mobile;
  await must("amit", "/api/leads/saveLeads", { Id: 0, Name: `${S.tag} lead made meanwhile FAKE`, MobileNo: eNum, FirstFollowupAt: `${today(1)}T11:00:00` });
  r = await act("kasak", "/api/calling/convert", { ContactId: e, Name: "dup" }, "convert existing-lead number");
  check("convert of a number that is already a lead → 409", r.status === 409, `${r.status} ${r.body?.message}`);
  check("that contact is closed as duplicate", S.byId[e]?.Status === "closed" && S.byId[e]?.CloseReason === "duplicate", JSON.stringify({ s: S.byId[e]?.Status, r: S.byId[e]?.CloseReason }));
  const next = ids(r.body?.data?.toCall);
  check("the 409 reply already carries her next batch of 5", next.length === 5 && !next.some((x) => first.includes(x)), `${next}`);
  check("next batch = what the oracle says she holds", same(next, heldIds("kasak", "held")));
  check("next batch overlaps nobody else's contacts", !next.some((x) => (S.deekshaDone ?? []).includes(x)));
  r = await act("kasak", "/api/calling/saveResult", { ContactId: b, Result: "busy" }, "finished one");
  check("Kasak acting on one she finished → 409", r.status === 409, `${r.status}`);
  r = await act("kasak", "/api/calling/saveResult", { ContactId: S.deekshaDone[2], Result: "busy" }, "deeksha's");
  check("Kasak acting on Deeksha's finished contact (never hers) → 404", r.status === 404, `${r.status}`);
  S.kasakNext = next;
});

test("7. leak matrix again, after calls, leads and a callback", async () => {
  await matrix("m2");
});

test("8. manager tools: recall, a do-not-call set on a held number, clear, delete rules, cost", async () => {
  let r = await post("amit", "/api/calling/recall", { CallListId: S.list, FromUserId: id("kasak") });
  check("Amit pulls back Kasak's 5", r.status === 200 && Number(r.body?.data?.Recalled) === 5, JSON.stringify(r.body?.data ?? r.body?.message));
  await snapshot();
  check("after the pull-back Kasak holds nothing", heldIds("kasak").length === 0);
  r = await act("kasak", "/api/calling/myList", { TopUp: 1 }, "after recall");
  const batch = ids(r.body?.data?.toCall);
  check("Kasak's next Calling open tops her up again (5)", batch.length === 5);
  const target = S.byId[batch[0]];
  r = await post("amit", "/api/phoneMark/set", { Mobile: target.Mobile, Mark: "dnc", Note: `${S.tag} manager dnc` });
  check("Amit marks a number Kasak holds do-not-call", r.status === 200, `${r.status} ${r.body?.message}`);
  r = await act("kasak", "/api/calling/myList", { TopUp: 0 }, "after manager dnc");
  check("…it leaves her list at once (closed / dnc)", !ids(r.body?.data?.toCall).includes(target.Id) && S.byId[target.Id]?.CloseReason === "dnc");
  const mark = ((await must("amit", "/api/phoneMark/fetch", { SearchTerm: target.Mobile })).marks ?? [])[0];
  r = await post("neha", "/api/phoneMark/clear", { Id: mark?.Id, ClearNote: "no" });
  check("Neha cannot clear a mark (403)", refused(r), `${r.status}`);
  r = await post("amit", "/api/phoneMark/clear", { Id: mark?.Id, ClearNote: `${S.tag} cleared` });
  check("Amit clears it (200)", r.status === 200, `${r.status} ${r.body?.message}`);
  await snapshot();
  check("clearing does not reopen the closed contact", S.byId[target.Id]?.Status === "closed");

  r = await post("amit", "/api/calling/deleteList", { Id: S.list });
  check("delete a list with calls → 409 (archive instead)", r.status === 409, `${r.status} ${r.body?.message}`);
  const empty = await createList(`${S.tag} empty`);
  for (const k of ["neha", "kasak", "nitin"]) {
    r = await post(k, "/api/calling/deleteList", { Id: empty });
    check(`${k} cannot delete a list (403)`, refused(r), `${r.status}`);
  }
  r = await post("amit", "/api/calling/deleteList", { Id: empty });
  check("Amit deletes an empty list (200)", r.status === 200, `${r.status} ${r.body?.message}`);

  const lists = await must("amit", "/api/calling/fetchLists", { Id: S.list });
  check("Amit (Owner) sees the cost", Number(lists.list.Cost) === 4321, `${lists.list.Cost}`);
  const rep = await must("amit", "/api/reports/sales", { GroupBy: "calllist", CallListId: S.list });
  check("Amit's calling report carries the list cost", (rep.rows ?? []).some((x) => Number(x.ListCost) === 4321), JSON.stringify((rep.rows ?? []).map((x) => x.ListCost)));
  const rows = await must("amit", "/api/reports/salesRows", { GroupBy: "calllist", Metric: "contact", CallListId: S.list, MaxRows: 2000 });
  check("Amit's drill of the list's contacts shows names and numbers", (rows.rows ?? []).length === 51 && rows.rows.every((x) => x.MobileNo), `rows=${(rows.rows ?? []).length}`);
  const dials = await must("amit", "/api/reports/sales", { GroupBy: "caller", CallListId: S.list });
  const by = Object.fromEntries((dials.rows ?? []).map((x) => [x.GroupKey, Number(x.Dials)]));
  // Deeksha 5 live calls (the undone one does not count), Roshan 6 (incl. the 409 cap refusal? no: refused = no call), Kasak 6.
  check("calling report: Deeksha 5 calls, Roshan 6, Kasak 5 (undone and refused calls not counted)",
    by[id("deeksha")] === 5 && by[id("roshan")] === 6 && by[id("kasak")] === 5, JSON.stringify(by));
});

test("9. final sweep: everyone's list is exactly what they hold; nobody else holds anything", async () => {
  await snapshot();
  for (const k of ALL) {
    const r = await post(k, "/api/calling/myList", { TopUp: 0 });
    if (kind(k) === "support") { check(`final ${k} myList 403`, refused(r)); continue; }
    check(`final ${k} sees exactly what they hold`, same(ids(r.body?.data?.toCall), heldIds(k, "held")) && same(ids(r.body?.data?.callbacks), heldIds(k, "callback")),
      `${ids(r.body?.data?.toCall)} vs ${heldIds(k, "held")}`);
    scan(k, r, "final myList");
  }
  const holders = Object.keys(S.held).map(Number);
  check("only Kasak holds contacts now", holders.every((u) => u === id("kasak")), JSON.stringify(holders));
});

test("10. every check passed", () => {
  const failed = rec.rows.filter((r) => !r.pass);
  expect(failed.map((r) => `${r.name} ${r.detail}`), `${failed.length} of ${rec.rows.length} checks failed`).toEqual([]);
});
