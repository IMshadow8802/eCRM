import { fireEvent, render, screen } from "@testing-library/react-native";

import { Dialog } from "./Dialog";

const handlers = () => ({ onConfirm: jest.fn(), onCancel: jest.fn() });

it("hidden renders nothing", async () => {
  await render(<Dialog visible={false} title="Delete task?" {...handlers()} />);
  expect(screen.queryByText("Delete task?")).toBeNull();
});

it("confirm and cancel each call their own handler", async () => {
  const h = handlers();
  await render(
    <Dialog visible title="Delete task?" message="This cannot be undone." confirmLabel="Delete" destructive {...h} />,
  );
  expect(screen.getByText("This cannot be undone.")).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "Delete" }));
  expect(h.onConfirm).toHaveBeenCalledTimes(1);
  await fireEvent.press(screen.getByRole("button", { name: "Cancel" }));
  expect(h.onCancel).toHaveBeenCalledTimes(1);
});

it("loading: confirm becomes a spinner, neither button nor the backdrop can fire", async () => {
  const h = handlers();
  await render(<Dialog visible title="Delete task?" confirmLabel="Delete" loading {...h} />);
  expect(screen.queryByText("Delete")).toBeNull();
  for (const button of screen.getAllByRole("button")) await fireEvent.press(button);
  await fireEvent.press(screen.getByText("Delete task?").parent!.parent!);
  expect(h.onConfirm).not.toHaveBeenCalled();
  expect(h.onCancel).not.toHaveBeenCalled();
});

it("a tap on the backdrop cancels; a tap inside the card does not", async () => {
  const h = handlers();
  await render(<Dialog visible title="Leave?" {...h} />);
  const card = screen.getByText("Leave?").parent!;
  await fireEvent.press(card);
  expect(h.onCancel).not.toHaveBeenCalled();
  await fireEvent.press(card.parent!);
  expect(h.onCancel).toHaveBeenCalledTimes(1);
  // Android's back button.
  await fireEvent(screen.root!, "requestClose");
  expect(h.onCancel).toHaveBeenCalledTimes(2);
});

it("a notice has a single OK button", async () => {
  await render(<Dialog visible title="Saved" confirmLabel="OK" hideCancel {...handlers()} />);
  expect(screen.getAllByRole("button")).toHaveLength(1);
  expect(screen.queryByText("Cancel")).toBeNull();
});
