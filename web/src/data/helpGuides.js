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
};
