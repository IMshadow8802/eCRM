import { createRef } from "react";
import { act, fireEvent, screen, waitFor } from "@testing-library/react-native";

import { logCall } from "../../api/callQueries";
import { fetchLookups, LOOKUP_KIND } from "../../api/configQueries";
import { escalateTicket, fetchEscalationTargets, setTicketStatus, transferTicket } from "../../api/ticketQueries";
import { fetchAssignableUsers } from "../../api/userQueries";
import type { AssignableUser, Lookup, Ticket } from "../../types/api";
import { envelope, serverError, ticket } from "../../test/fixtures";
import { renderWithProviders, seedAuth } from "../../test/renderWithProviders";
import { spySheets } from "../../test/sheets";
import { flat } from "../../test/style";
import { ComplaintSheets, type ComplaintAction, type ComplaintSheetsHandle } from "./ComplaintSheets";

// gorhom's mock makes BottomSheetTextInput a bare TextInput; tag it so a test
// can see a field is the sheet's own input (a plain TextInput loses focus there).
jest.mock("@gorhom/bottom-sheet", () => {
  const mock = jest.requireActual("@gorhom/bottom-sheet/mock");
  const { createElement, forwardRef } = jest.requireActual("react");
  const { TextInput } = jest.requireActual("react-native");
  return {
    ...mock,
    BottomSheetTextInput: forwardRef((props: object, ref: unknown) => createElement(TextInput, { ...props, ref, nativeID: "sheet-input" })),
  };
});

jest.mock("../../api/ticketQueries");
jest.mock("../../api/callQueries");
jest.mock("../../api/configQueries");
jest.mock("../../api/userQueries");

const lookup = (Id: number, Kind: string, Value: string, Code: string | null = null): Lookup => ({
  Id, CompId: 1, Kind, Value, Code, SortOrder: Id, IsActive: true,
});
const STATUSES = [
  lookup(1, LOOKUP_KIND.ticketStatus, "Open", "open"),
  lookup(2, LOOKUP_KIND.ticketStatus, "On hold", "onhold"),
  lookup(3, LOOKUP_KIND.ticketStatus, "Resolved", "resolved"),
  lookup(4, LOOKUP_KIND.ticketStatus, "Closed", "closed"),
  lookup(5, LOOKUP_KIND.ticketStatus, "Rejected", "rejected"),
];
let lookups: Record<string, Lookup[]>;
let people: AssignableUser[];
const priya: AssignableUser = {
  Id: 9, FullName: "Priya Shah", Avatar: null, JobTitle: "Technician", BranchId: 1, BranchName: "Head Office", ReportsTo: null,
};
const vikram: AssignableUser = { ...priya, Id: 11, FullName: "Vikram Singh", JobTitle: "AC Technician", BranchName: "Karol Bagh" };

let onGone: jest.Mock;
let rendered: Awaited<ReturnType<typeof renderWithProviders>>;
const mount = async () => {
  const ref = createRef<ComplaintSheetsHandle>();
  onGone = jest.fn();
  rendered = await renderWithProviders(<ComplaintSheets ref={ref} onGone={onGone} />);
  await screen.findByText("Fixed on site");
  return async (action: ComplaintAction, row: Ticket = ticket()) => {
    await act(() => ref.current!.open(action, row));
    // The reassign list is per record, asked for when the sheet opens.
    if (action === "reassign" && people.length) await screen.findByText(people[0]!.FullName);
  };
};

beforeEach(() => {
  seedAuth({ UserId: 42 });
  lookups = {
    [LOOKUP_KIND.ticketStatus]: STATUSES,
    [LOOKUP_KIND.resolution]: [lookup(20, LOOKUP_KIND.resolution, "Fixed on site")],
    [LOOKUP_KIND.transferReason]: [lookup(30, LOOKUP_KIND.transferReason, "Specialist needed")],
    [LOOKUP_KIND.callOutcome]: [lookup(40, LOOKUP_KIND.callOutcome, "No answer")],
  };
  jest.mocked(fetchLookups).mockImplementation(async ({ Kind }) => lookups[Kind] ?? []);
  people = [priya, vikram];
  jest.mocked(fetchAssignableUsers).mockImplementation(async () => people);
  jest.mocked(fetchEscalationTargets).mockResolvedValue([
    { Id: 5, FullName: "Neha Kapoor", JobTitle: "Support Head", Depth: 1 } as never,
  ]);
  const ok = envelope(null);
  jest.mocked(setTicketStatus).mockResolvedValue(ok);
  jest.mocked(transferTicket).mockResolvedValue(ok);
  jest.mocked(escalateTicket).mockResolvedValue(ok);
  jest.mocked(logCall).mockResolvedValue(envelope({ Id: 1 }));
});

describe("Resolve (13)", () => {
  it("needs a resolution and remarks, then moves to the company's resolved status", async () => {
    const { present, dismiss } = spySheets();
    const open = await mount();
    await open("resolve");
    expect(present).toHaveBeenCalled();
    expect(screen.getByText("Resolve complaint")).toBeOnTheScreen();
    expect(screen.getAllByText("T-7 · Inverter keeps tripping")[0]).toBeOnTheScreen();
    expect(screen.getByText("Required. Shows in the complaint history.")).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole("button", { name: "Save · mark resolved" }));
    expect(screen.getByText("Pick a resolution.")).toBeOnTheScreen();
    expect(screen.getByText("Remarks are required to resolve.")).toBeOnTheScreen();
    expect(setTicketStatus).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByRole("radio", { name: "Fixed on site" }));
    await fireEvent.changeText(screen.getByTestId("resolve-remarks"), "  Gas topped up  ");
    await fireEvent.press(screen.getByRole("button", { name: "Save · mark resolved" }));
    await waitFor(() =>
      expect(setTicketStatus).toHaveBeenCalledWith({ TicketId: 7, StatusId: 3, ResolutionId: 20, Remarks: "Gas topped up" }),
    );
    expect(await screen.findByText("Status changed to Resolved")).toBeOnTheScreen();
    expect(dismiss).toHaveBeenCalled();
  });
});

describe("moving to any company status (Change status)", () => {
  const OPEN_TOO = lookup(6, LOOKUP_KIND.ticketStatus, "Reopened", "open");
  const mountMove = async () => {
    const ref = createRef<ComplaintSheetsHandle>();
    await renderWithProviders(<ComplaintSheets ref={ref} />);
    await screen.findByText("Fixed on site");
    return (target: Lookup, row: Ticket = ticket()) => act(() => ref.current!.moveTo(row, target));
  };

  it("a same-code row (a second `open`) and active→active move straight away, asking nothing", async () => {
    const { present } = spySheets();
    const moveTo = await mountMove();
    await moveTo(OPEN_TOO);
    await waitFor(() => expect(setTicketStatus).toHaveBeenCalledWith({ TicketId: 7, StatusId: 6 }));
    await moveTo(STATUSES[1]!);
    await waitFor(() => expect(setTicketStatus).toHaveBeenLastCalledWith({ TicketId: 7, StatusId: 2 }));
    await moveTo(STATUSES[3]!, ticket({ StatusCode: "closed", StatusId: 4 }));
    await waitFor(() => expect(setTicketStatus).toHaveBeenLastCalledWith({ TicketId: 7, StatusId: 4 }));
    expect(present).not.toHaveBeenCalled();
  });

  // Review C-M6: a second row of the same TERMINAL code skipped the inputs the SP demands.
  it("another row of the same terminal code still asks (rejected → a second rejected row needs remarks)", async () => {
    const { present } = spySheets();
    const second = lookup(8, LOOKUP_KIND.ticketStatus, "Declined", "rejected");
    const moveTo = await mountMove();
    await moveTo(second, ticket({ StatusCode: "rejected", StatusId: 5 }));
    expect(present).toHaveBeenCalled();
    expect(setTicketStatus).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Reject" })).toBeDisabled();
  });

  it("resolved asks for a resolution and remarks, and moves to THAT resolved row", async () => {
    const second = lookup(7, LOOKUP_KIND.ticketStatus, "Fixed remotely", "resolved");
    const moveTo = await mountMove();
    await moveTo(second);
    await fireEvent.press(screen.getByRole("radio", { name: "Fixed on site" }));
    await fireEvent.changeText(screen.getByTestId("resolve-remarks"), "Remote reset");
    await fireEvent.press(screen.getByRole("button", { name: "Save · mark resolved" }));
    await waitFor(() =>
      expect(setTicketStatus).toHaveBeenCalledWith({ TicketId: 7, StatusId: 7, ResolutionId: 20, Remarks: "Remote reset" }),
    );
  });

  it("rejected asks for remarks; terminal→active is a reopen asking for remarks", async () => {
    const moveTo = await mountMove();
    await moveTo(STATUSES[4]!);
    expect(screen.getByText("Reject complaint")).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "Reject" })).toBeDisabled();
    await moveTo(OPEN_TOO, ticket({ StatusCode: "rejected", StatusId: 5 }));
    expect(screen.getByText("Reopen complaint")).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "Reopen" })).toBeDisabled();
    await fireEvent.changeText(screen.getByTestId("compose-remarks"), "Customer came back");
    await fireEvent.press(screen.getByRole("button", { name: "Reopen" }));
    await waitFor(() =>
      expect(setTicketStatus).toHaveBeenCalledWith({ TicketId: 7, StatusId: 6, ResolutionId: null, Remarks: "Customer came back" }),
    );
  });

  it("closed from resolved: remarks are optional", async () => {
    const moveTo = await mountMove();
    await moveTo(STATUSES[3]!, ticket({ StatusCode: "resolved", StatusId: 3 }));
    await fireEvent.press(screen.getByRole("button", { name: "Close complaint" }));
    await waitFor(() =>
      expect(setTicketStatus).toHaveBeenCalledWith({ TicketId: 7, StatusId: 4, ResolutionId: null, Remarks: null }),
    );
  });
});

it("Resolve's remarks take the focus (E 13)", async () => {
  await mount();
  expect(screen.getByTestId("resolve-remarks").props.autoFocus).toBe(true);
});

it("the sheets' remarks and search are the shared Input as sheet inputs: remarks 84 / 64 tall, search 40 with its icon", async () => {
  const open = await mount();
  await open("resolve");
  const resolve = screen.getByTestId("resolve-remarks");
  expect(resolve.props.nativeID).toBe("sheet-input");
  expect(flat(resolve.parent!)).toMatchObject({ minHeight: 84, borderRadius: 12 });
  await open("reassign");
  const search = screen.getByTestId("reassign-search");
  expect(search.props.nativeID).toBe("sheet-input");
  expect(flat(search.parent!)).toMatchObject({ height: 40, borderRadius: 12, borderWidth: 1 });
  const remarks = screen.getByTestId("reassign-remarks");
  expect(remarks.props.nativeID).toBe("sheet-input");
  expect(flat(remarks.parent!)).toMatchObject({ minHeight: 64 });
});

it("with no reasons set up, Reassign says so and cannot be sent", async () => {
  lookups[LOOKUP_KIND.transferReason] = [];
  const open = await mount();
  await open("reassign");
  expect(screen.getByText("No reasons are set up. Add them on the web first.")).toBeOnTheScreen();
  expect(screen.getByRole("button", { name: "Reassign" })).toBeDisabled();
});

it("Reassign never offers Sent back as a reason (only Send back writes it)", async () => {
  lookups[LOOKUP_KIND.transferReason] = [
    lookup(30, LOOKUP_KIND.transferReason, "Specialist needed"),
    lookup(31, LOOKUP_KIND.transferReason, "Sent back", "sent_back"),
  ];
  const open = await mount();
  await open("reassign");
  expect(screen.getByRole("radio", { name: "Specialist needed" })).toBeOnTheScreen();
  expect(screen.queryByRole("radio", { name: "Sent back" })).toBeNull();
});

it("only a Sent back reason set up reads as no reasons", async () => {
  lookups[LOOKUP_KIND.transferReason] = [lookup(31, LOOKUP_KIND.transferReason, "Sent back", "sent_back")];
  const open = await mount();
  await open("reassign");
  expect(screen.getByText("No reasons are set up. Add them on the web first.")).toBeOnTheScreen();
});

it("a dismissed Resolve or Reassign sheet forgets what was typed", async () => {
  const open = await mount();
  await open("resolve");
  await fireEvent.changeText(screen.getByTestId("resolve-remarks"), "half typed");
  await fireEvent.press(screen.getByRole("button", { name: "Save · mark resolved" }));
  await fireEvent(screen.getByText("Resolve complaint"), "dismiss");
  expect(screen.getByTestId("resolve-remarks").props.value).toBe("");
  expect(screen.queryByText("Pick a resolution.")).toBeNull();

  await open("reassign");
  await fireEvent.changeText(screen.getByTestId("reassign-search"), "pri");
  await fireEvent.changeText(screen.getByTestId("reassign-remarks"), "half typed");
  await fireEvent(screen.getByText("Reassign complaint"), "dismiss");
  expect(screen.getByTestId("reassign-remarks").props.value).toBe("");
  expect(screen.getByTestId("reassign-search").props.value).toBe("");
});

describe("status moves", () => {
  it("On hold opens its sheet preselected; remarks are optional; nothing is sent until submit", async () => {
    const { present } = spySheets();
    const open = await mount();
    await open("hold");
    expect(present).toHaveBeenCalledTimes(1);
    expect(setTicketStatus).not.toHaveBeenCalled();
    expect(screen.getAllByText("Put on hold").length).toBeGreaterThan(0);
    await fireEvent.press(screen.getByRole("button", { name: "Put on hold" }));
    await waitFor(() =>
      expect(setTicketStatus).toHaveBeenCalledWith({ TicketId: 7, StatusId: 2, ResolutionId: null, Remarks: null }),
    );
  });

  it("Close from an active status asks for a resolution and remarks", async () => {
    const open = await mount();
    await open("close");
    expect(screen.getByRole("button", { name: "Close complaint" })).toBeDisabled();
    const pills = screen.getAllByRole("radio", { name: "Fixed on site" });
    await fireEvent.press(pills[pills.length - 1]!);
    await fireEvent.changeText(screen.getByTestId("compose-remarks"), "Customer confirmed");
    await fireEvent.press(screen.getByRole("button", { name: "Close complaint" }));
    await waitFor(() =>
      expect(setTicketStatus).toHaveBeenCalledWith({ TicketId: 7, StatusId: 4, ResolutionId: 20, Remarks: "Customer confirmed" }),
    );
  });

  it("Reopen needs remarks and shows the server's refusal, never pre-empts it", async () => {
    jest.mocked(setTicketStatus).mockRejectedValue(serverError(400, "Reopening requires a manager"));
    const open = await mount();
    await open("reopen", ticket({ StatusCode: "resolved", StatusId: 3 }));
    expect(screen.getByText("Reopen complaint")).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "Reopen" })).toBeDisabled();
    await fireEvent.changeText(screen.getByTestId("compose-remarks"), "Came back");
    await fireEvent.press(screen.getByRole("button", { name: "Reopen" }));
    expect(await screen.findByText("Reopening requires a manager")).toBeOnTheScreen();
    expect(setTicketStatus).toHaveBeenCalledWith({ TicketId: 7, StatusId: 1, ResolutionId: null, Remarks: "Came back" });
  });

  it("Reject needs remarks; a status the company lacks is named, not sent", async () => {
    lookups[LOOKUP_KIND.ticketStatus] = STATUSES.filter((s) => s.Code !== "onhold");
    const open = await mount();
    await open("reject");
    expect(screen.getByRole("button", { name: "Reject" })).toBeDisabled();
    await open("hold");
    expect(await screen.findByText("That status is not set up for your company. Add it on the web first.")).toBeOnTheScreen();
  });
});

// Review C-M1: a swipe Resolve with no resolved-coded status filled a sheet that then did nothing.
it("Resolve when the company has no resolved status says so instead of opening a dead sheet", async () => {
  lookups[LOOKUP_KIND.ticketStatus] = STATUSES.filter((s) => s.Code !== "resolved");
  const { present } = spySheets();
  const open = await mount();
  await open("resolve");
  expect(await screen.findByText("That status is not set up for your company. Add it on the web first.")).toBeOnTheScreen();
  expect(present).not.toHaveBeenCalled();
});

describe("Reassign (23)", () => {
  it("person, reason and remarks are required, each said inline after a submit", async () => {
    const open = await mount();
    await open("reassign", ticket({ AssignedTo: 42, AssigneeName: "Ayush Mishra", DueAt: "2026-11-02T12:40:00" }));
    expect(screen.getByText("T-7 · now with Ayush Mishra")).toBeOnTheScreen();
    expect(screen.getByText(/^Due stays .*Reassigning never moves the TAT clock\.$/)).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("button", { name: "Reassign" }));
    expect(screen.getByText("Pick who it goes to.")).toBeOnTheScreen();
    expect(screen.getByText("Pick a reason.")).toBeOnTheScreen();
    expect(screen.getByText("Remarks are required to reassign.")).toBeOnTheScreen();
    expect(transferTicket).not.toHaveBeenCalled();
  });

  it("search finds a person by job title or office, any case; a miss says so", async () => {
    const open = await mount();
    await open("reassign");
    await fireEvent.changeText(screen.getByTestId("reassign-search"), "AC TECH");
    expect(screen.getByText("Vikram Singh")).toBeOnTheScreen();
    expect(screen.queryByText("Priya Shah")).toBeNull();
    await fireEvent.changeText(screen.getByTestId("reassign-search"), "head off");
    expect(screen.getByText("Priya Shah")).toBeOnTheScreen();
    expect(screen.queryByText("Vikram Singh")).toBeNull();
    await fireEvent.changeText(screen.getByTestId("reassign-search"), "plumber");
    expect(screen.getByText("Nobody matches.")).toBeOnTheScreen();
  });

  it("filters people in reach, then sends the controller's payload", async () => {
    const open = await mount();
    await open("reassign");
    expect(screen.getByText("Technician · Head Office")).toBeOnTheScreen();
    await fireEvent.changeText(screen.getByTestId("reassign-search"), "karol");
    expect(screen.queryByText("Priya Shah")).toBeNull();
    await fireEvent.changeText(screen.getByTestId("reassign-search"), "zzz");
    expect(screen.getByText("Nobody matches.")).toBeOnTheScreen();
    await fireEvent.changeText(screen.getByTestId("reassign-search"), "");
    await fireEvent.press(screen.getByRole("radio", { name: "Priya Shah" }));
    expect(screen.getByPlaceholderText("Tell Priya what has been tried")).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("radio", { name: "Specialist needed" }));
    await fireEvent.changeText(screen.getByTestId("reassign-remarks"), "Tried a reset");
    await fireEvent.press(screen.getByRole("button", { name: "Reassign to Priya" }));
    await waitFor(() =>
      expect(transferTicket).toHaveBeenCalledWith({ TicketId: 7, ToUserId: 9, ToBranchId: null, ReasonId: 30, Remarks: "Tried a reset" }),
    );
    expect(await screen.findByText("Reassigned to Priya Shah")).toBeOnTheScreen();
  });

  it("a pick collapses the list to that person with Change; Change brings the list and search back", async () => {
    const open = await mount();
    await open("reassign");
    await fireEvent.changeText(screen.getByTestId("reassign-search"), "pri");
    await fireEvent.press(screen.getByRole("radio", { name: "Priya Shah" }));
    // Only the chosen person is left, so Reason and Remarks sit right below.
    expect(screen.getByText("Priya Shah")).toBeOnTheScreen();
    expect(screen.queryByText("Vikram Singh")).toBeNull();
    expect(screen.queryByTestId("reassign-search")).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: "Change" }));
    expect(screen.getByText("Vikram Singh")).toBeOnTheScreen();
    expect(screen.getByTestId("reassign-search").props.value).toBe("");
    expect(screen.getByRole("radio", { name: "Priya Shah" }).props.accessibilityState.checked).toBe(true);
    await fireEvent.press(screen.getByRole("radio", { name: "Vikram Singh" }));
    expect(screen.queryByText("Priya Shah")).toBeNull();
    await fireEvent.press(screen.getByRole("radio", { name: "Specialist needed" }));
    await fireEvent.changeText(screen.getByTestId("reassign-remarks"), "Needs a visit");
    await fireEvent.press(screen.getByRole("button", { name: "Reassign to Vikram" }));
    await waitFor(() =>
      expect(transferTicket).toHaveBeenCalledWith({ TicketId: 7, ToUserId: 11, ToBranchId: null, ReasonId: 30, Remarks: "Needs a visit" }),
    );
  });

  it("a failed reassign says why", async () => {
    jest.mocked(transferTicket).mockRejectedValue(serverError(400, "Not in your reach"));
    const open = await mount();
    await open("reassign");
    await fireEvent.press(screen.getByRole("radio", { name: "Vikram Singh" }));
    await fireEvent.press(screen.getByRole("radio", { name: "Specialist needed" }));
    await fireEvent.changeText(screen.getByTestId("reassign-remarks"), "x");
    await fireEvent.press(screen.getByRole("button", { name: "Reassign to Vikram" }));
    expect(await screen.findByText("Not in your reach")).toBeOnTheScreen();
    expect(onGone).not.toHaveBeenCalled();
  });
});

describe("Escalate", () => {
  it("asks the server for the chain above whoever works this complaint and sends who and why", async () => {
    const open = await mount();
    await open("escalate", ticket({ AssignedTo: 42, AssigneeName: "Ayush Mishra" }));
    expect(await screen.findByText("Direct manager · Support Head")).toBeOnTheScreen();
    expect(fetchEscalationTargets).toHaveBeenCalledWith(7);
    await fireEvent.press(screen.getByRole("radio", { name: "Neha Kapoor" }));
    await fireEvent.press(screen.getByRole("button", { name: "Escalate to Neha Kapoor" }));
    expect(screen.getByText("Say why it needs a senior.")).toBeOnTheScreen();
    await fireEvent.changeText(screen.getByTestId("escalate-remarks"), "Customer called twice");
    await fireEvent.press(screen.getByRole("button", { name: "Escalate to Neha Kapoor" }));
    await waitFor(() =>
      expect(escalateTicket).toHaveBeenCalledWith({ TicketId: 7, ToUserId: 5, Remarks: "Customer called twice" }),
    );
    expect(await screen.findByText("Escalated to Neha Kapoor")).toBeOnTheScreen();
  });

  // Review C-M2: while the chain loads the sheet said "nobody above".
  it("while the chain is loading it says so, not 'nobody above'", async () => {
    jest.mocked(fetchEscalationTargets).mockReturnValue(new Promise(() => {}));
    const open = await mount();
    await open("escalate");
    expect(await screen.findByText("Loading who is above…")).toBeOnTheScreen();
    expect(screen.queryByText("You have nobody above you in the reporting chain.")).toBeNull();
  });

  it("a failed escalation says why; nobody above says so", async () => {
    jest.mocked(escalateTicket).mockRejectedValue(serverError(400, "Not an ancestor"));
    jest.mocked(fetchEscalationTargets).mockResolvedValueOnce([]);
    const open = await mount();
    await open("escalate");
    expect(await screen.findByText("Nobody above you can open complaints. Reassign it or tell a manager.")).toBeOnTheScreen();
  });

  it("an empty chain names the person it stays with; a refusal is the server's sentence", async () => {
    jest.mocked(escalateTicket).mockRejectedValue(serverError(400, "Escalation target must be able to open complaints"));
    const open = await mount();
    await open("escalate", ticket({ AssignedTo: 9, AssigneeName: "Priya Shah" }));
    expect(screen.getByText("T-7 · it stays with Priya Shah")).toBeOnTheScreen();
    await fireEvent.press(await screen.findByRole("radio", { name: "Neha Kapoor" }));
    await fireEvent.changeText(screen.getByTestId("escalate-remarks"), "Twice now");
    await fireEvent.press(screen.getByRole("button", { name: "Escalate to Neha Kapoor" }));
    expect(await screen.findByText("Escalation target must be able to open complaints")).toBeOnTheScreen();
    expect(onGone).not.toHaveBeenCalled();
  });

  it("no chain above an assigned complaint names that person", async () => {
    jest.mocked(fetchEscalationTargets).mockResolvedValueOnce([]);
    const open = await mount();
    await open("escalate", ticket({ AssignedTo: 9, AssigneeName: "Priya Shah" }));
    expect(await screen.findByText("Nobody above Priya Shah can open complaints. Reassign it or tell a manager.")).toBeOnTheScreen();
  });
});

describe("access model: Reassign words, groups, Away today, Send back, gone", () => {
  const ranked = (): AssignableUser[] => [
    { ...priya, Id: 21, FullName: "Vivek Rao", GroupRank: 1, IsGiver: true },
    { ...priya, Id: 22, FullName: "Meena Iyer", GroupRank: 2, AwayToday: true },
    { ...priya, Id: 23, FullName: "Kunal Das", GroupRank: 3 },
  ];

  it("asks for this record's list, groups it, marks Away today and the giver, and never says transfer", async () => {
    people = ranked();
    const open = await mount();
    await open("reassign");
    expect(fetchAssignableUsers).toHaveBeenCalledWith({ Module: "complaints", RecordId: 7 });
    expect(screen.getByText("Your manager and team")).toBeOnTheScreen();
    expect(screen.getByText("Your office")).toBeOnTheScreen();
    expect(screen.getByText("Other offices")).toBeOnTheScreen();
    expect(screen.getByText("Away today")).toBeOnTheScreen();
    expect(screen.getByText("Gave it to you")).toBeOnTheScreen();
    expect(screen.getByText(/^Reassign to/)).toBeOnTheScreen();
    expect(screen.queryByText(/transfer/i)).toBeNull();
    // Typing narrows the list on the device; empty groups drop their heading.
    await fireEvent.changeText(screen.getByTestId("reassign-search"), "meena");
    expect(screen.queryByText("Vivek Rao")).toBeNull();
    expect(screen.queryByText("Your manager and team")).toBeNull();
    expect(screen.getByText("Meena Iyer")).toBeOnTheScreen();
  });

  it("nobody to hand it to says so", async () => {
    people = [];
    const open = await mount();
    await open("reassign");
    expect(await screen.findByText("Nobody can take this. Ask a manager.")).toBeOnTheScreen();
  });

  it("a reassign that succeeds leaves the record: detail dropped, onGone, 'Reassigned to <name>'", async () => {
    people = ranked();
    const open = await mount();
    const removed = jest.spyOn(rendered.queryClient, "removeQueries");
    await open("reassign");
    await fireEvent.press(screen.getByRole("radio", { name: "Vivek Rao" }));
    await fireEvent.press(screen.getByRole("radio", { name: "Specialist needed" }));
    await fireEvent.changeText(screen.getByTestId("reassign-remarks"), "Your area");
    await fireEvent.press(screen.getByRole("button", { name: "Reassign to Vivek" }));
    expect(await screen.findByText("Reassigned to Vivek Rao")).toBeOnTheScreen();
    expect(onGone).toHaveBeenCalledTimes(1);
    expect(removed).toHaveBeenCalledWith({ queryKey: ["ticket", 7] });
    // Regression (Maestro 2026-11-23): the old holder's chain must not survive
    // the reassign, or the reopened record offers nobody to escalate to.
    expect(removed).toHaveBeenCalledWith({ queryKey: ["escalation-targets", 7] });
  });

  it("Send back posts SendBack with the remarks and no reason, then leaves", async () => {
    const open = await mount();
    await open("sendback", ticket({ SendBackToId: 30, SendBackToName: "Nitin Verma" }));
    expect(screen.getAllByText("Send back to Nitin Verma")[0]).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "Send back to Nitin" })).toBeDisabled();
    await fireEvent.changeText(screen.getByTestId("compose-sendback"), "Wrong office");
    await fireEvent.press(screen.getByRole("button", { name: "Send back to Nitin" }));
    await waitFor(() =>
      expect(transferTicket).toHaveBeenCalledWith({ TicketId: 7, ToUserId: 30, Remarks: "Wrong office", SendBack: true }),
    );
    expect(await screen.findByText("Sent back to Nitin Verma")).toBeOnTheScreen();
    expect(onGone).toHaveBeenCalled();
  });

  // Review Focus 3: the giver lost the module between load and tap.
  it("a refused send back shows the server's sentence, refetches the record and stays", async () => {
    jest.mocked(transferTicket).mockRejectedValue(serverError(400, "Nitin Verma can no longer take this. Reassign it instead."));
    const open = await mount();
    const invalidated = jest.spyOn(rendered.queryClient, "invalidateQueries");
    await open("sendback", ticket({ SendBackToId: 30, SendBackToName: "Nitin Verma" }));
    await fireEvent.changeText(screen.getByTestId("compose-sendback"), "Wrong office");
    await fireEvent.press(screen.getByRole("button", { name: "Send back to Nitin" }));
    expect(await screen.findByText("Nitin Verma can no longer take this. Reassign it instead.")).toBeOnTheScreen();
    expect(invalidated).toHaveBeenCalledWith({ queryKey: ["ticket", 7] });
    expect(invalidated).toHaveBeenCalledWith({ queryKey: ["escalation-targets", 7] });
    expect(onGone).not.toHaveBeenCalled();
  });

  it("send back without a giver sends nothing", async () => {
    const open = await mount();
    await open("sendback");
    expect(screen.getAllByText("Send back")[0]).toBeOnTheScreen();
    await fireEvent.changeText(screen.getByTestId("compose-sendback"), "x");
    await fireEvent.press(screen.getByRole("button", { name: "Send back" }));
    expect(transferTicket).not.toHaveBeenCalled();
  });

  // Review Focus 4: someone else moved it while the screen was open.
  it("a 404 on Resolve drops the detail, leaves and says the record is no longer with you", async () => {
    jest.mocked(setTicketStatus).mockRejectedValue(serverError(404, "Complaint not found"));
    const open = await mount();
    const removed = jest.spyOn(rendered.queryClient, "removeQueries");
    await open("resolve");
    await fireEvent.press(screen.getByRole("radio", { name: "Fixed on site" }));
    await fireEvent.changeText(screen.getByTestId("resolve-remarks"), "Done");
    await fireEvent.press(screen.getByRole("button", { name: "Save · mark resolved" }));
    expect(await screen.findByText("This record is no longer with you")).toBeOnTheScreen();
    expect(onGone).toHaveBeenCalledTimes(1);
    expect(removed).toHaveBeenCalledWith({ queryKey: ["ticket", 7] });
  });

  // 403 = still visible, this action refused: say why and stay on the record.
  it("a 403 on Resolve shows the server's message and stays", async () => {
    jest.mocked(setTicketStatus).mockRejectedValue(serverError(403, "You do not have permission for this action"));
    const open = await mount();
    const removed = jest.spyOn(rendered.queryClient, "removeQueries");
    await open("resolve");
    await fireEvent.press(screen.getByRole("radio", { name: "Fixed on site" }));
    await fireEvent.changeText(screen.getByTestId("resolve-remarks"), "Done");
    await fireEvent.press(screen.getByRole("button", { name: "Save · mark resolved" }));
    expect(await screen.findByText("You do not have permission for this action")).toBeOnTheScreen();
    expect(screen.queryByText("This record is no longer with you")).toBeNull();
    expect(onGone).not.toHaveBeenCalled();
    expect(removed).not.toHaveBeenCalled();
  });

  it("a 404 on a logged call leaves the same way", async () => {
    jest.mocked(logCall).mockRejectedValue(serverError(404, "Record not found"));
    const open = await mount();
    await open("call");
    await fireEvent.changeText(screen.getByTestId("logcall-notes"), "Rang");
    await fireEvent.press(screen.getByRole("button", { name: "Save call" }));
    expect(await screen.findByText("This record is no longer with you")).toBeOnTheScreen();
    expect(onGone).toHaveBeenCalled();
  });
});

describe("Log call (24)", () => {
  const fill = async (notes = "Unit trips after 10 min") => {
    await fireEvent.changeText(screen.getByTestId("logcall-notes"), notes);
  };

  it("logs the call, then chains On hold through setTicketStatus", async () => {
    const open = await mount();
    await open("call", ticket({ ContactPerson: "Rakesh Sharma", Contact: "98250 12345" }));
    expect(screen.getByText("Rakesh Sharma · 98250 12345")).toBeOnTheScreen();
    await fill();
    await fireEvent.press(screen.getByRole("radio", { name: "Put on hold" }));
    await fireEvent.press(screen.getByRole("button", { name: "Save call" }));
    await waitFor(() =>
      expect(logCall).toHaveBeenCalledWith({ TicketId: 7, Direction: "out", OutcomeId: null, Notes: "Unit trips after 10 min", Duration: 1 }),
    );
    await waitFor(() => expect(setTicketStatus).toHaveBeenCalledWith({ TicketId: 7, StatusId: 2 }));
  });

  it("Then Resolve opens the Resolve sheet; Keep open just logs it", async () => {
    const { present } = spySheets();
    const open = await mount();
    await open("call");
    await fill();
    await fireEvent.press(screen.getByRole("radio", { name: "Resolve" }));
    await fireEvent.press(screen.getByRole("button", { name: "Save call" }));
    await waitFor(() => expect(present).toHaveBeenCalledTimes(2));
    expect(setTicketStatus).not.toHaveBeenCalled();

    await open("call");
    await fill("Called back");
    await fireEvent.press(screen.getByRole("radio", { name: "Keep open" }));
    await fireEvent.press(screen.getByRole("button", { name: "Save call" }));
    expect(await screen.findByText("Call logged")).toBeOnTheScreen();
  });

  it("No answer is out + the outcome with no duration; a failure stays in the sheet", async () => {
    jest.mocked(logCall).mockRejectedValue(serverError(400, "No write access"));
    const open = await mount();
    await open("call", ticket({ StatusCode: "onhold" }));
    expect(screen.queryByRole("radio", { name: "Put on hold" })).toBeNull();
    await fireEvent.press(screen.getByRole("tab", { name: "No answer" }));
    await fill("Rang out");
    await fireEvent.press(screen.getByRole("button", { name: "Save call" }));
    await waitFor(() =>
      expect(logCall).toHaveBeenCalledWith({ TicketId: 7, Direction: "out", OutcomeId: 40, Notes: "Rang out", Duration: null }),
    );
    expect(await screen.findByText("No write access")).toBeOnTheScreen();
  });

  it("no Then on a terminal complaint", async () => {
    const open = await mount();
    await open("call", ticket({ StatusCode: "closed" }));
    expect(screen.queryByText("Then")).toBeNull();
  });
});
