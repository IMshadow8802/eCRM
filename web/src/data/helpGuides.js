// Bilingual (Hindi default, English toggle) how-to guides shown by the
// HelpGuide "?" button on the main working screens. Each step has {hi, en}.
export const HELP_GUIDES = {
  tasks: {
    titleHi: "टास्क कैसे इस्तेमाल करें",
    titleEn: "How to use Tasks",
    steps: [
      {
        hi: "किसी भी कॉलम (To Do, In Progress, Done) में 'Add task' पर क्लिक करके नया टास्क बनाएं।",
        en: "Click 'Add task' in any column (To Do, In Progress, Done) to create a task.",
      },
      {
        hi: "टास्क खोलकर assignee, priority और due date सेट करें, और checklist जोड़ें।",
        en: "Open a task to set its assignee, priority and due date, and add a checklist.",
      },
      {
        hi: "स्टेटस बदलने के लिए टास्क कार्ड को एक कॉलम से दूसरे कॉलम में खींचें (drag)।",
        en: "Drag a task card from one column to another to change its status.",
      },
      {
        hi: "जब टास्क के सभी checklist आइटम पूरे हो जाते हैं, तब टास्क अपने आप complete हो जाता है।",
        en: "A task is marked complete when all its checklist items are checked.",
      },
      {
        hi: "अपने अलग-अलग बोर्ड देखने के लिए ऊपर-बाएं workspace switcher का उपयोग करें।",
        en: "Use the workspace switcher (top-left) to move between your boards.",
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
