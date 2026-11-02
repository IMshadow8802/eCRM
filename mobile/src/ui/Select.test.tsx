import { BottomSheetModal } from "@gorhom/bottom-sheet";
import { fireEvent, screen } from "@testing-library/react-native";

import { renderWithProviders } from "../test/renderWithProviders";
import { Select } from "./Select";

// The bottom-sheet mock renders its content inline; present/dismiss are the
// observable "opened" / "closed" a user would see.
const present = jest.spyOn(BottomSheetModal.prototype, "present");
const dismiss = jest.spyOn(BottomSheetModal.prototype, "dismiss");

const OPTIONS = [
  { value: 1, label: "Open", sublabel: "Waiting on us" },
  { value: 2, label: "On hold" },
  { value: 3, label: "Closed" },
];

it("single: shows the placeholder, opens the sheet, picks one value and closes", async () => {
  const onChange = jest.fn();
  await renderWithProviders(
    <Select label="Status" sheetTitle="Pick a status" value={null} options={OPTIONS} onChange={onChange} />,
  );
  expect(screen.getByText("Select…")).toBeOnTheScreen();
  expect(screen.getByText("Waiting on us")).toBeOnTheScreen();
  await fireEvent.press(screen.getByText("Select…"));
  expect(present).toHaveBeenCalledTimes(1);
  await fireEvent.press(screen.getByText("On hold"));
  expect(onChange).toHaveBeenCalledWith(2);
  expect(dismiss).toHaveBeenCalledTimes(1);
});

it("single: the trigger names the chosen option", async () => {
  await renderWithProviders(<Select label="Status" value={3} options={OPTIONS} onChange={jest.fn()} />);
  // Trigger + the sheet's row.
  expect(screen.getAllByText("Closed")).toHaveLength(2);
});

it("multi: each tap toggles and commits the whole set, the sheet stays open", async () => {
  const onChange = jest.fn();
  await renderWithProviders(
    <Select label="Tags" multiple value={[1]} options={OPTIONS} onChange={onChange} />,
  );
  expect(screen.getAllByText("Open")).toHaveLength(2);
  await fireEvent.press(screen.getAllByText("Open")[0]!);
  await fireEvent.press(screen.getByText("Closed"));
  expect(onChange).toHaveBeenLastCalledWith([1, 3]);
  await fireEvent.press(screen.getAllByText("Open")[1]!);
  expect(onChange).toHaveBeenLastCalledWith([3]);
  expect(dismiss).not.toHaveBeenCalled();
});

it("multi: more than one chosen reads as a count", async () => {
  await renderWithProviders(<Select multiple value={[1, 2]} options={OPTIONS} onChange={jest.fn()} />);
  expect(screen.getByText("2 selected")).toBeOnTheScreen();
});

it("disabled never opens; required, error and an empty list are shown", async () => {
  await renderWithProviders(
    <Select label="Owner" required error="Pick an owner" disabled value={null} options={[]} onChange={jest.fn()} />,
  );
  expect(screen.getByText(" *")).toBeOnTheScreen();
  expect(screen.getByText("Pick an owner")).toBeOnTheScreen();
  expect(screen.getByText("Nothing to choose from.")).toBeOnTheScreen();
  await fireEvent.press(screen.getByText("Select…"));
  expect(present).not.toHaveBeenCalled();
});
