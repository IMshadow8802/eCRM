import { fireEvent, screen } from "@testing-library/react-native";

import type { TaskChecklistItem } from "../../types/api";
import { renderWithProviders } from "../../test/renderWithProviders";
import { Checklist, type ChecklistProps } from "./Checklist";

const item = (Id: number, ItemText: string, IsCompleted = false): TaskChecklistItem => ({
  Id,
  TaskId: 1,
  ItemText,
  IsCompleted,
  SortOrder: Id,
});
const ITEMS = [item(1, "Order parts", true), item(2, "Fit inverter"), item(3, "Test run")];

const mount = (props: Partial<ChecklistProps> = {}) => {
  const onToggle = jest.fn();
  const onDelete = jest.fn();
  return renderWithProviders(
    <Checklist items={ITEMS} onToggle={onToggle} onDelete={onDelete} canToggle canManage {...props} />,
  ).then(() => ({ onToggle, onDelete }));
};

it("shows progress derived from the ticked items", async () => {
  await mount();
  expect(screen.getByText("1 of 3 done")).toBeOnTheScreen();
  expect(screen.getByText("33%")).toBeOnTheScreen();
  expect(screen.getByRole("checkbox", { name: "Order parts" })).toBeChecked();
  expect(screen.getByRole("checkbox", { name: "Fit inverter" })).not.toBeChecked();
});

it("a fully ticked list reads 100%", async () => {
  await mount({ items: [item(1, "Only step", true)] });
  expect(screen.getByText("1 of 1 done")).toBeOnTheScreen();
  expect(screen.getByText("100%")).toBeOnTheScreen();
});

it("ticking the box or the label toggles that item", async () => {
  const { onToggle } = await mount();
  await fireEvent.press(screen.getByRole("checkbox", { name: "Fit inverter" }));
  expect(onToggle).toHaveBeenLastCalledWith(ITEMS[1]);
  await fireEvent.press(screen.getByText("Test run"));
  expect(onToggle).toHaveBeenLastCalledWith(ITEMS[2]);
});

it("without the right to tick, nothing toggles", async () => {
  const { onToggle } = await mount({ canToggle: false });
  expect(screen.queryByRole("checkbox")).toBeNull();
  await fireEvent.press(screen.getByText("Test run"));
  expect(onToggle).not.toHaveBeenCalled();
});

it("removes an item, but only for someone who manages the list", async () => {
  const { onDelete } = await mount();
  await fireEvent.press(screen.getByLabelText("Remove Fit inverter"));
  expect(onDelete).toHaveBeenCalledWith(ITEMS[1]);
});

it("offers no remove without manage rights", async () => {
  await mount({ canManage: false });
  expect(screen.queryByLabelText(/^Remove/)).toBeNull();
});

it("the last step cannot be removed — a task with no steps could never complete", async () => {
  await mount({ items: [item(1, "Only step")] });
  expect(screen.queryByLabelText("Remove Only step")).toBeNull();
});

it("an empty list explains what the checklist is for", async () => {
  await mount({ items: [] });
  expect(screen.getByText("Nothing to do yet")).toBeOnTheScreen();
  expect(screen.getByText(/Ticking them all off is what marks it complete/)).toBeOnTheScreen();
});

it("an empty list for someone who cannot add says so differently", async () => {
  await mount({ items: [], canManage: false });
  expect(screen.getByText(/This task has no checklist/)).toBeOnTheScreen();
});
