import { KeyboardAvoidingView, StyleSheet } from "react-native";
import { fireEvent, render, screen } from "@testing-library/react-native";

import { colors } from "../theme";
import { Dialog } from "./Dialog";
import { Text } from "./Text";

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

it("not dismissable: backdrop and back button do nothing; children render inside the card", async () => {
  const h = handlers();
  await render(
    <Dialog visible title="Sign in again" dismissable={false} {...h}>
      <Text>field goes here</Text>
    </Dialog>,
  );
  expect(screen.getByText("field goes here")).toBeOnTheScreen();
  await fireEvent.press(screen.getByText("Sign in again").parent!.parent!);
  await fireEvent(screen.root!, "requestClose");
  expect(h.onCancel).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole("button", { name: "Cancel" }));
  expect(h.onCancel).toHaveBeenCalledTimes(1);
});

it("a notice has a single OK button", async () => {
  await render(<Dialog visible title="Saved" confirmLabel="OK" hideCancel {...handlers()} />);
  expect(screen.getAllByRole("button")).toHaveLength(1);
  expect(screen.queryByText("Cancel")).toBeNull();
});

// Found on the emulator (Task 30), on the re-sign-in dialog.
describe("room for its content", () => {
  it("labels too long to share a row stack, so neither is cut", async () => {
    await render(
      <Dialog visible title="Sign in again" confirmLabel="Sign in" cancelLabel="Sign in as someone else" {...handlers()} />,
    );
    const row = screen.getByText("Sign in as someone else").parent?.parent?.parent;
    // Column-reverse: the primary button sits on top.
    expect(StyleSheet.flatten(row?.props.style).flexDirection).toBe("column-reverse");
  });

  it("short labels keep sharing a row", async () => {
    await render(<Dialog visible title="Delete task?" confirmLabel="Delete" {...handlers()} />);
    const row = screen.getByText("Cancel").parent?.parent?.parent;
    expect(StyleSheet.flatten(row?.props.style).flexDirection).toBe("row");
  });

  it("dims the keyboard's padding too: the scrim is on the outer layer", async () => {
    // KeyboardAvoidingView pads itself above the keyboard; with the scrim on
    // the inner backdrop that strip showed the screen undimmed (iOS floating keyboard).
    await render(<Dialog visible title="Sign in again" {...handlers()} />);
    const backdrop = screen.getByText("Sign in again").parent?.parent;
    const outer = backdrop?.parent;
    expect(StyleSheet.flatten(backdrop?.props.style).backgroundColor).toBeUndefined();
    expect(StyleSheet.flatten(outer?.props.style).backgroundColor).toBe(colors.overlay);
  });

  it("moves out of the keyboard's way itself", async () => {
    // Edge-to-edge Android never resizes the window for the keyboard, so the
    // card stayed centred and the keyboard covered its buttons.
    type Host = { props: { behavior?: string } };
    const KAV = KeyboardAvoidingView as unknown as { prototype: { render(this: Host): unknown } };
    const render0 = KAV.prototype.render;
    let behavior: string | undefined;
    const spy = jest.spyOn(KAV.prototype, "render").mockImplementation(function (this: Host) {
      behavior = this.props.behavior;
      return render0.call(this);
    });
    await render(<Dialog visible title="Sign in again" {...handlers()} />);
    spy.mockRestore();
    expect(behavior).toBe("padding");
  });
});
