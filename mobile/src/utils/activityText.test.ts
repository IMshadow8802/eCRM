import { activityText } from "./activityText";

it("rewords a legacy 'Transferred to' summary as 'Reassigned to', keeping the rest", () => {
  expect(activityText("Transferred to Vinod Kumar  — Wrong branch")).toBe("Reassigned to Vinod Kumar  — Wrong branch");
  expect(activityText("transferred to Amit")).toBe("Reassigned to Amit");
});

it("leaves every other summary, and a missing one, alone", () => {
  expect(activityText("Reassigned to Vivek — Absent")).toBe("Reassigned to Vivek — Absent");
  expect(activityText("Note: Transferred to Amit by phone")).toBe("Note: Transferred to Amit by phone");
  expect(activityText(null)).toBeUndefined();
  expect(activityText(undefined)).toBeUndefined();
});
