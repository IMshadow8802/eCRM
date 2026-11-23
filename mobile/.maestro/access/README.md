# Access-model flows (plan 2026-11-22, Task 30)

One flow per role, on the Android emulator, against the **local** backend on
the **TestCRM** database (owner ruling L3). Not in `../config.yaml`: each flow
needs its persona signed in, and `run.sh` does that.

## Before

- Local backend on `http://localhost:5001`, pointed at TestCRM.
- `backend/.env.live` (the owner's: `LIVE_BASE_URL`, `LIVE_PASSWORD`).
- `mobile/.env.local` = `EXPO_PUBLIC_API_BASE_URL=http://localhost:5001`.
- Emulator up (`-gpu host`; SwiftShader hangs it), dev client installed,
  Metro on 8081: `pnpm exec expo start --dev-client --port 8081`.

## Run

```bash
mobile/.maestro/access/run.sh                       # every flow, in order
mobile/.maestro/access/run.sh agent-vinod agent-vivek   # some (fresh records still)
DEVICE=emulator-5554 SHOTS=/some/dir mobile/.maestro/access/run.sh
```

Each run first creates its **own** records (`live.js run` ->
`backend/tests/live/fixtures.js` `createRun()`, ids in the git-ignored
`mobile/.maestro/.run.json`) and marks AM Vinod "Away today"; the mark is
removed on exit. Static seed rows are never used. Two runs back to back need
nothing in between.

The personas' password is read from `backend/.env.live` by `run.sh` and passed
to `sign-in.yaml` as Maestro env — never written to a flow. Maestro's logs
record typed text, so they go to a temp dir deleted on exit; only the
screenshots are copied to `$SHOTS` (printed at the end).

## Order and what each proves

| Persona | Flow | Proves |
|---|---|---|
| am_nitin (agent, no team: desk) | `desk-nitin` | §4 words; "Assign to" lists field staff only, AM Vinod marked "Away today"; toast "Logged and assigned to AM Vinod" and the list stays; "Logged by me" lists it, tapping does nothing; a row he cannot open (C07) does nothing |
| am_vinod (agent with team) | `agent-vinod` | C01 in Mine; Reassign: grouped picker ("Your manager and team"), holder not offered, search "viv" narrows; "Reassign to AM" -> list, C01 gone |
| | `agent-vinod-open-c08` -> `live.js active nitin 0` -> `agent-vinod-send-back-refused` | menu "Send back to AM Nitin"; the giver deactivated while open: 403 with the server's "… can no longer take this. Reassign it instead.", the record stays, the menu drops the item |
| | `agent-vinod-open-c15` -> `live.js move C15 vivek` -> `agent-vinod-gone` | stale screen: "On hold" answers 404, back on the list, "This record is no longer with you" |
| am_vivek (agent) | `agent-vivek` | menu "Send back to AM Vinod" + remarks -> "Sent back to AM Vinod", gone |
| am_rohit (team lead) | `teamlead-rohit` | Team shows Vinod's C09; Escalate lists seniors; Escalated opens C04 "Escalated to AM Rohit" |
| am_neha (manager) | `manager-neha` | Unassigned lists C02; Reassign picker grouped, AM Vinod "Away today" |
| am_amit (admin) | `admin-amit` | other office's C16 in Team; picker has "Other offices" |
| am_kasak (sales exec) | `sales-kasak` | "Assigned to"; Reassign lead -> AM Roshan -> list, search finds nothing; Follow-ups -> All has no row |
| am_roshan (sales exec) | `sales-roshan` | L01 with its follow-up; menu "Send back to AM Kasak" |
| am_field (sales exec) | `field-via2` | a follow-up delegated to him on a lead he cannot see (Via 2): in Upcoming, the row does not open the lead, Done works |

Personas are named "AM <Name>", so a first-name button reads "Reassign to AM" /
"Send back to AM" (seed naming, as in the web flows).
