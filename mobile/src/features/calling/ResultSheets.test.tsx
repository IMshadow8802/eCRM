import { createRef } from "react";
import { act, fireEvent, screen, waitFor } from "@testing-library/react-native";

import { saveCallResult } from "../../api/callingQueries";
import { setPhoneMark } from "../../api/phoneMarkQueries";
import { callContact, envelope, localDay, myCallList, serverError } from "../../test/fixtures";
import { pickDay, pickTime } from "../../test/pickers";
import { renderWithProviders } from "../../test/renderWithProviders";
import { ResultSheets, type ResultSheetsHandle } from "./ResultSheets";

jest.mock("../../api/callingQueries");
jest.mock("../../api/phoneMarkQueries");

const onSaved = jest.fn();
const onRefused = jest.fn();
const menu = (name: string) => screen.getByRole("menuitem", { name });

async function open({ canMark = false, dialedAt = null as string | null } = {}) {
  const ref = createRef<ResultSheetsHandle>();
  await renderWithProviders(<ResultSheets ref={ref} canMark={canMark} onSaved={onSaved} onRefused={onRefused} />);
  await act(async () => ref.current!.open(callContact(), dialedAt));
}

beforeEach(() => {
  jest.mocked(saveCallResult).mockResolvedValue(envelope({ ...myCallList(), AttemptId: 41 }));
  jest.mocked(setPhoneMark).mockResolvedValue(envelope({}));
});

it("titles the sheet with the contact and offers every result; Do not call is last", async () => {
  await open();
  const names = screen.getAllByRole("menuitem").map((n) => n.props.accessibilityLabel);
  expect(names.slice(0, 7)).toEqual(["No answer", "Busy", "Not interested", "Wrong number", "Call back", "Interested", "Add a note"]);
  expect(names.indexOf("Do not call")).toBeGreaterThan(names.indexOf("Add a note"));
  expect(screen.getAllByText("First Trader").length).toBeGreaterThan(0);
});

it("hands the saved list and the label to the screen", async () => {
  await open({ dialedAt: "2026-11-24T16:05" });
  await fireEvent.press(menu("Not interested"));
  await waitFor(() => expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ AttemptId: 41 }), { label: "Not interested" }));
  expect(saveCallResult).toHaveBeenCalledWith({ ContactId: 9, Result: "not_interested", Notes: null, DialedAt: "2026-11-24T16:05", CallbackAt: null });
});

it("a note added first travels with the result and shows on its row", async () => {
  await open();
  await fireEvent.press(menu("Add a note"));
  await fireEvent.changeText(screen.getByLabelText("Note for this call"), "Call after lunch");
  await fireEvent.press(screen.getByRole("button", { name: "Keep note" }));
  expect(screen.getByText("Call after lunch")).toBeOnTheScreen();
  await fireEvent.press(menu("Busy"));
  await waitFor(() => expect(saveCallResult).toHaveBeenCalledWith(expect.objectContaining({ Result: "busy", Notes: "Call after lunch" })));
});

it("Call back → Tomorrow books 11:00 tomorrow; No time sends no CallbackAt", async () => {
  await open();
  await fireEvent.press(menu("Call back"));
  await fireEvent.press(menu("Tomorrow"));
  await waitFor(() => expect(saveCallResult).toHaveBeenCalledWith(expect.objectContaining({ Result: "callback", CallbackAt: `${localDay(1)}T11:00` })));
  await act(async () => undefined);
  await open();
  await fireEvent.press(menu("Call back"));
  await fireEvent.press(menu("No time"));
  await waitFor(() => expect(saveCallResult).toHaveBeenLastCalledWith(expect.objectContaining({ Result: "callback", CallbackAt: null })));
});

it("Call back → Pick date & time needs both before Save", async () => {
  await open();
  await fireEvent.press(menu("Call back"));
  await fireEvent.press(menu("Pick date & time"));
  const book = () => screen.getByRole("button", { name: "Book callback" });
  expect(book()).toBeDisabled();
  await fireEvent.press(screen.getByText("Choose a day"));
  await pickDay(localDay(2));
  expect(book()).toBeDisabled();
  await fireEvent.press(screen.getByText("Choose a time"));
  await pickTime("16:00");
  expect(book()).toBeEnabled();
  await fireEvent.press(book());
  await waitFor(() => expect(saveCallResult).toHaveBeenCalledWith(expect.objectContaining({ Result: "callback", CallbackAt: `${localDay(2)}T16:00` })));
});

it("a refused pick (the time already passed on the server) stays open with the server's sentence", async () => {
  jest.mocked(saveCallResult).mockRejectedValue(serverError(400, "Pick a callback time in the future"));
  await open();
  await fireEvent.press(menu("Call back"));
  await fireEvent.press(menu("Pick date & time"));
  await fireEvent.press(screen.getByText("Choose a day"));
  await pickDay(localDay(2));
  await fireEvent.press(screen.getByText("Choose a time"));
  await pickTime("16:00");
  await fireEvent.press(screen.getByRole("button", { name: "Book callback" }));
  expect((await screen.findAllByText("Pick a callback time in the future")).length).toBeGreaterThan(0);
  expect(onSaved).not.toHaveBeenCalled();
  expect(onRefused).not.toHaveBeenCalled();
});

it("Do not call needs a note and sends Result dnc", async () => {
  await open();
  await fireEvent.press(menu("Do not call"));
  const submit = screen.getByRole("button", { name: "Do not call" });
  expect(submit).toBeDisabled();
  await fireEvent.changeText(screen.getByLabelText("Why? An admin reads this"), "Said stop calling");
  await fireEvent.press(submit);
  await waitFor(() => expect(saveCallResult).toHaveBeenCalledWith({ ContactId: 9, Result: "dnc", Notes: "Said stop calling", DialedAt: null, CallbackAt: null }));
});

it("a 409 on Do not call goes to the screen, not the sheet", async () => {
  const err = serverError(409, "This contact is no longer on your list");
  jest.mocked(saveCallResult).mockRejectedValue(err);
  await open();
  await fireEvent.press(menu("Do not call"));
  await fireEvent.changeText(screen.getByLabelText("Why? An admin reads this"), "x");
  await fireEvent.press(screen.getByRole("button", { name: "Do not call" }));
  await waitFor(() => expect(onRefused).toHaveBeenCalledWith(err));
});

it("Call with caution marks the number and returns to the result sheet without saving a result", async () => {
  await open({ canMark: true });
  await fireEvent.press(menu("Call with caution"));
  await fireEvent.changeText(screen.getByLabelText("What should the next caller know?"), "Speaks only Punjabi");
  await fireEvent.press(screen.getByRole("button", { name: "Mark" }));
  await waitFor(() => expect(setPhoneMark).toHaveBeenCalledWith({ Mobile: "9825012345", Mark: "caution", Note: "Speaks only Punjabi" }));
  expect(await screen.findByText("Marked")).toBeOnTheScreen();
  expect(saveCallResult).not.toHaveBeenCalled();
  expect(menu("No answer")).toBeOnTheScreen();
});

it("a refused mark shows the server's sentence in the sheet", async () => {
  jest.mocked(setPhoneMark).mockRejectedValue(serverError(403, "You do not have permission"));
  await open({ canMark: true });
  await fireEvent.press(menu("Call with caution"));
  await fireEvent.changeText(screen.getByLabelText("What should the next caller know?"), "x");
  await fireEvent.press(screen.getByRole("button", { name: "Mark" }));
  expect((await screen.findAllByText("You do not have permission")).length).toBeGreaterThan(0);
});

it("without the calling edit grant there is no caution row (the server would refuse it)", async () => {
  await open({ canMark: false });
  expect(screen.queryByRole("menuitem", { name: "Call with caution" })).toBeNull();
});
