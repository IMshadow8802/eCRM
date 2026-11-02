import { BottomSheetModal } from "@gorhom/bottom-sheet";
import { fireEvent, screen } from "@testing-library/react-native";
import { Trash2 } from "lucide-react-native";

import { renderWithProviders } from "../test/renderWithProviders";
import { ActionSheet } from "./ActionSheet";

const dismiss = jest.spyOn(BottomSheetModal.prototype, "dismiss");

it("a row closes the sheet, then runs its action", async () => {
  const order: string[] = [];
  dismiss.mockImplementation(() => void order.push("dismiss"));
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
