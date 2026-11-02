import { render, screen } from "@testing-library/react-native";

import type { CustomFieldValue } from "../../types/api";
import { followUp, lead } from "../../test/fixtures";
import { ContactCard, customValue, DetailsFacts, FollowUpsTab, spacedMobile } from "./LeadDetailParts";

const field = (patch: Partial<CustomFieldValue>) =>
  ({ FieldId: 1, Label: "F", Type: "text", ValueText: null, ValueNumber: null, ValueDate: null, ...patch }) as CustomFieldValue;

it("reads each custom field type from its own column", () => {
  expect(customValue(field({ Type: "checkbox", ValueText: "true" }))).toBe("Yes");
  expect(customValue(field({ Type: "checkbox", ValueNumber: 1 }))).toBe("Yes");
  expect(customValue(field({ Type: "checkbox" }))).toBe("No");
  expect(customValue(field({ Type: "number", ValueNumber: 4 }))).toBe("4");
  expect(customValue(field({ Type: "number" }))).toBe("—");
  expect(customValue(field({ Type: "date", ValueDate: "2026-11-03T00:00:00" }))).toBe("2026-11-03");
  expect(customValue(field({ Type: "date" }))).toBe("—");
  expect(customValue(field({ ValueText: "RCC" }))).toBe("RCC");
  expect(customValue(field({}))).toBe("—");
});

it("spaces a ten-digit mobile; anything else as given", () => {
  expect(spacedMobile("9825012345")).toBe("98250 12345");
  expect(spacedMobile("+44 20")).toBe("+44 20");
  expect(spacedMobile(null)).toBe("—");
});

it("the contact card with no owner or source falls back", async () => {
  await render(
    <ContactCard lead={lead({ OwnerName: null, SourceName: null, CreatedAt: "bad" })} fields={[]} wide onCall={jest.fn()} onMessage={jest.fn()} />,
  );
  expect(screen.getByText("Unassigned")).toBeOnTheScreen();
  expect(screen.getAllByText("—").length).toBeGreaterThan(1);
});

it("details: a sparse won lead, partner and the phone-only rows", async () => {
  await render(
    <DetailsFacts
      lead={lead({ StatusCode: "converted", WonValue: null, PartnerName: "Sun Partners", Email: null, BranchName: null, Company: null })}
      fields={[field({ Label: "Floors", ValueText: "2" })]}
      wide={false}
    />,
  );
  expect(screen.getByText("Won for —")).toBeOnTheScreen();
  expect(screen.getByText("Sun Partners")).toBeOnTheScreen();
  expect(screen.getByText("Floors")).toBeOnTheScreen();
});

it("follow-ups: no planner, no remarks, view-only rows; a skipped one reads skipped", async () => {
  const next = followUp({ CreatedBy: null, Remarks: null, DueAt: "2099-01-01" });
  await render(
    <FollowUpsTab
      followups={[next, followUp({ Id: 2, Status: "skipped", Remarks: null, Type: "other", DueAt: "2099-01-02" })]}
      next={next}
      plannedBy={() => null}
      wide
    />,
  );
  expect(screen.getByText("Thu, 1 Jan")).toBeOnTheScreen();
  expect(screen.queryByText(/planned by/)).toBeNull();
  expect(screen.getByText("Other")).toBeOnTheScreen();
  expect(screen.getByText("Other · Fri, 2 Jan · skipped")).toBeOnTheScreen();
  // View-only at the rail: no Mark done / Reschedule on the card.
  expect(screen.queryByText("Mark done")).toBeNull();
});

it("follow-ups with only closed ones: no next card", async () => {
  await render(<FollowUpsTab followups={[followUp({ Status: "done" })]} next={undefined} plannedBy={() => "X"} wide={false} />);
  expect(screen.queryByTestId("next-followup")).toBeNull();
});
