# Mobile redesign — shared brief for the design directions

Every direction draws the **same screens with the same content**, so the user can compare them side by side and pick or mix.

## Product

Nexus CRM, an Android + iOS app for Indian company employees (React Native, Inter font, lucide icons). There are three kinds of work, and most people use only one or two:
- **Tasks:** workspaces, boards and columns, checklists, comments, and deadlines that track delay (TAT).
- **Complaints:** customer tickets with statuses open, on hold, resolved, closed and rejected; priority, TAT due/overdue, escalation, transfer and logged calls.
- **Leads:** sales pipeline statuses (new, contacted, qualified, proposal, won, lost); follow-ups such as calls and visits; estimated value in ₹.

## Hard rules (every direction)

- **Solid colours only.**
  - No `rgba`, opacity, translucency, glass or blur.
  - The one exception is the modal scrim behind dialogs and sheets.
  - A gradient is allowed only as a brand backdrop on the company-code and sign-in screens.
- **Icons:** lucide only, as inline SVG with stroke 2 and round caps/joins. No emoji in the UI.
- **Font:** Inter, CSS `font-family: Inter, -apple-system, "Segoe UI", Roboto, sans-serif`.
  - No external font fetch.
  - Weights 400, 500, 600 and 700 only.
  - Tabular numerals (`font-variant-numeric: tabular-nums`) for counts, money and times.
- **"Sorbet" chips:** a soft, solid pastel fill with the same hue's dark shade for the text and icon. Text must be at least 4.5:1 contrast on its fill; state the hex values. No outlined, grey-only or "simple strip" chips.
- **Card is the only raised surface.** Depth comes from the background-to-card contrast. A shadow may be a whisper, never the structure.
- **Indian content:**
  - Money in en-IN format: ₹1,20,000.
  - 10-digit mobiles: 98250 12345.
  - Dates as `2 Nov` and `Mon, 2 Nov`.
  - IST times: 4:30 pm.
- **Pixel-perfect:** real spacing on a 4 px grid, real type sizes, and real status-bar and home-indicator areas. Use realistic text lengths, including one long name that has to ellipsize. Nothing lorem.

## Navigation (decided)

- **Bottom tabs come from the person's access.** The full set is: Home ("Today") · Tasks · Complaints · Leads · More.
  - For a leads-only user, Follow-ups is its own tab.
  - Inbox is a bell with a badge in the Home header.
  - More holds Inbox, Workspaces, Follow-ups, Profile and Sign out.
  - **Each direction must invent its own bottom-bar style.**
- **Tablet:**
  - Navigation rail on the left.
  - Lists and their details side by side (two panes).
  - Forms in a centred column of at most 640 px.
  - Layouts adapt to the space; never magnify the phone UI.

## Screens to draw (phone 390×844, all of them, in this order)

1. **Company code:** asks for the company code (example: TestCRM), with a Continue button.
2. **Sign in:** shows the tenant name "PRD Infotech (Test)" and a logo placeholder; username and password (masked) fields; a Sign in button; "Not PRD Infotech (Test)? Switch company"; and the footer "Nexus CRM · v1.0.0".
3. **Sign-in error state:** shows "Wrong username or password" inline in the form.
4. **Home "Today":**
   - Greeting "Good afternoon, Ayush" with a lucide Hand icon, the date "Monday, 2 November", and the bell with badge 63.
   - Cards:
     - Tasks: 3 assigned to you, 1 needs you.
     - Complaints: 7 open mine, 2 overdue.
     - Follow-ups: 4 due today.
   - A short "Needs you" list of 2 items.
5. **Tasks / My Work:** filters Mine / Unassigned / All. Three task cards:
   - "manohar lal jewellers south ex Gullak", Ayush's Tasks, To Do, 0 of 1, medium.
   - "Manohar Lal Jewellery Preet Vihar", In Progress, 8 of 9, medium, with 2 assignee avatars.
   - "BITME", 11 of 12, high, deadline chip "Due in 3 h".
6. **Workspaces list:** Ayush's Tasks (personal), Sales Ops (shared, 6 members), Website Revamp (project).
7. **Board:** Sales Ops, with columns To Do (4), In Progress (2) and Done (7) and cards inside. Horizontal paging on the phone; show the first column plus a peek of the next.
8. **Task detail:** title, workspace/column, assignees and priority. Tabs: Details · Checklist · Comments · Deadline. Show the Checklist tab with 3 of 5 done and a progress bar.
9. **Task Deadline tab:**
   - A TAT clock with the chip "Missed deadline".
   - The reason given: "Waiting on client".
   - A timeline with Started, Held, Due and Breached entries.
   - "Explain delay" button.
10. **Complaints list:**
    - Presets Mine · Team · Overdue · Escalated, with counts.
    - Status filter chips.
    - Search.
    - 5 rows, each with: number C-1042, customer "Sharma Electronics, Karol Bagh", subject "AC not cooling after service", status chip, priority, and due "Overdue 2 h" or "Due 5:30 pm".
    - At least one row is escalated.
11. **Complaint detail:**
    - Header with number and status.
    - Customer card with name, contact person, mobile and a call button.
    - Facts: category, priority, assigned to, due.
    - Action bar: Log call · On hold · Resolve · Transfer · Escalate.
    - Activity history with 4 entries.
12. **New complaint form:**
    - Customer search/select showing "Add new customer".
    - Subject, description, category, priority, and attachments (2 files staged, one image thumbnail, one PDF).
    - Submit.
13. **Bottom sheet "Resolve complaint":** resolution select, remarks (required, marked with a star), and Save. Show the keyboard open with the sheet above it.
14. **Leads list:**
    - Header "12 yours".
    - Filters: Mine / All / Overdue / New.
    - 5 lead cards: name, company, product, status chip, ₹ value and next follow-up. For example: "Rohit Verma, Verma Textiles, Solar 5 kW, Qualified, ₹1,20,000, Call tomorrow 11:00 am".
15. **Lead detail:**
    - Status chip with a change-status control.
    - Value, owner, source, mobile with call and WhatsApp-style message buttons (lucide icons only).
    - Tabs: Details · Follow-ups · Activity. Show Follow-ups with the next one highlighted.
    - Main action: Log follow-up.
16. **Lead form:** name and mobile (required, starred); alternate mobile, company, source, product, estimated value, status, owner, first follow-up (Tomorrow / In 3 days / Pick date / None), and a custom field "Roof type".
17. **Follow-ups queue:**
    - Views Today (4) · Overdue (2) · Upcoming.
    - Rows: lead name, type (call or visit), time and a Done action.
18. **Inbox:** grouped Today / Earlier. Notification rows for escalation, assignment, comment and TAT warn; unread rows marked.
19. **More / Profile:** avatar, name "Ayush Mishra", role "Admin", office "Head Office". Then rows for Inbox, Workspaces, Follow-ups, Change password and Sign out. Version at the bottom.
20. **States:**
    - Empty: "No complaints here" with an illustration made of lucide icons, not clip-art.
    - Loading skeleton: solid blocks.
    - Error: "Could not load. Try again".
21. **Confirm dialog:** "Delete this comment?" with Cancel / Delete in danger red.

## Tablet (1194×834 landscape), after the phone set

- **T1 Home:** with the rail; cards in 3 columns.
- **T2 Complaints:** list and detail in two panes (screens 10 + 11 together).
- **T3 Lead detail:** two panes, leads list plus detail.
- **T4 Lead form:** as a centred column.

## Output format

- One self-contained HTML file per direction:
  - Inline CSS and inline SVG.
  - No network requests.
  - No JavaScript needed, though JS for tab switching is allowed.
- A sticky header with the direction name and its palette and type ramp: swatches with hex values, and the chip tones table.
- Every screen in a device frame of exactly 390×844 (tablet 1194×834) with a caption.
- Laid out in a responsive grid of frames, wrapping, readable on a laptop.

## User references (2026-11-02): follow their spirit, but in solid colours

Copies of the images are in the session folder `images/1.png`, `2.png` and `3.png`. Read them if you can.

**Ref 1: HR app, purple and black.**
- A black or dark header band with avatar, name and role, a bell in a round button, and a greeting line ("Welcome! Refreshing Monday.").
- A white sheet with rounded top corners overlaps that band.
- A solid hero card in the primary colour with a date pill and two big values side by side. For us: today's work summary, e.g. "7 open complaints · 2 overdue", or a TAT clock.
- 2×2 stat tiles, each with a round coloured icon badge, a label and a big number.
- A "What's up today" list with "See all".
- A raised round "+" centred above the bottom bar.
- Filter pills with counts ("All (65)", "Sales (8)").
- Tinted segmented pills ("Attend / Late / Leave").
- A profile screen with a dark band, a large centred avatar and name, then settings rows with coloured icons.

**Ref 2: Meetings app, airy.**
- A huge greeting in two lines: "Good morning" in ink, then the name in grey.
- Round icon buttons (settings, bell, search) at the top.
- Large white cards with a big label and an arrow; a card for "Current item" with a "now" chip.
- Number tiles: a big number with a label underneath and an arrow.
- A horizontal carousel of upcoming cards.
- A large page title ("Meetings") with an inline rounded search field.
- A text tab row with a leading "+".
- The bottom bar is an icon-only floating pill, plus a separate round FAB to its right.

**Ref 3: Health app, sorbet bento.**
- Big pastel tiles in pink, peach, lavender, mint and coral. Each has a title, a sub-line, an icon in a white circle top-right, and "Check →" at the bottom.
- A large stat card with big numerals in a row (62.5 · 23.6 · 45.7 · 14%).
- An avatar with "Hello, Rownok!", and round search and bell buttons.
- A floating pill bottom bar whose active icon sits in a tinted rounded square.
- Detail screens with text segmented tabs (Days / Weeks / Months) and a row of tinted stat chips.

**Translation rules.** The references use translucent tints, glows and gradients; we do not.
- Every tint becomes a solid hex.
- Every glow or shadow is at most a whisper.
- A gradient may appear only on the company-code and sign-in backdrop.
- Use real photos nowhere: avatars are initials on sorbet circles, or lucide-icon presets.
