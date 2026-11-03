// Sheet + SheetHeader (E .bsheet), ChoiceList / Radio, Stepper, Field parts.
import { createRef } from "react";
import { StyleSheet, Text as RNText } from "react-native";
import { BottomSheetModal } from "@gorhom/bottom-sheet";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { CircleCheck, CircleX, Tag } from "lucide-react-native";

import { colors } from "../theme";
import { renderWithProviders } from "../test/renderWithProviders";
import { ChoiceList, Radio, Stepper } from "./ChoiceList";
import { FieldHelp, FieldLabel, FieldRow } from "./Field";
import { Sheet, type SheetRef } from "./Sheet";

import { flat } from "../test/style";

describe("Sheet", () => {
  it("E header: badge, title, subtitle and a round close that dismisses", async () => {
    const dismiss = jest.spyOn(BottomSheetModal.prototype, "dismiss");
    const ref = createRef<SheetRef>();
    await renderWithProviders(
      <Sheet ref={ref} title="Lead status" subtitle="Patel Solar" badge={{ tone: "mint", icon: Tag }} padded>
        <RNText>rows</RNText>
      </Sheet>,
    );
    expect(flat(screen.getByText("Lead status"))).toMatchObject({ fontSize: 18 });
    expect(screen.getByText("Patel Solar")).toBeOnTheScreen();
    const close = screen.getByRole("button", { name: "Close" });
    expect(flat(close)).toMatchObject({ width: 36, height: 36, backgroundColor: colors.background });
    await fireEvent.press(close);
    expect(dismiss).toHaveBeenCalled();
    dismiss.mockRestore();
  });

  it("a title-only sheet has no close button (pre-E sheets)", async () => {
    await renderWithProviders(<Sheet title="Dependencies"><RNText>x</RNText></Sheet>);
    expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
  });

  it("radius 24, the grabber, the scrim", async () => {
    // RNTL 14 has no UNSAFE_getByType: read the props the mocked class sheet renders with.
    type Props = { backgroundStyle: unknown; handleIndicatorStyle: unknown; backdropComponent: unknown };
    const Modal = BottomSheetModal as unknown as { prototype: { render(this: { props: Props }): unknown } };
    const original = Modal.prototype.render;
    let props = {} as Props;
    const spy = jest.spyOn(Modal.prototype, "render").mockImplementation(function (this: { props: Props }) {
      props = this.props;
      return original.call(this);
    });
    await renderWithProviders(<Sheet><RNText>x</RNText></Sheet>);
    spy.mockRestore();
    expect(StyleSheet.flatten(props.backgroundStyle)).toMatchObject({ borderTopLeftRadius: 24, backgroundColor: colors.surface });
    expect(StyleSheet.flatten(props.handleIndicatorStyle)).toMatchObject({ width: 40, height: 5, backgroundColor: colors.grabber });
    expect(props.backdropComponent).toEqual(expect.any(Function));
  });
});

describe("ChoiceList (E 23, 25)", () => {
  const choices = [
    { value: "won", label: "Won", badge: { tone: "green" as const, icon: CircleCheck }, chip: { label: "Current", tone: "lilac" as const } },
    { value: "lost", label: "Lost", badge: { tone: "red" as const, icon: CircleX }, danger: true, note: "Needs a reason" },
    { value: "junk", label: "Junk", lead: <RNText>lead</RNText>, disabled: true },
  ];

  it("radios; the picked row is field-tinted (danger rows danger-tinted, danger label)", async () => {
    const onChange = jest.fn();
    const view = await render(<ChoiceList value="won" choices={choices} onChange={onChange} />);
    expect(screen.getByRole("radio", { name: "Won" })).toBeChecked();
    expect(flat(screen.getByRole("radio", { name: "Won" }))).toMatchObject({ backgroundColor: colors.fieldTint, borderRadius: 14 });
    expect(screen.getByText("Current")).toBeOnTheScreen();
    expect(screen.getByText("Needs a reason")).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("radio", { name: "Lost" }));
    expect(onChange).toHaveBeenCalledWith("lost");
    await view.rerender(<ChoiceList value="lost" choices={choices} onChange={onChange} />);
    expect(flat(screen.getByRole("radio", { name: "Lost" })).backgroundColor).toBe(colors.dangerRowTint);
    expect(flat(screen.getByText("Lost")).color).toBe(colors.dangerText);
    await fireEvent.press(screen.getByRole("radio", { name: "Junk" }));
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("multiple uses checkboxes; empty shows a message", async () => {
    const view = await render(<ChoiceList multiple value={["won", "lost"]} choices={choices} onChange={jest.fn()} />);
    expect(screen.getAllByRole("checkbox", { checked: true })).toHaveLength(2);
    await view.rerender(<ChoiceList value={null} choices={[]} onChange={jest.fn()} emptyMessage="No one in reach" />);
    expect(screen.getByText("No one in reach")).toBeOnTheScreen();
  });

  it("Radio: 2 px idle ring, 7 px primary when on", async () => {
    await render(<><Radio on /><Radio on={false} /></>);
    expect(flat(screen.getByTestId("radio-on"))).toMatchObject({ width: 22, borderWidth: 7, borderColor: colors.primary });
    expect(flat(screen.getByTestId("radio-off"))).toMatchObject({ borderWidth: 2, borderColor: colors.borderStrong });
  });
});

describe("Stepper (E 24)", () => {
  it("steps by one within min and max", async () => {
    const onChange = jest.fn();
    const view = await render(<Stepper label="Duration" value={0} onChange={onChange} min={0} max={1} format={(m) => `${m} min`} />);
    expect(screen.getByText("0 min")).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "Less duration" })).toBeDisabled();
    await fireEvent.press(screen.getByRole("button", { name: "More duration" }));
    expect(onChange).toHaveBeenCalledWith(1);
    await view.rerender(<Stepper label="Duration" value={1} onChange={onChange} max={1} />);
    expect(screen.getByRole("button", { name: "More duration" })).toBeDisabled();
    await fireEvent.press(screen.getByRole("button", { name: "Less duration" }));
    expect(onChange).toHaveBeenLastCalledWith(0);
  });
});

describe("Field parts", () => {
  it("label with star and tag; help or error; a pair row", async () => {
    await render(
      <FieldRow testID="pair">
        <FieldLabel label="Owner" required tag="Custom" />
        <FieldHelp hint="Shows in the history" />
        <FieldHelp error="Required" />
        <FieldHelp />
      </FieldRow>,
    );
    expect(screen.getByText("Owner", { exact: false })).toHaveTextContent("Owner *");
    expect(screen.getByText("Custom")).toBeOnTheScreen();
    expect(flat(screen.getByText("Shows in the history")).color).toBe(colors.textMuted);
    expect(flat(screen.getByText("Required")).color).toBe(colors.dangerText);
    expect(flat(screen.getByTestId("pair"))).toMatchObject({ flexDirection: "row", gap: 10 });
  });

  // Found on the device pass (2026-11-03): the task form's Priority/Type and
  // Due date sat in a FieldRow as bare Selects, which shrank to their chevron
  // and hid the value. Every child of a pair gets an equal half.
  it("a pair row gives each field an equal, shrinkable half", async () => {
    await render(
      <FieldRow>
        <RNText>Priority</RNText>
        <RNText>Type</RNText>
      </FieldRow>,
    );
    for (const name of ["Priority", "Type"]) {
      expect(flat(screen.getByText(name).parent)).toMatchObject({ flex: 1, minWidth: 0 });
    }
  });
});
