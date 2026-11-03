import { BottomSheetModal } from "@gorhom/bottom-sheet";
import { fireEvent, screen } from "@testing-library/react-native";
import { CircleCheck, Pencil, Trash2 } from "lucide-react-native";

import { colors } from "../theme";
import { renderWithProviders } from "../test/renderWithProviders";
import { flat } from "../test/style";
import { ActionSheet } from "./ActionSheet";

const dismiss = jest.spyOn(BottomSheetModal.prototype, "dismiss");

it("a row closes the sheet, then runs its action", async () => {
  const order: string[] = [];
  dismiss.mockImplementationOnce(() => void order.push("dismiss"));
  const remove = jest.fn(() => order.push("remove"));
  await renderWithProviders(
    <ActionSheet
      title="Task"
      actions={[
        { key: "move", label: "Move to…", sublabel: "Pick a column", selected: true, onPress: jest.fn() },
        { key: "delete", label: "Delete", icon: Trash2, tone: "danger", onPress: remove },
      ]}
    />,
  );
  expect(screen.getByText("Pick a column")).toBeOnTheScreen();
  await fireEvent.press(screen.getByText("Delete"));
  expect(order).toEqual(["dismiss", "remove"]);
});

it("a disabled row does nothing", async () => {
  const onPress = jest.fn();
  await renderWithProviders(
    <ActionSheet actions={[{ key: "x", label: "Reopen", disabled: true, onPress }]} />,
  );
  await fireEvent.press(screen.getByText("Reopen"));
  expect(onPress).not.toHaveBeenCalled();
});

it("no actions shows the caller's empty message", async () => {
  await renderWithProviders(<ActionSheet actions={[]} emptyMessage="No columns" />);
  expect(screen.getByText("No columns")).toBeOnTheScreen();
});

it("no actions and no message shows a default", async () => {
  await renderWithProviders(<ActionSheet actions={[]} />);
  expect(screen.getByText("Nothing to choose from.")).toBeOnTheScreen();
});

it("a picker: badge, plain icon in its tone, chip; the selected danger row is tinted red", async () => {
  await renderWithProviders(
    <ActionSheet
      actions={[
        { key: "a", label: "Done", badge: { tone: "green", icon: CircleCheck }, chip: { label: "Current" }, selected: false, onPress: jest.fn() },
        { key: "b", label: "Edit", icon: Pencil, selected: false, onPress: jest.fn() },
        { key: "c", label: "Primary", icon: Pencil, tone: "primary", selected: false, onPress: jest.fn() },
        { key: "d", label: "Lost", icon: Trash2, tone: "danger", selected: true, onPress: jest.fn() },
      ]}
    />,
  );
  expect(screen.getAllByRole("radio")).toHaveLength(4);
  expect(screen.getByText("Current")).toBeOnTheScreen();
  expect(flat(screen.getByRole("radio", { name: "Lost" })).backgroundColor).toBe(colors.dangerRowTint);
  expect(flat(screen.getByRole("radio", { name: "Edit" })).backgroundColor).toBeUndefined();
});
