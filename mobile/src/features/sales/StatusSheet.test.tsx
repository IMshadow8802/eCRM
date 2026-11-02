import { fireEvent, screen, within } from "@testing-library/react-native";

import { chipTones } from "../../theme";
import { flat } from "../../test/style";

import type { Lookup } from "../../types/api";
import { renderWithProviders } from "../../test/renderWithProviders";
import { StatusSheet, type StatusSheetProps } from "./StatusSheet";

// gorhom's mock makes BottomSheetTextInput a bare TextInput; tag it so a test
// can see the sheet's fields are gorhom's (a plain TextInput loses focus there).
jest.mock("@gorhom/bottom-sheet", () => {
  const mock = jest.requireActual("@gorhom/bottom-sheet/mock");
  const { createElement, forwardRef } = jest.requireActual("react");
  const { TextInput } = jest.requireActual("react-native");
  return {
    ...mock,
    BottomSheetTextInput: forwardRef((props: object, ref: unknown) => createElement(TextInput, { ...props, ref, nativeID: "sheet-input" })),
  };
});

const st = (Id: number, Value: string, Code: string, SortOrder = Id) => ({ Id, Value, Code, SortOrder, Kind: "lead_status" }) as Lookup;
const STATUSES = [st(1, "New", "open"), st(2, "Contacted", "open"), st(4, "Qualified", "qualified"), st(5, "Won", "converted"), st(6, "Lost", "lost")];
const REASONS = [{ Id: 31, Value: "Price too high" }, { Id: 32, Value: "No budget" }] as Lookup[];

const mount = async (patch: Partial<StatusSheetProps> = {}) => {
  const onSubmit = jest.fn();
  const view = await renderWithProviders(
    <StatusSheet
      lead={{ Name: "Rohit Verma", StatusId: 4, StatusName: "Qualified" }}
      statuses={STATUSES}
      lostReasons={REASONS}
      lostReasonsLoaded
      onSubmit={onSubmit}
      {...patch}
    />,
  );
  return { onSubmit, view };
};
const save = () => screen.getByRole("button", { name: /^Save/ });

it("E 25: every status with its badge, the current one marked, Won asks for a value", async () => {
  await mount();
  expect(screen.getByText("Change status")).toBeOnTheScreen();
  expect(screen.getByText("Rohit Verma · now Qualified")).toBeOnTheScreen();
  expect(screen.getAllByRole("radio").map((r) => r.props.accessibilityLabel)).toEqual(["New", "Contacted", "Qualified", "Won", "Lost"]);
  expect(screen.getByText("Current")).toBeOnTheScreen();
  expect(screen.getByText("asks final value")).toBeOnTheScreen();
  expect(save()).toBeDisabled();
});

it("a plain status saves through setLeadStatus with no reason; the current one cannot be re-saved", async () => {
  const { onSubmit } = await mount();
  await fireEvent.press(screen.getByRole("radio", { name: "Qualified" }));
  expect(save()).toBeDisabled();
  await fireEvent.press(screen.getByRole("radio", { name: "Contacted" }));
  expect(screen.getByText("Save · mark contacted")).toBeOnTheScreen();
  await fireEvent.press(save());
  expect(onSubmit).toHaveBeenCalledWith({ kind: "status", StatusId: 2, LostReasonId: null });
});

it("Lost requires a reason, then sends it", async () => {
  const { onSubmit } = await mount();
  await fireEvent.press(screen.getByRole("radio", { name: "Lost" }));
  expect(screen.getByTestId("lost-panel")).toBeOnTheScreen();
  expect(screen.getByText("A reason is required for Lost.")).toBeOnTheScreen();
  expect(save()).toBeDisabled();
  await fireEvent.press(save());
  expect(onSubmit).not.toHaveBeenCalled();
  // E 25: a Select; the pick shows in the field as a red chip.
  expect(screen.getByRole("button", { name: "Why was it lost?: Choose a reason" })).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("radio", { name: "Price too high" }));
  const field = screen.getByRole("button", { name: "Why was it lost?: Price too high" });
  expect(flat(within(field).getByText("Price too high").parent).backgroundColor).toBe(chipTones.red.fill);
  await fireEvent.press(screen.getByText("Save · mark lost"));
  expect(onSubmit).toHaveBeenCalledWith({ kind: "status", StatusId: 6, LostReasonId: 31 });
});

it("with no lost reasons configured it says so", async () => {
  await mount({ lostReasons: [] });
  await fireEvent.press(screen.getByRole("radio", { name: "Lost" }));
  expect(screen.getByText("No lost reasons are set up. Add them on the web first.")).toBeOnTheScreen();
});

it("says nothing about missing reasons while they load", async () => {
  await mount({ lostReasons: [], lostReasonsLoaded: false });
  await fireEvent.press(screen.getByRole("radio", { name: "Lost" }));
  expect(screen.queryByText(/No lost reasons/)).toBeNull();
});

it("Won needs the final value and converts — never a setLeadStatus to converted", async () => {
  const { onSubmit } = await mount();
  await fireEvent.press(screen.getByRole("radio", { name: "Won" }));
  expect(save()).toBeDisabled();
  await fireEvent.changeText(screen.getByPlaceholderText("Amount in rupees"), "1,20,000");
  await fireEvent.changeText(screen.getByPlaceholderText("Optional note for the history"), " signed ");
  await fireEvent.press(screen.getByText("Save · mark won"));
  expect(onSubmit).toHaveBeenCalledTimes(1);
  expect(onSubmit).toHaveBeenCalledWith({ kind: "won", WonValue: 120000, Remarks: "signed" });
});

it("Won's value and remarks are sheet inputs, so they keep focus; Save sits 14 below", async () => {
  await mount();
  await fireEvent.press(screen.getByRole("radio", { name: "Won" }));
  expect(screen.getByPlaceholderText("Amount in rupees").props.nativeID).toBe("sheet-input");
  expect(screen.getByPlaceholderText("Optional note for the history").props.nativeID).toBe("sheet-input");
  expect(flat(save()).marginTop).toBe(14);
});

it("a won value that is not a number is refused in the sheet; blank remarks go as null", async () => {
  const { onSubmit } = await mount();
  await fireEvent.press(screen.getByRole("radio", { name: "Won" }));
  await fireEvent.changeText(screen.getByPlaceholderText("Amount in rupees"), "abc");
  await fireEvent.press(screen.getByText("Save · mark won"));
  expect(onSubmit).not.toHaveBeenCalled();
  expect(screen.getByText("Enter the value this lead was won for.")).toBeOnTheScreen();
  await fireEvent.changeText(screen.getByPlaceholderText("Amount in rupees"), "0");
  await fireEvent.press(screen.getByText("Save · mark won"));
  expect(onSubmit).toHaveBeenCalledWith({ kind: "won", WonValue: 0, Remarks: null });
});

it("shows the server's refusal", async () => {
  await mount({ error: "Lead is locked" });
  expect(screen.getByText("Lead is locked")).toBeOnTheScreen();
});

it("no statuses configured says so", async () => {
  await mount({ statuses: [], lead: { Name: "X", StatusId: null as unknown as number, StatusName: null } });
  expect(screen.getByText("No statuses are configured. Add them on the web first.")).toBeOnTheScreen();
  expect(screen.getByText("X · now —")).toBeOnTheScreen();
});
