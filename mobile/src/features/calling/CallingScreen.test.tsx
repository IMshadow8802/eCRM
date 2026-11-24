import { AppState, Linking } from "react-native";
import { AxiosError } from "axios";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react-native";

import { convertCallContact, fetchMyCallList, saveCallResult, undoCallResult } from "../../api/callingQueries";
import { callContact, callDone, envelope, localDay, myCallList, serverError } from "../../test/fixtures";
import { makeNavigation, makeRoute, renderWithProviders, seedAuth } from "../../test/renderWithProviders";
import CallingScreen from "./CallingScreen";

jest.mock("../../api/callingQueries");
jest.mock("../../api/phoneMarkQueries");

const GRANT = { view: true, add: true, edit: false, delete: false, reach: null };

const contact = callContact;
const listWith = myCallList;
const doneRow = callDone;
const second = myCallList().toCall[1]!;

let appState: ((s: string) => void)[] = [];
const backFromDialler = () => act(async () => appState.forEach((h) => h("active")));
const nav = makeNavigation<"Calling">();

async function mount(list = listWith(), params: { tab?: "callbacks" } | undefined = undefined) {
  jest.mocked(fetchMyCallList).mockResolvedValue(envelope(list));
  const r = await renderWithProviders(<CallingScreen navigation={nav} route={makeRoute("Calling", params)} />);
  await screen.findByRole("tab", { name: /^To call/ });
  return r;
}
const menu = (name: string) => screen.getByRole("menuitem", { name });
const openResult = async (who = "First Trader") => fireEvent.press(screen.getByRole("button", { name: `Save result for ${who}` }));

beforeEach(() => {
  appState = [];
  jest.spyOn(AppState, "addEventListener").mockImplementation((_t, h) => {
    appState.push(h as (s: string) => void);
    return { remove: jest.fn() } as never;
  });
  jest.spyOn(Linking, "openURL").mockResolvedValue(true);
  seedAuth({ access: { modules: { leads: GRANT } } });
});

it("shows the band counts, the three tabs with numbers, and the first contact's card", async () => {
  await mount(listWith({ done: [doneRow()] }));
  await waitFor(() => expect(screen.getByText("2 left · 5 called today")).toBeOnTheScreen());
  expect(screen.getByRole("tab", { name: "To call, 2" })).toBeOnTheScreen();
  expect(screen.getByRole("tab", { name: "Callbacks, 0" })).toBeOnTheScreen();
  expect(screen.getByRole("tab", { name: "Done today, 1" })).toBeOnTheScreen();
  const card = screen.getByTestId("contact-9");
  expect(within(card).getByText("First Trader")).toBeOnTheScreen();
  expect(within(card).getByText("9825012345")).toBeOnTheScreen();
  expect(within(card).getByText("MLSS-0001")).toBeOnTheScreen();
  expect(within(card).getByText("New Delhi")).toBeOnTheScreen();
});

it("has no search field and the rows under the card cannot be pressed", async () => {
  await mount();
  expect(screen.queryByLabelText(/search/i)).toBeNull();
  expect(within(screen.getByTestId("up-next")).getByText("Second Trader")).toBeOnTheScreen();
  expect(screen.queryByRole("button", { name: /Second Trader/ })).toBeNull();
  expect(screen.queryByTestId("contact-10")).toBeNull();
});

it("the Script link opens the list's script", async () => {
  await mount();
  await fireEvent.press(screen.getByRole("button", { name: "Script" }));
  expect(screen.getByText("Namaste ji")).toBeOnTheScreen();
});

it("Call dials the number and, back in the app, opens the result sheet for that contact", async () => {
  await mount();
  expect(screen.queryByRole("menuitem", { name: "No answer" })).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "Call First Trader" }));
  expect(Linking.openURL).toHaveBeenCalledWith("tel:9825012345");
  await backFromDialler();
  expect(menu("No answer")).toBeOnTheScreen();
});

it("coming back to the app without having dialled opens nothing", async () => {
  await mount();
  await backFromDialler();
  expect(screen.queryByRole("menuitem", { name: "No answer" })).toBeNull();
});

it("a phone that cannot dial says so and opens no sheet on return", async () => {
  jest.mocked(Linking.openURL).mockRejectedValueOnce(new Error("no dialer"));
  await mount();
  await fireEvent.press(screen.getByRole("button", { name: "Call First Trader" }));
  expect(await screen.findByText("Can't open the dialer on this device")).toBeOnTheScreen();
  await backFromDialler();
  expect(screen.queryByRole("menuitem", { name: "No answer" })).toBeNull();
});

it("No answer saves with the dial time and swaps in the list the server returned", async () => {
  jest.mocked(saveCallResult).mockResolvedValue(envelope({ ...listWith({ toCall: [second], head: { ToCall: 1, CalledToday: 6 }, done: [doneRow()] }), AttemptId: 41 }));
  await mount();
  await fireEvent.press(screen.getByRole("button", { name: "Call First Trader" }));
  await backFromDialler();
  await fireEvent.press(menu("No answer"));
  await waitFor(() => expect(saveCallResult).toHaveBeenCalledWith({
    ContactId: 9, Result: "no_answer", Notes: null, DialedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/), CallbackAt: null,
  }));
  expect(await screen.findByTestId("contact-10")).toBeOnTheScreen();
  expect(screen.getByText("1 left · 6 called today")).toBeOnTheScreen();
  expect(fetchMyCallList).toHaveBeenCalledTimes(1); // no second request
});

it("[holding] after a result the finished contact is nowhere on To call or Callbacks — only the list the server sent is shown", async () => {
  jest.mocked(saveCallResult).mockResolvedValue(envelope({ AttemptId: 41, ...listWith({ toCall: [second], done: [doneRow({ CanUndo: false })] }) }));
  await mount();
  await openResult();
  await fireEvent.press(menu("Busy"));
  await screen.findByTestId("contact-10");
  expect(screen.queryByText("First Trader")).toBeNull();
  expect(screen.queryByText("9825012345")).toBeNull();
  await fireEvent.press(screen.getByRole("tab", { name: /^Callbacks/ }));
  expect(screen.queryByText("First Trader")).toBeNull();
});

it("[holding] Done today shows the name and result of a finished call, never its number or a Call button", async () => {
  await mount(listWith({ toCall: [], head: { ToCall: 0 }, done: [doneRow({ CanUndo: false })] }));
  await fireEvent.press(screen.getByRole("tab", { name: /^Done today/ }));
  const done = screen.getByTestId("done-today");
  expect(within(done).getByText("First Trader")).toBeOnTheScreen();
  expect(within(done).getByText("No answer")).toBeOnTheScreen();
  expect(within(done).getByText("4:31 pm")).toBeOnTheScreen();
  expect(screen.queryByText("9825012345")).toBeNull();
  expect(screen.queryByRole("button", { name: /^Call/ })).toBeNull();
  expect(screen.queryByRole("button", { name: /^Undo/ })).toBeNull();
});

it("[holding] a 404 on save (the contact is not theirs) shows the server's sentence and refetches the list", async () => {
  jest.mocked(saveCallResult).mockRejectedValue(serverError(404, "Contact not found"));
  await mount();
  await openResult();
  await fireEvent.press(menu("Not interested"));
  expect(await screen.findByText("Contact not found")).toBeOnTheScreen();
  await waitFor(() => expect(fetchMyCallList).toHaveBeenCalledTimes(2));
});

it("a 409 shows the server's sentence and uses the list it sent", async () => {
  const err = serverError(409, "This contact is no longer on your list");
  err.response!.data = envelope(listWith({ toCall: [second], head: { ToCall: 1 } }), { success: false, message: "This contact is no longer on your list" });
  jest.mocked(saveCallResult).mockRejectedValue(err);
  await mount();
  await openResult();
  await fireEvent.press(menu("Wrong number"));
  expect(await screen.findByText("This contact is no longer on your list")).toBeOnTheScreen();
  expect(await screen.findByTestId("contact-10")).toBeOnTheScreen();
  expect(fetchMyCallList).toHaveBeenCalledTimes(1);
});

it("a network failure on a one-tap result says so and reopens the result sheet", async () => {
  jest.mocked(saveCallResult).mockRejectedValue(new AxiosError("Network Error", "ERR_NETWORK"));
  await mount();
  await openResult();
  await fireEvent.press(menu("Busy"));
  expect(await screen.findByText("Could not save. Try again.")).toBeOnTheScreen();
  expect(menu("Busy")).toBeOnTheScreen();
  expect(screen.getByTestId("contact-9")).toBeOnTheScreen();
});

it("Save result without calling sends DialedAt null", async () => {
  jest.mocked(saveCallResult).mockResolvedValue(envelope({ AttemptId: 41, ...listWith() }));
  await mount();
  await openResult();
  await fireEvent.press(menu("Busy"));
  await waitFor(() => expect(saveCallResult).toHaveBeenCalledWith({ ContactId: 9, Result: "busy", Notes: null, DialedAt: null, CallbackAt: null }));
});

it("Undo on the toast calls undoCallResult with the attempt id and swaps in its list", async () => {
  jest.mocked(saveCallResult).mockResolvedValue(envelope({ ...listWith({ toCall: [second], done: [doneRow()] }), AttemptId: 41 }));
  jest.mocked(undoCallResult).mockResolvedValue(envelope(listWith()));
  await mount();
  await openResult();
  await fireEvent.press(menu("No answer"));
  expect(await screen.findByText("Saved: No answer")).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "Undo" }));
  await waitFor(() => expect(undoCallResult).toHaveBeenCalledWith(41));
  expect(await screen.findByTestId("contact-9")).toBeOnTheScreen();
});

it("no Undo is offered when the server says the call cannot be undone", async () => {
  jest.mocked(saveCallResult).mockResolvedValue(envelope({ AttemptId: 41, ...listWith({ done: [doneRow({ CanUndo: false })] }) }));
  await mount();
  await openResult();
  await fireEvent.press(menu("No answer"));
  expect(await screen.findByText("Saved: No answer")).toBeOnTheScreen();
  expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
});

it("says the next batch arrived when the reply has Given 10", async () => {
  jest.mocked(saveCallResult).mockResolvedValue(envelope({ AttemptId: 41, ...listWith({ head: { Given: 10 }, done: [doneRow()] }) }));
  await mount();
  await openResult();
  await fireEvent.press(menu("No answer"));
  expect(await screen.findByText("All done. Next 10 are here")).toBeOnTheScreen();
});

it("Interested creates the lead with the edited name, note and tomorrow's date, and stays on the screen", async () => {
  jest.mocked(convertCallContact).mockResolvedValue(envelope({ ...listWith({ toCall: [second] }), LeadId: 77 }));
  await mount();
  await openResult();
  await fireEvent.press(menu("Interested"));
  expect(screen.getByLabelText("Name").props.value).toBe("First Trader");
  await fireEvent.changeText(screen.getByLabelText("Name"), "Mrs. Harjeet Kaur");
  await fireEvent.changeText(screen.getByLabelText("Note"), "Wants 3 kW");
  await fireEvent.press(screen.getByRole("button", { name: "Create lead" }));
  await waitFor(() => expect(convertCallContact).toHaveBeenCalledWith({
    ContactId: 9, Name: "Mrs. Harjeet Kaur", Notes: "Wants 3 kW", FirstFollowupAt: localDay(1), DialedAt: null,
  }));
  expect(await screen.findByText("Lead created")).toBeOnTheScreen();
  expect(nav.navigate).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole("button", { name: "Open" }));
  expect(nav.navigate).toHaveBeenCalledWith("LeadDetail", { leadId: 77 });
});

it("a network failure keeps the Interested sheet open with what was typed", async () => {
  jest.mocked(convertCallContact).mockRejectedValue(new AxiosError("Network Error", "ERR_NETWORK"));
  await mount();
  await openResult();
  await fireEvent.press(menu("Interested"));
  await fireEvent.changeText(screen.getByLabelText("Name"), "Harjeet");
  await fireEvent.press(screen.getByRole("button", { name: "Create lead" }));
  expect(await screen.findAllByText("Could not save. Try again.")).not.toHaveLength(0);
  expect(screen.getByLabelText("Name").props.value).toBe("Harjeet");
  expect(screen.getByTestId("contact-9")).toBeOnTheScreen();
});

it.each([
  ["hours", "Outside calling hours"],
  ["paused", "Calling is paused"],
  ["finished", "This list is finished"],
  ["manual", "All called"],
] as const)("empty state %s", async (reason, title) => {
  await mount(listWith({ toCall: [], head: { ToCall: 0, EmptyReason: reason } }));
  expect(screen.getByText(title)).toBeOnTheScreen();
});

it("an empty To call with callbacks waiting offers to open them", async () => {
  await mount(listWith({ toCall: [], callbacks: [contact({ CallbackAt: `${localDay(1)}T11:00:00` })], head: { ToCall: 0, Callbacks: 1, EmptyReason: "manual" } }));
  await fireEvent.press(screen.getByRole("button", { name: "See callbacks" }));
  expect(screen.getByTestId("contact-9")).toBeOnTheScreen();
});

it("outside calling hours with contacts left, a note says so above the card", async () => {
  await mount(listWith({ head: { OutsideHours: true } }));
  expect(screen.getByText("Outside calling hours — new contacts arrive tomorrow")).toBeOnTheScreen();
});

it("Callbacks are in time order and an overdue one is marked", async () => {
  const later = contact({ Id: 21, Name: "Later One", CallbackAt: `${localDay(1)}T11:00:00` });
  const late = contact({ Id: 22, Name: "Late One", CallbackAt: `${localDay(-1)}T16:00:00` });
  await mount(listWith({ callbacks: [later, late], head: { Callbacks: 2 } }), { tab: "callbacks" });
  expect(screen.getByRole("tab", { name: "Callbacks, 2" })).toBeOnTheScreen();
  const ids = screen.getAllByTestId(/^contact-/).map((n) => n.props.testID);
  expect(ids).toEqual(["contact-22", "contact-21"]);
  expect(within(screen.getByTestId("contact-22")).getByText(/^Overdue · /)).toBeOnTheScreen();
  expect(within(screen.getByTestId("contact-21")).getByText("tomorrow 11:00 am")).toBeOnTheScreen();
  expect(screen.getByText("Callbacks stay with you. You hold 2 of 20.")).toBeOnTheScreen();
});

it("a callback dials and returns to the result sheet the same way", async () => {
  await mount(listWith({ toCall: [], callbacks: [contact({ Id: 22, Name: "Late One", CallbackAt: `${localDay(1)}T11:00:00` })] }), { tab: "callbacks" });
  await fireEvent.press(screen.getByRole("button", { name: "Call Late One" }));
  await backFromDialler();
  expect(menu("No answer")).toBeOnTheScreen();
});

it("Done today is read-only, with Undo only where the server allows it", async () => {
  jest.mocked(undoCallResult).mockResolvedValue(envelope(listWith()));
  await mount(listWith({ done: [doneRow(), doneRow({ AttemptId: 40, Name: "Old One", Result: "interested", LeadId: 5, CanUndo: false })] }));
  await fireEvent.press(screen.getByRole("tab", { name: /^Done today/ }));
  expect(screen.getByText("Interested · lead")).toBeOnTheScreen();
  expect(screen.queryByRole("button", { name: "Undo Old One" })).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "Undo First Trader" }));
  await waitFor(() => expect(undoCallResult).toHaveBeenCalledWith(41));
  expect(await screen.findByText("Undone")).toBeOnTheScreen();
});

it("empty Callbacks and Done today tabs say so", async () => {
  await mount();
  await fireEvent.press(screen.getByRole("tab", { name: /^Callbacks/ }));
  expect(screen.getByText("No callbacks")).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("tab", { name: /^Done today/ }));
  expect(screen.getByText("No calls yet today")).toBeOnTheScreen();
});

it("a failed load shows the error card and Try again refetches", async () => {
  jest.mocked(fetchMyCallList).mockRejectedValue(serverError(500, "boom"));
  await renderWithProviders(<CallingScreen navigation={nav} route={makeRoute("Calling", undefined)} />);
  await fireEvent.press(await screen.findByRole("button", { name: /try again/i }));
  await waitFor(() => expect(fetchMyCallList).toHaveBeenCalledTimes(2));
});

it("rows up next carry a do-not-call or caution chip", async () => {
  await mount(listWith({ toCall: [contact(), contact({ Id: 11, Name: "Marked A", PhoneMark: "dnc" }), contact({ Id: 12, Name: "Marked B", PhoneMark: "caution" })] }));
  const next = screen.getByTestId("up-next");
  expect(within(next).getByText("Do not call")).toBeOnTheScreen();
  expect(within(next).getByText("Caution")).toBeOnTheScreen();
});

it("a done row with no name reads Contact; a refused undo says why and refetches", async () => {
  jest.mocked(undoCallResult).mockRejectedValue(serverError(409, "Too late to undo"));
  await mount(listWith({ done: [doneRow({ Name: null, Result: "dnc" })] }));
  await fireEvent.press(screen.getByRole("tab", { name: /^Done today/ }));
  expect(within(screen.getByTestId("done-today")).getByText("Do not call")).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "Undo Contact" }));
  expect(await screen.findByText("Too late to undo")).toBeOnTheScreen();
  await waitFor(() => expect(fetchMyCallList).toHaveBeenCalledTimes(2));
});

it("back goes back", async () => {
  await mount();
  await fireEvent.press(screen.getByRole("button", { name: "Go back" }));
  expect(nav.goBack).toHaveBeenCalled();
});

// The sheets' own paths (note, call back, do not call, caution) are in ResultSheets.test.tsx.
