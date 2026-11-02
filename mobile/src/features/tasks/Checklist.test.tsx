import { fireEvent, screen } from "@testing-library/react-native";

import { colors } from "../../theme";
import type { TaskChecklistItem } from "../../types/api";
import { renderWithProviders } from "../../test/renderWithProviders";
import { flat } from "../../test/style";
import { Checklist, type ChecklistProps } from "./Checklist";

const item = (Id: number, ItemText: string, IsCompleted = false): TaskChecklistItem => ({
  Id,
  TaskId: 1,
  ItemText,
  IsCompleted,
  SortOrder: Id,
});
const ITEMS = [item(1, "Order parts", true), item(2, "Fit inverter"), item(3, "Test run")];

const mount = async (props: Partial<ChecklistProps> = {}) => {
  const fns = { onToggle: jest.fn(), onLongPress: jest.fn(), onAdd: jest.fn() };
  await renderWithProviders(<Checklist items={ITEMS} {...fns} canToggle canManage {...props} />);
  return fns;
};

it("08: the summary reads 'x of y' steps done with the percentage and why", async () => {
  await mount();
  expect(screen.getByText("1 of 3")).toBeOnTheScreen();
  expect(screen.getByText("steps done")).toBeOnTheScreen();
  expect(screen.getByText("33%")).toBeOnTheScreen();
  expect(screen.getByRole("progressbar")).toHaveAccessibilityValue({ now: 33 });
  expect(screen.getByText("The task completes itself when every step is ticked.")).toBeOnTheScreen();
});

it("done rows are struck through and muted; open rows carry a grip", async () => {
  await mount();
  expect(screen.getByRole("checkbox", { name: "Order parts" })).toBeChecked();
  expect(screen.getByRole("checkbox", { name: "Fit inverter" })).not.toBeChecked();
  expect(flat(screen.getByText("Order parts"))).toMatchObject({ textDecorationLine: "line-through", color: colors.textMuted });
  expect(flat(screen.getByText("Fit inverter")).textDecorationLine).toBeUndefined();
});

it("a tap toggles that step; a long-press opens its actions", async () => {
  const { onToggle, onLongPress } = await mount();
  await fireEvent.press(screen.getByRole("checkbox", { name: "Fit inverter" }));
  expect(onToggle).toHaveBeenCalledWith(ITEMS[1]);
  await fireEvent(screen.getByRole("checkbox", { name: "Test run" }), "longPress");
  expect(onLongPress).toHaveBeenCalledWith(ITEMS[2]);
});

it("'Add a step' is the last row", async () => {
  const { onAdd } = await mount();
  await fireEvent.press(screen.getByRole("button", { name: "Add a step" }));
  expect(onAdd).toHaveBeenCalled();
});

it("without the right to tick or manage: no toggles, no add row, no long-press", async () => {
  const { onToggle, onLongPress } = await mount({ canToggle: false, canManage: false });
  await fireEvent.press(screen.getByRole("checkbox", { name: "Fit inverter" }));
  await fireEvent(screen.getByRole("checkbox", { name: "Fit inverter" }), "longPress");
  expect(onToggle).not.toHaveBeenCalled();
  expect(onLongPress).not.toHaveBeenCalled();
  expect(screen.queryByRole("button", { name: "Add a step" })).toBeNull();
});

it("an empty list explains why steps matter, and offers to add one to a manager", async () => {
  const { onAdd } = await mount({ items: [] });
  expect(screen.getByText("Nothing to do yet")).toBeOnTheScreen();
  await fireEvent.press(screen.getByText("Add a step"));
  expect(onAdd).toHaveBeenCalled();
});

it("an empty list for a member says completion is driven by it", async () => {
  await mount({ items: [], canManage: false });
  expect(screen.getByText("This task has no checklist. Completion is driven by that list.")).toBeOnTheScreen();
});
