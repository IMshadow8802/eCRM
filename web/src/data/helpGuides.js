// Bilingual (Hindi default, English toggle) how-to guides shown by the
// HelpGuide "?" button on the main working screens. Each step has {hi, en}.
export const HELP_GUIDES = {
  tasks: {
    titleHi: "टास्क कैसे इस्तेमाल करें",
    titleEn: "How to use Tasks",
    sections: [
      {
        headingHi: "अपने लिए (Personal board)",
        headingEn: "For yourself (Personal board)",
        steps: [
          {
            hi: "अपना Personal workspace इस्तेमाल करें (ऊपर-बाएं workspace switcher से) — इसे सिर्फ आप देख सकते हैं, admin भी नहीं।",
            en: "Use your Personal workspace (top-left workspace switcher) — only you can see it, not even an admin.",
          },
          {
            hi: "किसी कॉलम में 'Add task' पर क्लिक करें; personal board के टास्क अपने आप आपको assign हो जाते हैं।",
            en: "Click 'Add task' in a column; tasks on a personal board are auto-assigned to you.",
          },
          {
            hi: "टास्क के अंदर checklist जोड़ें — सभी आइटम पूरे होने पर टास्क अपने आप complete हो जाता है।",
            en: "Add a checklist inside a task — it auto-completes when every item is checked.",
          },
          {
            hi: "स्टेटस बदलने के लिए कार्ड को एक कॉलम से दूसरे में खींचें (drag)।",
            en: "Drag a card between columns to change its status.",
          },
        ],
      },
      {
        headingHi: "अपनी टीम के लिए (Shared / Project board)",
        headingEn: "For your team (Shared / Project board)",
        steps: [
          {
            hi: "Shared workspace बनाकर लोगों को invite करें (उन्हें invite accept करना होगा) — या Project workspace बनाएं जो किसी project की team से members अपने आप ले लेता है।",
            en: "Create a Shared workspace and invite people (they must accept the invite) — or a Project workspace, which pulls members from a project's team automatically.",
          },
          {
            hi: "shared/project टास्क में 'Assignee' फ़ील्ड से टास्क किसी साथी को दें।",
            en: "In a shared/project task, use the 'Assignee' field to give it to a teammate.",
          },
          {
            hi: "members जोड़ना/हटाना सिर्फ workspace का Owner ही कर सकता है।",
            en: "Only the workspace Owner can add or remove members.",
          },
        ],
      },
      {
        headingHi: "कौन क्या कर सकता है (Roles)",
        headingEn: "Who can do what (Roles)",
        steps: [
          {
            hi: "Owner / Manager: उस बोर्ड के किसी भी टास्क पर पूरा नियंत्रण — बनाना, एडिट, reassign, delete।",
            en: "Owner / Manager: full control over any task on that board — create, edit, reassign, delete.",
          },
          {
            hi: "Member: नए टास्क बना सकते हैं, और सिर्फ अपने बनाए टास्क पूरी तरह एडिट कर सकते हैं; सभी पर comment कर सकते हैं।",
            en: "Member: can create tasks and fully edit only the tasks they created; can comment on all.",
          },
          {
            hi: "Viewer: सिर्फ देख और comment कर सकते हैं।",
            en: "Viewer: can only view and comment.",
          },
          {
            hi: "किसी और के टास्क को assign/reassign करने के लिए Owner/Manager होना ज़रूरी है (या उस टास्क का creator होना)।",
            en: "Assigning/reassigning someone else's task needs Owner/Manager (or being that task's creator).",
          },
        ],
      },
      {
        headingHi: "कार्ड पर डेडलाइन चिप",
        headingEn: "Deadline chip on cards",
        steps: [
          { hi: "'Due 17:30 IST': आख़िरी समय। पीला हो जाए तो समय लगभग खत्म है।", en: "'Due 17:30 IST': the deadline. If it turns amber, time is almost up." },
          { hi: "'Late by 25m': आख़िरी समय निकल चुका है, इतनी देर हो गई।", en: "'Late by 25m': the deadline has passed by this much." },
          { hi: "'On hold: ...': टाइमर रुका है, साथ में कारण लिखा है। विवरण में 'Deadline' टैब में पूरा हाल देखें।", en: "'On hold: ...': the timer is paused, with the reason. Open the 'Deadline' tab in the task for the full story." },
        ],
      },
      {
        adminOnly: true,
        headingHi: "आप Admin हैं",
        headingEn: "You are an Admin",
        steps: [
          {
            hi: "आप अपनी company के किसी भी Shared/Project बोर्ड के किसी भी टास्क को — चाहे किसी ने भी बनाया हो — बना, एडिट, reassign, move और delete कर सकते हैं।",
            en: "You can create, edit, reassign, move and delete ANY task on any Shared/Project board in your company — no matter who created it.",
          },
          {
            hi: "किसी भी टास्क के 'Assignee' फ़ील्ड से उसे किसी भी user को assign करें।",
            en: "Use the 'Assignee' field on any task to assign it to any user.",
          },
          {
            hi: "फिर भी किसी का Personal workspace आप नहीं देख/छू सकते — वे हमेशा private रहते हैं।",
            en: "You still cannot see or touch anyone's Personal workspace — those are always private.",
          },
        ],
      },
    ],
  },
  leads: {
    titleHi: "लीड कैसे मैनेज करें",
    titleEn: "How to manage Leads",
    steps: [
      {
        hi: "Status / Owner / Product / Source फ़िल्टर और presets (My leads, Overdue, Unassigned) से लीड्स ढूँढें।",
        en: "Use the Status / Owner / Product / Source filters and the presets (My leads, Overdue, Unassigned) to find leads.",
      },
      {
        hi: "किसी लीड की पंक्ति (row) पर क्लिक करके उसका विवरण, custom fields और activity timeline देखें।",
        en: "Click a lead row to open its detail — core info, custom fields and activity timeline.",
      },
    ],
  },
  partners: {
    titleHi: "पार्टनर और कमीशन कैसे मैनेज करें",
    titleEn: "How to manage Partners and commission",
    steps: [
      {
        hi: "Add partner से उन लोगों/फर्मों को जोड़ें जो आपको लीड भेजते हैं; चाहें तो उनका सामान्य कमीशन (% या तय रकम) भी भरें।",
        en: "Use Add partner for people or firms who send you leads. You can set their usual commission (a percent or a fixed amount).",
      },
      {
        hi: "लीड बनाते समय पार्टनर चुनें। लीड convert होने पर कमीशन Commissions टैब में 'Earned' दिखता है।",
        en: "Pick the partner on a lead. When the lead converts, the commission shows as 'Earned' in the Commissions tab.",
      },
      {
        hi: "Earned पंक्तियाँ चुनकर 'Ready to pay' करें, फिर भुगतान के बाद 'Mark paid' से तारीख और रेफरेंस (UTR / चेक नंबर) लिखें।",
        en: "Select Earned rows and press 'Ready to pay'. After you pay, press 'Mark paid' and enter the date and reference (UTR / cheque no.).",
      },
    ],
  },
  followups: {
    titleHi: "फॉलो-अप कैसे इस्तेमाल करें",
    titleEn: "How to use Follow-ups",
    steps: [
      {
        hi: "फॉलो-अप लीड्स के साथ तय की गई अगली बातचीत (touchpoints) होती है।",
        en: "Follow-ups are your scheduled next touchpoints with leads.",
      },
      {
        hi: "Today / Overdue / Upcoming टैब से देखें कि आज क्या करना है, क्या देर हो चुका है, और आगे क्या आ रहा है।",
        en: "Use the Today / Overdue / Upcoming tabs to see what is due now, what is late, and what is next.",
      },
      {
        hi: "बातचीत होने पर Log करें (remarks ज़रूरी हैं); नहीं हो पाई तो कारण के साथ Skip करें।",
        en: "Log a follow-up once it happens (remarks are required); Skip it with a reason if it didn't.",
      },
    ],
  },
  reports: {
    titleHi: "रिपोर्ट कैसे पढ़ें",
    titleEn: "How to read a report",
    steps: [
      {
        hi: "ऊपर की chips से अवधि चुनें (7 / 30 / 90 दिन, यह महीना, या Custom तारीखें); Branch / Owner / Source / Product फ़िल्टर संख्याओं को और सीमित करते हैं — कभी बढ़ाते नहीं।",
        en: "Pick a period with the chips (7 / 30 / 90 days, this month, or Custom dates); the Branch / Owner / Source / Product filters narrow the numbers — they never widen them.",
      },
      {
        hi: "'Group by' टैब से तालिका को source, owner, product, branch आदि के हिसाब से तोड़ें; ऊपर की टाइलें पूरी अवधि का कुल दिखाती हैं।",
        en: "Use the 'Group by' tabs to break the table down by source, owner, product, branch and so on; the tiles above show the total for the whole period.",
      },
      {
        hi: "किसी पंक्ति पर क्लिक करके उसी अवधि और फ़िल्टर के साथ Leads सूची खोलें — हर संख्या जाँची जा सकती है। 'Export CSV' तालिका डाउनलोड करता है। पेज का URL साझा करने पर वही रिपोर्ट, वही फ़िल्टर खुलते हैं।",
        en: "Click a row to open the Leads list with the same period and filters — every number can be inspected. 'Export CSV' downloads the table. Sharing the page URL opens the same report with the same filters.",
      },
    ],
  },
  tickets: {
    titleHi: "शिकायतें (Tickets) कैसे संभालें",
    titleEn: "How to handle complaints (Tickets)",
    steps: [
      {
        hi: "ऊपर के टैब से अपनी सूची चुनें — My queue (मुझे सौंपी गई), My team, Unassigned, Overdue (समय सीमा पार), Escalated, On hold, Closed, All। Status / Priority / Category / Channel / Product / Assignee / Branch फ़िल्टर और तारीख सीमा से और छाँटें।",
        en: "Pick a list from the tabs — My queue (assigned to me), My team, Unassigned, Overdue (past due), Escalated, On hold, Closed, All. Narrow further with the Status / Priority / Category / Channel / Product / Assignee / Branch filters and the date range.",
      },
      {
        hi: "'New ticket' में ग्राहक का मोबाइल या नाम टाइप करें — मौजूदा ग्राहक चुनें या '+ New customer' से तुरंत बनाएं। विषय, category, priority (priority से due date तय होती है), channel, product, विवरण और फ़ोटो जोड़ें।",
        en: "In 'New ticket' type the customer's mobile or name — pick an existing customer or create one inline with '+ New customer'. Add the subject, category, priority (the priority sets the due date), channel, product, description and photos.",
      },
      {
        hi: "समय सीमा पार होने पर शिकायत हर सूची में लाल 'overdue' दिखती है और मैनेजर को Escalated में मिलती है। किसी वरिष्ठ को सीधे भेजने के लिए 'Escalate' दबाएं (remarks ज़रूरी) — शिकायत आपके पास ही रहती है, वरिष्ठ को सूचना जाती है।",
        en: "Past its due date a complaint shows a red 'overdue' on every list and appears in the manager's Escalated tab. To flag a senior directly press 'Escalate' (remarks required) — the complaint stays with you, the senior is notified.",
      },
      {
        hi: "'Transfer' से शिकायत किसी और को दें — कारण और remarks ज़रूरी हैं और इतिहास में दर्ज होते हैं। सूची में कई शिकायतें चुनकर एक साथ 'Reassign' करें।",
        en: "Use 'Transfer' to hand a complaint to someone else — a reason and remarks are required and go into its history. Select several rows in the list to 'Reassign' them together.",
      },
      {
        hi: "शीर्षक के status ड्रॉपडाउन से जीवनचक्र चलाएं: Resolved के लिए resolution + remarks, Rejected के लिए remarks, Closed = ग्राहक ने पुष्टि की। बंद शिकायत को Reopen सिर्फ़ मैनेजर कर सकता है (remarks के साथ) — due date फिर से शुरू होती है।",
        en: "Drive the lifecycle from the status dropdown in the header: Resolved needs a resolution + remarks, Rejected needs remarks, Closed = the customer confirmed. Only a manager can Reopen a closed complaint (with remarks) — the due date restarts.",
      },
      {
        hi: "Customers पेज पर हर ग्राहक की प्रोफ़ाइल और उसकी सारी शिकायतें देखें; शिकायत के ग्राहक कार्ड से 'N previous complaints' पर क्लिक करके वहीं पहुँचें।",
        en: "The Customers page shows every customer's profile and all their complaints; click 'N previous complaints' on a complaint's customer card to get there.",
      },
    ],
  },
  today: {
    titleHi: "आज का पेज कैसे पढ़ें",
    titleEn: "How to read the Today page",
    sections: [
      {
        headingHi: "Mine और My team",
        headingEn: "Mine and My team",
        steps: [
          {
            hi: "'Mine' आपका अपना दिन है: ऊपर की पट्टी में शिफ़्ट, साइन-इन, Online today, Done today और Open tasks। 'Needs you now' (लाल) में वही काम हैं जिन पर अभी ध्यान चाहिए — पहले जिनका कारण बताना है, फिर Overdue, फिर Close to deadline।",
            en: "'Mine' is your own day: the strip shows your shift, sign-in, Online today, Done today and Open tasks. 'Needs you now' (red) lists what needs you first — delays waiting for your reason, then Overdue, then Close to deadline.",
          },
          {
            hi: "'My team' तभी दिखता है जब आपके नीचे लोग हों। ऊपर की टाइलें (In now, Not signed in, Late, On leave / on duty, Overdue tasks, Close to deadline, Waiting for your ruling) पर क्लिक करके नीचे की सूची छाँटें; दोबारा क्लिक करने पर हट जाता है। आपका अपना कार्ड 'You' नाम से सबसे ऊपर रहता है।",
            en: "'My team' appears only if you have people to manage. Click a tile (In now, Not signed in, Late, On leave / on duty, Overdue tasks, Close to deadline, Waiting for your ruling) to narrow the people below; click it again to clear. Your own card is pinned first, labelled 'You'.",
          },
          {
            hi: "हर संख्या पर क्लिक करें — उसके पीछे के टास्क की सूची खुलती है, हर टास्क का लिंक साथ में।",
            en: "Every number opens its list: click it to see the tasks behind it, each with a link to the task.",
          },
          {
            hi: "'Day' से पुरानी तारीख चुन सकते हैं। पुराने दिन के लिए साइन-इन, Given और Done उसी दिन के होते हैं; Open, Working on, Overdue जैसी अभी की गिनतियाँ सिर्फ़ आज के लिए दिखती हैं ('Live counts only for today')। 'Start tracking from' से पहले का कुछ भी दर्ज नहीं है।",
            en: "Use 'Day' to pick an earlier date. On a past day, sign-ins, Given and Done are for that day; live counts such as Open, Working on and Overdue show only for today ('Live counts only for today'). Nothing is recorded before the 'Start tracking from' date.",
          },
          {
            hi: "Online today = उस दिन ऐप कितनी देर खुला रहा। यह अनुमान है (हर 2 मिनट पर जाँच), काम के घंटे नहीं।",
            en: "Online today = how long the app was open that day. It is approximate (checked every 2 minutes), not hours worked.",
          },
        ],
      },
      {
        headingHi: "टास्क की गिनती",
        headingEn: "Task counts",
        steps: [
          { hi: "Given today: आज उस व्यक्ति को दिए गए टास्क। Done today: आज पूरे हुए (या उसने अपना हिस्सा पूरा किया)।", en: "Given today: tasks given to the person today. Done today: tasks finished today (or their part marked done)." },
          { hi: "Open: जो टास्क अभी पूरे नहीं हुए।", en: "Open: tasks not finished yet." },
          { hi: "Working on: खुला टास्क जिसे व्यक्ति ने Accept किया है या जिसका कम से कम एक step टिक है।", en: "Working on: an open task the person has accepted, or with at least one step ticked." },
          { hi: "Not started: खुला टास्क जिस पर अभी काम शुरू नहीं हुआ (Accept नहीं, कोई step टिक नहीं)।", en: "Not started: an open task with no work begun yet (not accepted, no step ticked)." },
          { hi: "Overdue: खुला टास्क जिसकी डेडलाइन निकल गई।", en: "Overdue: an open task past its deadline." },
          { hi: "Close to deadline: दिए गए समय का ज़्यादातर हिस्सा निकल चुका है; जल्दी न हुआ तो डेडलाइन निकल जाएगी।", en: "Close to deadline: most of the allowed time is used up. It will miss the deadline if not finished soon." },
          { hi: "On hold: टाइमर रुका हुआ है — कारण साथ में दिखता है।", en: "On hold: the timer is paused — the reason is shown with it." },
          { hi: "Waiting for reason: डेडलाइन निकल गई और व्यक्ति ने अभी कारण नहीं बताया।", en: "Waiting for reason: the deadline was missed and the person has not yet said why." },
          { hi: "Waiting for your ruling: व्यक्ति ने देरी का कारण बता दिया है और आपको तय करना है कि देरी माफ़ (excused) है या नहीं।", en: "Waiting for your ruling: the person gave a reason for the delay and you have to decide whether it is excused." },
        ],
      },
      {
        headingHi: "स्थिति (Status) का मतलब",
        headingEn: "What each status means",
        steps: [
          { hi: "Online: अभी ऐप खुला है और चल रहा है।", en: "Online: the app is open and active right now." },
          { hi: "Offline: आज साइन-इन हुए थे, पर अभी ऐप बंद है या कुछ देर से कोई गतिविधि नहीं।", en: "Offline: signed in today, but the app is closed or has been quiet for a while." },
          { hi: "Signed out: आपने खुद साइन-आउट किया।", en: "Signed out: the person signed out on purpose." },
          { hi: "Not signed in yet: काम का समय अभी शुरू नहीं हुआ या 'Count as late after' के मिनट चल रहे हैं, इसलिए अभी साइन-इन न होना ठीक है।", en: "Not signed in yet: work has not started yet, or the 'Count as late after' minutes are still running, so no sign-in is fine for now." },
          { hi: "Not signed in: काम का समय शुरू हो चुका है और व्यक्ति आज साइन-इन नहीं हुआ।", en: "Not signed in: work time has started and the person has not signed in today." },
          { hi: "On time / Late 12m: साइन-इन समय पर हुआ, या 'Count as late after' के मिनट के बाद इतनी देर से।", en: "On time / Late 12m: signed in on time, or this late after the 'Count as late after' minutes." },
          { hi: "On leave / first half / second half: मैनेजर ने पूरा दिन या आधा दिन छुट्टी दर्ज की है।", en: "On leave / first half / second half: a manager marked the whole day or half the day as leave." },
          { hi: "On duty: व्यक्ति ऑफिस से बाहर काम पर है। इसे उपस्थित (present) गिना जाता है।", en: "On duty: the person is working away from the office. It counts as present." },
          { hi: "Holiday: उस दिन कंपनी की छुट्टी है, किसी से साइन-इन की उम्मीद नहीं।", en: "Holiday: the company is closed that day, so nobody is expected to sign in." },
          { hi: "Not tracked: इस व्यक्ति के साइन-इन पर नज़र नहीं रखी जाती।", en: "Not tracked: this person's sign-ins are not watched." },
        ],
      },
      {
        headingHi: "Leave / on duty और Sign-ins",
        headingEn: "Leave / on duty and Sign-ins",
        steps: [
          {
            hi: "'Leave / on duty': मैनेजर किसी की किसी तारीख के लिए छुट्टी (On leave) या ऑफिस से बाहर काम (On duty) दर्ज करता है — पुरानी तारीख भी चलती है। 'For' में पूरा दिन, पहला आधा (सुबह) या दूसरा आधा (दोपहर) चुन सकते हैं; 'Type' में छुट्टी या ऑफिस से बाहर काम। यह सिर्फ़ वही कर सकता है जिसे उस व्यक्ति पर अधिकार है; गलती हो तो 'Remove mark' से हटाएं।",
            en: "'Leave / on duty': a manager records leave (On leave) or working away from office (On duty) for a person on a date, past dates included. Under 'For' pick full day, first half (morning) or second half (afternoon); under 'Type' pick leave or on duty. Only someone who manages that person can do it; use 'Remove mark' to undo a mistake.",
          },
          {
            hi: "'Sign-ins' (सिर्फ़ Admin): उस व्यक्ति के साइन-इन का इतिहास (कौन सा डिवाइस, कब) दिखता है। 'Sign out everywhere' दबाने पर वह हर जगह से साइन-आउट हो जाता है और दोबारा साइन-इन करना होगा — जैसे फ़ोन खो जाए तो।",
            en: "'Sign-ins' (Admin only): shows the person's sign-in history (which device, when). 'Sign out everywhere' signs them out everywhere so they must sign in again, for example if a phone is lost.",
          },
        ],
      },
    ],
  },
  taskTat: {
    titleHi: "टास्क की डेडलाइन कैसे समझें",
    titleEn: "How a task's deadline works",
    sections: [
      {
        headingHi: "डेडलाइन टाइमर क्या है",
        headingEn: "What the deadline timer is",
        steps: [
          { hi: "टास्क किसी को देने पर उसका टाइमर शुरू होता है। टाइमर सिर्फ़ उस व्यक्ति के शिफ़्ट के काम के घंटों में चलती है।", en: "When a task is given to someone, their timer starts. It runs only during that person's working hours on their shift." },
          { hi: "लंच/ब्रेक, साप्ताहिक छुट्टी, कंपनी की छुट्टियाँ और व्यक्ति की छुट्टी का समय नहीं गिना जाता।", en: "Breaks, weekends, company holidays and the person's leave are not counted." },
          { hi: "हर व्यक्ति का अपना टाइमर होता है, इसलिए एक टास्क में कई टाइमर हो सकते हैं।", en: "Each person has their own timer, so one task can have several timers." },
        ],
      },
      {
        headingHi: "टाइमलाइन के शब्द",
        headingEn: "Timeline words",
        steps: [
          { hi: "Assigned: टास्क इस व्यक्ति को कब मिला।", en: "Assigned: when the task was given to this person." },
          { hi: "Seen: व्यक्ति ने इसे पहली बार कब खोला।", en: "Seen: when the person first opened it." },
          { hi: "Accepted: व्यक्ति ने 'मैंने देख लिया, मैं करूँगा' कब बताया।", en: "Accepted: when the person confirmed 'I have seen this and will do it'." },
          { hi: "Due: यही आख़िरी समय है जब तक काम होना चाहिए।", en: "Due: the time by which the work should be done." },
          { hi: "Missed deadline: तय समय निकल गया और काम पूरा नहीं हुआ (या देर से हुआ)।", en: "Missed deadline: the due time passed before the work was finished." },
          { hi: "Running / Missed deadline / On hold / Done: टाइमर की मौजूदा स्थिति — चल रहा है / डेडलाइन निकल गई / रुका है / काम पूरा।", en: "Running / Missed deadline / On hold / Done: the current state of the timer: ticking, late, paused, or finished." },
        ],
      },
      {
        headingHi: "बटन और कौन इस्तेमाल कर सकता है",
        headingEn: "Buttons and who can use them",
        steps: [
          { hi: "Accept task: टास्क पाने वाला व्यक्ति बताता है कि उसने देख लिया।", en: "Accept task: the person who got the task says they have seen it." },
          { hi: "Put on hold: पाने वाला व्यक्ति कारण बताकर अपना टाइमर रोकता है (जैसे ग्राहक का जवाब आना बाकी)।", en: "Put on hold: the assignee pauses their own timer with a reason (for example, waiting on the client)." },
          { hi: "Resume: रोका हुआ टाइमर दोबारा चलाता है।", en: "Resume: starts a paused timer again." },
          { hi: "My part is done: जब टास्क में कई लोग हों और आपका हिस्सा पूरा हो गया, तो अपना टाइमर बंद करें।", en: "My part is done: when several people share a task and yours is finished, close your own timer." },
          { hi: "Explain delay: डेडलाइन निकलने पर पाने वाला व्यक्ति कारण लिखता है।", en: "Explain delay: after a task misses its deadline, the assignee writes why." },
          { hi: "Accept delay / Reject delay: बोर्ड का Owner/Manager या टास्क का बनाने वाला तय करता है कि देरी स्वीकार है या नहीं (इसे 'Manager's decision' कहते हैं)।", en: "Accept delay / Reject delay: the board Owner/Manager or the task creator decides whether the delay is acceptable (shown as 'Manager's decision')." },
          { hi: "Hold all / Resume all: Owner, Manager या टास्क बनाने वाला सबके टाइमर एक साथ रोक या चला सकता है।", en: "Hold all / Resume all: the Owner, a Manager or the task creator can pause or restart everyone's timers together." },
        ],
      },
      {
        headingHi: "चेतावनी और डेडलाइन चूकना",
        headingEn: "Warnings and missed deadlines",
        steps: [
          { hi: "दिए गए समय का 80% ('Warn when this much time is used' में बदला जा सकता है) बीतने पर कार्ड पीला हो जाता है और चेतावनी जाती है।", en: "At 80% of the allowed time (change it under 'Warn when this much time is used') the card turns amber and a warning is sent." },
          { hi: "समय निकल जाने पर कार्ड लाल हो जाता है और अलर्ट जाता है।", en: "When time runs out the card turns red and an alert is sent." },
          { hi: "एक बार डेडलाइन चूकना दर्ज हो जाए तो बाद में आख़िरी समय बढ़ाने पर भी वह रिकॉर्ड में रहता है।", en: "Once a missed deadline is recorded it stays on record even if the deadline is moved later." },
        ],
      },
    ],
  },
  workCalendar: {
    titleHi: "वर्क कैलेंडर कैसे सेट करें",
    titleEn: "How to set up the Work calendar",
    sections: [
      {
        headingHi: "Shifts (शिफ़्ट)",
        headingEn: "Shifts",
        steps: [
          { hi: "शिफ़्ट बताती है कि कौन से दिन, किस समय से किस समय तक काम होता है और ब्रेक कब है। सारे समय IST में हैं।", en: "A shift says which days people work, from when to when, and when the break is. All times are IST." },
          { hi: "Default शिफ़्ट उन सबको मिलती है जिन्हें अलग शिफ़्ट नहीं दी गई। हर व्यक्ति की शिफ़्ट उसके User फ़ॉर्म में चुनी जाती है।", en: "The default shift applies to everyone who has not been given another one. Pick a person's shift in their User form." },
          { hi: "रात की शिफ़्ट उसी दिन की मानी जाती है जिस दिन वह शुरू होती है, भले ही खत्म अगले दिन हो।", en: "A night shift belongs to the day it starts, even if it ends the next day." },
          { hi: "जिस शिफ़्ट में लोग हैं या जो default है, उसे हटा नहीं सकते।", en: "You cannot delete a shift that people use, or the default one." },
        ],
      },
      {
        headingHi: "Holidays (छुट्टियाँ)",
        headingEn: "Holidays",
        steps: [
          { hi: "छुट्टी के दिन कोई देर या गैर-हाज़िरी नहीं गिनी जाती और टास्क का टाइमर नहीं चलता।", en: "On a holiday nobody is counted late or absent and task timers do not run." },
          { hi: "'All offices' चुनें तो सबके लिए छुट्टी; कोई एक ऑफिस चुनें तो सिर्फ़ उसी ऑफिस के लिए।", en: "Choose 'All offices' for everyone, or pick one office to apply it only there." },
        ],
      },
      {
        headingHi: "Rules (नियम)",
        headingEn: "Rules",
        steps: [
          { hi: "Count as late after (minutes): शिफ़्ट शुरू होने के इतने मिनट बाद तक साइन-इन देर नहीं गिना जाता।", en: "Count as late after (minutes): sign-ins up to this many minutes after the shift starts are not counted late." },
          { hi: "Stay signed in after shift ends (minutes): शिफ़्ट खत्म होने के बाद इतने मिनट तक व्यक्ति साइन-इन रहता है, फिर उसे दोबारा साइन-इन करना होगा।", en: "Stay signed in after shift ends (minutes): after the shift ends, people stay signed in this many minutes, then must sign in again." },
          { hi: "Warn when this much time is used (%): दिए गए समय का कितना प्रतिशत बीतने पर टास्क पर पीली चेतावनी आए (जैसे 80)।", en: "Warn when this much time is used (%): the percentage of a task's allowed time after which the amber warning appears (for example 80)." },
          { hi: "Tell managers: कोई साइन-इन न करे तो मैनेजर को सूचना जाए।", en: "Tell managers: send the manager a notice when someone has not signed in." },
          { hi: "Start tracking from: इस तारीख से पहले कुछ भी दर्ज नहीं होता। खाली = बंद।", en: "Start tracking from: nothing is recorded before this date. Empty = off." },
          { hi: "Time allowed per task, by priority: हर priority का पहले से तय समय (काम के घंटों में)। टास्क में अपना समय न भरा हो तब यही लागू होता है।", en: "Time allowed per task, by priority: the default time (in working hours) for each priority. It applies when a task has no time of its own." },
        ],
      },
    ],
  },
  tatReport: {
    titleHi: "टास्क डेडलाइन रिपोर्ट कैसे पढ़ें",
    titleEn: "How to read the Task deadlines report",
    sections: [
      {
        headingHi: "ऊपर के चार नंबर",
        headingEn: "The four numbers",
        steps: [
          { hi: "Finished on time: पूरे हुए कामों में से कितने प्रतिशत समय पर हुए, साथ में गिनती ('40 of 46')। 85% से कम हो तो पीला। कार्ड पर माउस रखें — पिछली इतनी ही लंबी अवधि से तुलना दिखती है।", en: "Finished on time: the share of finished work done before its deadline, with its count ('40 of 46'); amber below 85%. Hover the card for the previous period of the same length." },
          { hi: "Missed, not excused: जिनकी डेडलाइन निकली और देरी माफ़ नहीं की गई (साथ में कुल कितनी निकलीं)।", en: "Missed, not excused: deadlines missed where the delay was not excused (with how many were missed in all)." },
          { hi: "Overdue right now: अभी भी खुले और डेडलाइन पार — यह अभी की गिनती है, चुनी अवधि से नहीं बदलती; सबसे पुराना कितने दिन से है वह भी दिखता है।", en: "Overdue right now: still open and past the deadline — a live count that does not follow the range; the oldest one's age is shown." },
          { hi: "Waiting for your decision: व्यक्ति ने देरी का कारण दे दिया है, अब आपको फ़ैसला (excused / not excused) करना है।", en: "Waiting for your decision: the person gave a reason for the delay and it now needs your ruling (excused or not)." },
        ],
      },
      {
        headingHi: "तालिका: कौन ठीक है, किसे ध्यान चाहिए",
        headingEn: "The table: who is fine, who needs you",
        steps: [
          { hi: "Health: लाल 'Needs action' = अभी कुछ डेडलाइन पार है या देरी माफ़ नहीं हुई; पीला 'Waiting' = कारण या आपका फ़ैसला बाकी; हरा 'On track'; धूसर 'No tasks'। सबसे ज़रूरी लोग सबसे ऊपर।", en: "Health: red 'Needs action' = something is late now or was late without excuse; amber 'Waiting' = a reason or your decision is owed; green 'On track'; grey 'No tasks'. Whoever needs action most is at the top." },
          { hi: "Missed: '3 · 1 not excused · 1 excused · 1 undecided' — कुल, फिर माफ़ नहीं / माफ़ / अभी फ़ैसला बाकी। On time: '2 of 3' और प्रतिशत। Waiting for: '1 reason · 2 your decision' — व्यक्ति से कारण, या आपसे फ़ैसला।", en: "Missed: '3 · 1 not excused · 1 excused · 1 undecided' — the total, then the ruling split (undecided = no ruling yet). On time: '2 of 3' and the percent. Waiting for: '1 reason · 2 your decision' — a reason from the person, or a ruling from you." },
          { hi: "Finished और On time काम पूरा होने के दिन से गिने जाते हैं; Missed उस दिन से गिना जाता है जिस दिन डेडलाइन निकली।", en: "Finished and On time count by the day the work was finished; Missed counts by the day the deadline was missed." },
          { hi: "हर संख्या पर क्लिक करें — उसके पीछे के टाइमर की सूची खुलती है: टास्क, व्यक्ति, डेडलाइन, कब पूरा हुआ, कारण और फ़ैसला। शून्य '—' रहता है।", en: "Every number opens its list: click it to see the timers behind it — task, person, deadline, when finished, the reason and the decision. A zero shows as '—'." },
          { hi: "'Group by' से व्यक्ति, priority या board के हिसाब से देखें। हर व्यक्ति का अपना टाइमर गिना जाता है। आपको सिर्फ़ वही लोग दिखते हैं जो आपके अधिकार-क्षेत्र (reach) में हैं।", en: "Use 'Group by' to view by person, priority or board. Each person is counted on their own timer. You only see people who fall inside your reach." },
        ],
      },
    ],
  },
  attendanceReport: {
    titleHi: "उपस्थिति रिपोर्ट कैसे पढ़ें",
    titleEn: "How to read the Attendance report",
    sections: [
      {
        headingHi: "ऊपर के कार्ड",
        headingEn: "The cards",
        steps: [
          { hi: "Present: काम के person-days में से कितने में व्यक्ति उपस्थित था। आधे दिन की छुट्टी (½ day) आधा दिन गिनी जाती है; 'On duty' दिन उपस्थित गिने जाते हैं।", en: "Present: present person-days out of working person-days. A ½ day counts as half a day; 'On duty' days count as present." },
          { hi: "Late arrivals: कितनी बार 'Count as late after' के मिनट के बाद साइन-इन हुआ, कुल देरी और बीच की देरी।", en: "Late arrivals: how many times someone signed in after the 'Count as late after' minutes, with the total and the middle value." },
          { hi: "Absent (no sign-in): काम का दिन था पर साइन-इन नहीं हुआ; सबसे ज़्यादा वाले नाम साथ में।", en: "Absent (no sign-in): a working day with no sign-in; the people with the most are named." },
          { hi: "Hours online: साइन-इन वाले दिन ऐप कितनी देर खुला रहा (बीच का मान), शिफ़्ट की लंबाई के साथ। यह अनुमान है, काम के घंटे नहीं।", en: "Hours online: how long the app was open on a signed-in day (the middle value), next to the shift length. It is approximate, not hours worked." },
        ],
      },
      {
        headingHi: "महीने की तालिका",
        headingEn: "The month grid",
        steps: [
          { hi: "हर पंक्ति एक व्यक्ति, हर खाना एक दिन: ✓ समय पर · संख्या = इतने मिनट देर · A गैरहाज़िर · LV छुट्टी · ½ आधे दिन की छुट्टी · OD ऑफिस से बाहर काम · HO कंपनी की छुट्टी · – साप्ताहिक छुट्टी · खाली = आने वाला दिन।", en: "Each row is a person, each cell a day: ✓ on time · a number = minutes late · A absent · LV leave · ½ half-day leave · OD on duty · HO holiday · – weekly off · blank = a day still to come." },
          { hi: "आज का दिन तभी गिना जाता है जब शिफ़्ट ख़त्म हो जाए या व्यक्ति साइन-इन कर ले।", en: "Today counts only once the shift has ended or the person has signed in." },
          { hi: "नाम के पास लाल बिंदु = लगातार 3 काम के दिन देर से आए।", en: "A red dot by a name = late 3 working days in a row." },
          { hi: "दाईं ओर कुल: Present, Late, Absent, Left early (शिफ़्ट ख़त्म होने से पहले साइन-आउट), Online / shift।", en: "Totals on the right: Present, Late, Absent, Left early (signed out before the shift ended), Online / shift." },
        ],
      },
      {
        headingHi: "कौन क्या देखता है",
        headingEn: "Who sees which rows",
        steps: [
          { hi: "Admin किसी दिन के खाने पर क्लिक करके उस दिन के साइन-इन देख सकता है।", en: "An admin can click a day to see that person's sign-ins for that day." },
          { hi: "एक बार में 62 दिन तक चुनें। आपको सिर्फ़ वही लोग दिखते हैं जो आपके Attendance अधिकार-क्षेत्र (reach) में हैं। 'Start tracking from' तारीख से पहले का डेटा नहीं होता।", en: "Pick up to 62 days at a time. You only see people inside your Attendance reach. There is no data before the 'Start tracking from' date." },
        ],
      },
    ],
  },
};
