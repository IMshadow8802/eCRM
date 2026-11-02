import { createRef, useState } from "react";
import { BottomSheetModal } from "@gorhom/bottom-sheet";
import { act, fireEvent, screen } from "@testing-library/react-native";

import { renderWithProviders } from "../test/renderWithProviders";
import { Button } from "./Button";
import { ComposeSheet, type ComposeSheetProps } from "./ComposeSheet";
import type { SheetRef } from "./Sheet";

const FIELDS: ComposeSheetProps["fields"] = [
  { key: "hours", placeholder: "Hours", label: "Hours worked", numeric: true, required: true },
  { key: "note", placeholder: "What did you do?", multiline: true },
];
const CHOICES: ComposeSheetProps["choices"] = [
  { key: "kind", label: "Kind", required: true, options: [{ value: "call", label: "Call" }, { value: 2, label: "Visit" }] },
];

const submitButton = () => screen.getByRole("button", { name: "Log time" });

async function renderSheet(props: Partial<ComposeSheetProps> = {}) {
  const onSubmit = jest.fn();
  await renderWithProviders(
    <ComposeSheet title="Log time" submitLabel="Log time" fields={FIELDS} choices={CHOICES} onSubmit={onSubmit} {...props} />,
  );
  return { onSubmit };
}

it("submit stays disabled until every required field and choice is filled", async () => {
  const { onSubmit } = await renderSheet();
  // Kind (choice) and Hours (field) are both required.
  expect(screen.getAllByText(" *")).toHaveLength(2);
  expect(submitButton()).toBeDisabled();

  await fireEvent.changeText(screen.getByPlaceholderText("Hours"), "   ");
  await fireEvent.press(screen.getByText("Visit"));
  expect(submitButton()).toBeDisabled();
  await fireEvent.press(submitButton());
  expect(onSubmit).not.toHaveBeenCalled();

  await fireEvent.changeText(screen.getByPlaceholderText("Hours"), " 2.5 ");
  expect(submitButton()).toBeEnabled();
  await fireEvent.press(submitButton());
  // Trimmed; an untouched optional field is sent as "".
  expect(onSubmit).toHaveBeenCalledWith({ hours: "2.5", note: "" }, { kind: 2 });
});

it("a field can be required only for some choices", async () => {
  // A breach reason of "Other" needs remarks (web BreachReasonDialog).
  const { onSubmit } = await renderSheet({
    fields: [{ key: "note", placeholder: "Note", required: (c) => c.kind === "call" }],
  });
  await fireEvent.press(screen.getByText("Visit"));
  expect(submitButton()).toBeEnabled();
  await fireEvent.press(screen.getByText("Call"));
  expect(submitButton()).toBeDisabled();
  await fireEvent.changeText(screen.getByPlaceholderText("Note"), "why");
  await fireEvent.press(submitButton());
  expect(onSubmit).toHaveBeenCalledWith({ note: "why" }, { kind: "call" });
});

// The real sheet calls onDismiss when it closes; the mock's dismiss is a no-op.
jest
  .spyOn(BottomSheetModal.prototype, "dismiss")
  .mockImplementation(function (this: unknown) {
    (this as { props: { onDismiss?: () => void } }).props.onDismiss?.();
  });

// A caller whose save fails: it sets `error` and leaves the sheet open. Every
// real caller dismisses through the ref in its mutation's onSuccess.
const sheet = createRef<SheetRef>();
function FailingCaller() {
  const [error, setError] = useState<string | null>(null);
  return (
    <ComposeSheet
      ref={sheet}
      title="Log time"
      submitLabel="Log time"
      fields={FIELDS}
      error={error}
      onSubmit={() => setError("Timesheet is locked")}
    />
  );
}

it("a failed submit keeps the typed text and shows why; only a dismiss clears it", async () => {
  await renderWithProviders(<FailingCaller />);
  await fireEvent.changeText(screen.getByPlaceholderText("Hours"), "3");
  await fireEvent.changeText(screen.getByPlaceholderText("What did you do?"), "Site visit");
  await fireEvent.press(submitButton());

  expect(await screen.findByText("Timesheet is locked")).toBeOnTheScreen();
  expect(screen.getByPlaceholderText("Hours")).toHaveDisplayValue("3");
  expect(screen.getByPlaceholderText("What did you do?")).toHaveDisplayValue("Site visit");

  await act(async () => sheet.current?.dismiss());
  expect(screen.getByPlaceholderText("Hours")).toHaveDisplayValue("");
});

it("busy shows a spinner instead of the label and blocks a second submit", async () => {
  const { onSubmit } = await renderSheet({ choices: [], busy: true });
  await fireEvent.changeText(screen.getByPlaceholderText("Hours"), "1");
  // The sheet title is left; the button's label became a spinner.
  expect(screen.getAllByText("Log time")).toHaveLength(1);
  await fireEvent.press(screen.getByRole("button"));
  expect(onSubmit).not.toHaveBeenCalled();
});

it("a single one-line field submits from the keyboard", async () => {
  const onSubmit = jest.fn();
  await renderWithProviders(
    <ComposeSheet title="Add item" submitLabel="Add" fields={[{ key: "text", placeholder: "Item", required: true }]} onSubmit={onSubmit} />,
  );
  const input = screen.getByPlaceholderText("Item");
  await fireEvent.changeText(input, "Call back");
  await fireEvent(input, "submitEditing");
  expect(onSubmit).toHaveBeenCalledWith({ text: "Call back" }, {});
});

// Editing a comment: the sheet opens holding the comment's text.
function Seeded() {
  const [seed, setSeed] = useState<Record<string, string> | undefined>({ hours: "2" });
  const [, bump] = useState(0);
  return (
    <>
      <Button title="Rerender" onPress={() => bump((n) => n + 1)} />
      <Button title="New seed" onPress={() => setSeed({ hours: "5" })} />
      <Button title="No seed" onPress={() => setSeed(undefined)} />
      <ComposeSheet title="Edit" submitLabel="Save" fields={FIELDS} initialValues={seed} onSubmit={jest.fn()} />
    </>
  );
}

it("a new prefill reseeds the fields; a re-render with the same one keeps what was typed", async () => {
  await renderWithProviders(<Seeded />);
  const hours = () => screen.getByPlaceholderText("Hours");
  expect(hours()).toHaveDisplayValue("2");

  await fireEvent.changeText(hours(), "3");
  await fireEvent.press(screen.getByText("Rerender"));
  expect(hours()).toHaveDisplayValue("3");

  await fireEvent.press(screen.getByText("New seed"));
  expect(hours()).toHaveDisplayValue("5");

  await fireEvent.press(screen.getByText("No seed"));
  expect(hours()).toHaveDisplayValue("");
});

// Found on the emulator (Task 30): under "adjustResize" gorhom leaves the lift
// to a window resize, which Android's edge-to-edge (forced on RN 0.86) never
// does — the sheet stayed put and the keyboard covered Notes and "Log call".
// The sheet has to lift itself: keyboard-interactive, gorhom's own pan mode.
it("lifts itself over the keyboard instead of waiting for a window resize", async () => {
  // RNTL 14 has no UNSAFE_getByType; read the props the (mocked, class) sheet
  // is rendered with. The real export is typed as a function component.
  type Props = { keyboardBehavior?: string; android_keyboardInputMode?: string };
  type Host = { props: Props };
  const Modal = BottomSheetModal as unknown as { prototype: { render(this: Host): unknown } };
  const render = Modal.prototype.render;
  let props: Props | undefined;
  const spy = jest.spyOn(Modal.prototype, "render").mockImplementation(function (this: Host) {
    props = this.props;
    return render.call(this);
  });
  await renderSheet();
  spy.mockRestore();
  expect(props?.keyboardBehavior).toBe("interactive");
  expect(props?.android_keyboardInputMode).not.toBe("adjustResize");
});

// Found on the emulator (Task 30): Resolve needs remarks, but only the
// resolution chips carried a star — the button sat disabled with no hint why.
it("marks a required text field like a required choice", async () => {
  await renderSheet({
    choices: [],
    fields: [
      { key: "remarks", label: "Remarks", placeholder: "Why", required: true },
      { key: "note", label: "Note", placeholder: "Optional" },
      { key: "ref", label: "Reference", placeholder: "Ref", required: (picked) => picked.kind === "x" },
    ],
  });
  expect(screen.getByText("Remarks", { exact: false })).toHaveTextContent("Remarks *");
  expect(screen.getByText("Note")).toHaveTextContent(/^Note$/);
  expect(screen.getByText("Reference")).toHaveTextContent(/^Reference$/);
});

// Maestro needs a stable handle on a field whose placeholder is just "0".
it("every field carries a testID from its key", async () => {
  await renderSheet();
  expect(screen.getByTestId("compose-hours")).toBe(screen.getByPlaceholderText("Hours"));
  expect(screen.getByTestId("compose-note")).toBe(screen.getByPlaceholderText("What did you do?"));
});
