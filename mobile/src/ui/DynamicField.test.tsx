import { fireEvent, screen } from "@testing-library/react-native";

import type { CustomFieldDef, CustomFieldType } from "../types/api";
import { renderWithProviders } from "../test/renderWithProviders";
import { DynamicField } from "./DynamicField";

const def = (Type: CustomFieldType, patch: Partial<CustomFieldDef> = {}): CustomFieldDef => ({
  Id: 1,
  CompId: 1,
  Entity: "lead",
  FieldKey: "f",
  Label: "Budget",
  Type,
  Options: null,
  IsRequired: false,
  SortOrder: 1,
  IsActive: true,
  CreatedBy: null,
  CreatedAt: null,
  ...patch,
});

async function renderField(field: CustomFieldDef, value: string | boolean = "", error?: string) {
  const onChange = jest.fn();
  await renderWithProviders(<DynamicField field={field} value={value} onChange={onChange} error={error} />);
  return onChange;
}

it("text: types the raw string", async () => {
  const onChange = await renderField(def("text", { IsRequired: true }), "old");
  expect(screen.getByText(" *")).toBeOnTheScreen();
  const input = screen.getByDisplayValue("old");
  expect(input.props.keyboardType).toBe("default");
  await fireEvent.changeText(input, "50000");
  expect(onChange).toHaveBeenCalledWith("50000");
});

it("number: decimal keypad; a non-string value shows empty", async () => {
  await renderField(def("number"), true);
  expect(screen.getByDisplayValue("").props.keyboardType).toBe("decimal-pad");
});

it("dropdown: plain-string options, picks the raw value", async () => {
  const onChange = await renderField(def("dropdown", { Options: '["Web","Referral"]' }));
  await fireEvent.press(screen.getByText("Referral"));
  expect(onChange).toHaveBeenCalledWith("Referral");
});

it("dropdown: value/label options show the label for the stored value", async () => {
  await renderField(def("dropdown", { Options: '[{"value":"a","label":"Apple"}]' }), "a");
  expect(screen.getAllByText("Apple")).toHaveLength(2); // trigger + row
});

it.each([["not json"], ['{"a":1}'], [null]])("dropdown: bad Options %p render an empty list, not a crash", async (Options) => {
  await renderField(def("dropdown", { Options }));
  expect(screen.getByText("Nothing to choose from.")).toBeOnTheScreen();
});

it("date: a picked day is sent as Y-M-D, clearing sends an empty string", async () => {
  const onChange = await renderField(def("date"), "2026-03-04");
  await fireEvent.press(screen.getByLabelText("Clear date"));
  expect(onChange).toHaveBeenCalledWith("");
  await fireEvent.press(screen.getByText("4 Mar 2026"));
  await fireEvent(screen.getByTestId("date-picker"), "valueChange", {}, new Date(2026, 2, 9));
  expect(onChange).toHaveBeenLastCalledWith("2026-03-09");
});

it("date: no value shows the placeholder", async () => {
  await renderField(def("date"));
  expect(screen.getByText("Select a date")).toBeOnTheScreen();
});

it("checkbox: toggles a real boolean and shows its error", async () => {
  const onChange = await renderField(def("checkbox", { Label: "Site visited", IsRequired: true }), true, "Required");
  const box = screen.getByRole("checkbox");
  expect(box).toBeChecked();
  expect(screen.getByText("Required")).toBeOnTheScreen();
  await fireEvent.press(box);
  expect(onChange).toHaveBeenCalledWith(false);
});

it("checkbox: anything but true reads as unchecked", async () => {
  const onChange = await renderField(def("checkbox"), "true");
  expect(screen.getByRole("checkbox")).not.toBeChecked();
  await fireEvent.press(screen.getByRole("checkbox"));
  expect(onChange).toHaveBeenCalledWith(true);
});
