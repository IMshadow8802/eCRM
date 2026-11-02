import { BottomSheetModal } from "@gorhom/bottom-sheet";
import { act, fireEvent, screen } from "@testing-library/react-native";
import { CircleCheck, CirclePause } from "lucide-react-native";

import { renderWithProviders } from "../test/renderWithProviders";
import type { Lookup } from "../types/api";
import { flat } from "../test/style";
import { LogCallSheet, type LogCallSheetProps } from "./LogCallSheet";

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

const lookup = (Id: number, Value: string): Lookup => ({ Id, CompId: 1, Kind: "call_outcome", Value, SortOrder: Id, IsActive: true, Code: null });
const THEN = [
  { value: "open", label: "Keep open" },
  { value: "onhold", label: "Put on hold", tone: "butter" as const, icon: CirclePause },
  { value: "resolve", label: "Resolve", tone: "green" as const, icon: CircleCheck },
];

it("the notes are the shared Input as a sheet input, 76 tall at least, labelled and required", async () => {
  await mount();
  const notes = screen.getByTestId("logcall-notes");
  expect(notes.props.nativeID).toBe("sheet-input");
  expect(flat(notes.parent!)).toMatchObject({ minHeight: 76, borderRadius: 12, borderWidth: 1 });
  expect(screen.getByLabelText("What was said")).toBe(notes);
  expect(screen.getByText("What was said", { exact: false })).toHaveTextContent("What was said *");
});

const mount = async (props: Partial<LogCallSheetProps> = {}) => {
  const onSubmit = jest.fn();
  await renderWithProviders(<LogCallSheet subtitle="Rakesh Sharma · 98250 12345" onSubmit={onSubmit} {...props} />);
  return onSubmit;
};
const save = () => screen.getByRole("button", { name: "Save call" });

it("E 24 header: sky phone-call badge, title and contact line", async () => {
  await mount();
  expect(screen.getByText("Log call")).toBeOnTheScreen();
  expect(screen.getByText("Rakesh Sharma · 98250 12345")).toBeOnTheScreen();
  expect(screen.getByRole("button", { name: "Close" })).toBeOnTheScreen();
});

it("notes are required; stepper ±1 and quick pills set the minutes", async () => {
  const onSubmit = await mount();
  expect(save()).toBeDisabled();
  await fireEvent.press(screen.getByRole("button", { name: "More duration" }));
  await fireEvent.press(screen.getByRole("button", { name: "More duration" }));
  expect(screen.getByText("3 min")).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "Less duration" }));
  expect(screen.getByText("2 min")).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("radio", { name: "10" }));
  expect(screen.getByText("10 min")).toBeOnTheScreen();
  await fireEvent.changeText(screen.getByTestId("logcall-notes"), "  Trips after 10 min  ");
  await fireEvent.press(screen.getByRole("tab", { name: "Incoming" }));
  await fireEvent.press(save());
  expect(onSubmit).toHaveBeenCalledWith({ direction: "in", minutes: 10, notes: "Trips after 10 min", outcomeId: null, then: null });
});

it("No answer appears only with a matching outcome, and sends out + that outcome with no duration", async () => {
  const onSubmit = await mount({ outcomes: [lookup(4, "Connected"), lookup(9, "No Answer")] });
  await fireEvent.press(screen.getByRole("tab", { name: "No answer" }));
  expect(screen.queryByText("Duration")).toBeNull();
  await fireEvent.changeText(screen.getByTestId("logcall-notes"), "Rang out");
  await fireEvent.press(save());
  expect(onSubmit).toHaveBeenCalledWith({ direction: "out", minutes: 0, notes: "Rang out", outcomeId: 9, then: null });
});

it("without such an outcome there are two directions", async () => {
  await mount({ outcomes: [lookup(4, "Connected")] });
  expect(screen.getAllByRole("tab")).toHaveLength(2);
});

it("complaints get Then: Keep open by default, a pick is sent; busy and error show", async () => {
  const onSubmit = await mount({ then: THEN, error: "Not allowed" });
  expect(screen.getByRole("radio", { name: "Keep open" })).toBeChecked();
  await fireEvent.press(screen.getByRole("radio", { name: "Put on hold" }));
  await fireEvent.changeText(screen.getByTestId("logcall-notes"), "Revisit");
  await fireEvent.press(save());
  expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ then: "onhold", minutes: 1, direction: "out" }));
  expect(screen.getByText("Not allowed")).toBeOnTheScreen();
});

it("a dismiss clears what was typed and picked, for the next call", async () => {
  // The gorhom mock never dismisses: read its onDismiss and call it, as closing would.
  type Props = { onDismiss?: () => void };
  const Modal = BottomSheetModal as unknown as { prototype: { render(this: { props: Props }): unknown } };
  const original = Modal.prototype.render;
  let props: Props = {};
  const spy = jest.spyOn(Modal.prototype, "render").mockImplementation(function (this: { props: Props }) {
    props = this.props;
    return original.call(this);
  });
  await mount({ then: THEN });
  await fireEvent.changeText(screen.getByTestId("logcall-notes"), "Half typed");
  await fireEvent.press(screen.getByRole("radio", { name: "Resolve" }));
  await act(async () => props.onDismiss?.());
  spy.mockRestore();
  expect(screen.getByTestId("logcall-notes")).toHaveDisplayValue("");
  expect(screen.getByRole("radio", { name: "Keep open" })).toBeChecked();
});
