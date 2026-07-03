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
        hi: "Stage / Owner / Source फ़िल्टर का उपयोग करके लीड्स को ढूँढें और छाँटें।",
        en: "Use the Stage / Owner / Source filters to find and narrow down leads.",
      },
      {
        hi: "किसी लीड की पंक्ति (row) पर क्लिक करके उसका विवरण, custom fields और activity timeline देखें।",
        en: "Click a lead row to open its detail — core info, custom fields and activity timeline.",
      },
      {
        hi: "लीड के अंदर 'Log Call' पर क्लिक करके कॉल रिकॉर्ड करें और अगला follow-up शेड्यूल करें।",
        en: "Inside a lead, click 'Log Call' to record a call and schedule the next follow-up.",
      },
      {
        hi: "Pipeline बोर्ड खोलकर लीड्स को stages में खींचें — won या lost में ले जाएं।",
        en: "Open the Pipeline board to drag leads across stages — into won or lost.",
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
        hi: "जब आप किसी लीड पर कॉल लॉग करते समय अगली तारीख डालते हैं, तो फॉलो-अप अपने आप बन जाता है।",
        en: "A follow-up is created automatically when you log a call with a next date.",
      },
      {
        hi: "किसी फॉलो-अप को खोलकर उसका status (Pending/Done) और remarks अपडेट करें।",
        en: "Open a follow-up to update its status (Pending/Done) and remarks.",
      },
    ],
  },
  tickets: {
    titleHi: "टिकट कैसे इस्तेमाल करें",
    titleEn: "How to use Tickets",
    steps: [
      {
        hi: "ग्राहक की शिकायत के लिए customer name, priority और category के साथ टिकट बनाएं।",
        en: "Raise a ticket for a customer complaint with customer name, priority and category.",
      },
      {
        hi: "Stage / Priority / Category / Assignee / SLA फ़िल्टर से टिकट ढूँढें।",
        en: "Use the Stage / Priority / Category / Assignee / SLA filters to find tickets.",
      },
      {
        hi: "किसी टिकट पर क्लिक करके उसे खोलें — कॉल लॉग करें, fields एडिट करें, और Resolve/Close/Reopen करें।",
        en: "Click a ticket to open it — log calls, edit fields, and Resolve/Close/Reopen.",
      },
      {
        hi: "लाल 'Breached' चिप का मतलब है कि टिकट अपने SLA की तय समय-सीमा पार कर चुका है।",
        en: "A red 'Breached' chip means the ticket has passed its SLA due time.",
      },
      {
        hi: "टिकट को stages में खींचने के लिए Ticket Board का उपयोग करें।",
        en: "Use the Ticket Board to drag tickets across stages.",
      },
    ],
  },
};
