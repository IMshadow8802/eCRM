import { fireEvent, render, screen } from "@testing-library/react-native";
import { ArrowRight, Bell, ChevronLeft, Phone, Plus } from "lucide-react-native";

import { colors } from "../theme";
import { Button, type ButtonSize, type ButtonVariant } from "./Button";
import { CircleAction, HeaderButton, IconButton } from "./IconButton";

import { flat } from "../test/style";
// A finger landing and staying down, so the pressed style can be read.
const holdTouch = () => {
  const touch = { pageX: 0, pageY: 0, locationX: 0, locationY: 0, timestamp: 0 };
  return { persist: () => {}, currentTarget: { measure: () => {} }, nativeEvent: { ...touch, touches: [touch], changedTouches: [touch] } };
};
const hold = async (name: string) => {
  await fireEvent(screen.getByRole("button", { name }), "responderGrant", holdTouch());
  return flat(screen.getByRole("button", { name }));
};

describe("Button (E .btn)", () => {
  it("a press runs the action", async () => {
    const onPress = jest.fn();
    await render(<Button title="Save" icon={Plus} size="sm" onPress={onPress} />);
    await fireEvent.press(screen.getByRole("button", { name: "Save" }));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it("a trailing icon follows the label, 18 in the text colour (E 01 Continue →)", async () => {
    await render(<Button title="Continue" trailingIcon={ArrowRight} />);
    const row = screen.getByText("Continue").parent!;
    const last = row.children[row.children.length - 1] as { props: { size?: number; color?: string; stroke?: string } };
    expect(row.children.indexOf(screen.getByText("Continue"))).toBe(0);
    expect(last.props.size ?? 18).toBe(18);
    expect(last.props.stroke ?? last.props.color).toBe(colors.textOnBrand);
  });

  it("disabled blocks the press and is announced", async () => {
    const onPress = jest.fn();
    await render(<Button title="Save" disabled onPress={onPress} />);
    const button = screen.getByRole("button");
    expect(button).toBeDisabled();
    await fireEvent.press(button);
    expect(onPress).not.toHaveBeenCalled();
  });

  it("loading blocks the press, hides the label and reads as busy", async () => {
    const onPress = jest.fn();
    await render(<Button title="Save" variant="secondary" loading onPress={onPress} />);
    const button = screen.getByRole("button");
    expect(button).toBeBusy();
    expect(screen.queryByText("Save")).toBeNull();
    await fireEvent.press(button);
    expect(onPress).not.toHaveBeenCalled();
  });

  it.each<[ButtonSize, number]>([["md", 48], ["lg", 48], ["sm", 36], ["xs", 32]])("%s is %i tall and fully round", async (size, h) => {
    await render(<Button title="Go" size={size} />);
    expect(flat(screen.getByRole("button"))).toMatchObject({ height: h, borderRadius: h / 2 });
  });

  it.each<[ButtonVariant, string, string, string]>([
    ["primary", colors.primary, colors.primaryPressed, colors.textOnBrand],
    ["secondary", colors.secondaryFill, colors.secondaryPressed, colors.text],
    ["danger", colors.danger, colors.dangerText, colors.textOnBrand],
    ["onBrand", colors.surface, colors.fieldTint, colors.primary],
    ["success", colors.success, colors.successText, colors.textOnBrand],
    ["ghost", colors.transparentBorder, colors.fieldTint, colors.primary],
  ])("%s: solid fill, solid pressed fill, its ink", async (variant, fill, pressed, ink) => {
    await render(<Button title="Go" variant={variant} />);
    expect(flat(screen.getByRole("button")).backgroundColor).toBe(fill);
    expect(flat(screen.getByText("Go")).color).toBe(ink);
    expect((await hold("Go")).backgroundColor).toBe(pressed);
  });

  // §9.3: a disabled control is a solid muted fill, never faded with opacity.
  it.each<ButtonVariant>(["primary", "danger", "ghost", "onBrand"])("disabled %s is the solid disabled fill", async (variant) => {
    await render(<Button title="Go" variant={variant} fullWidth disabled />);
    const style = flat(screen.getByRole("button"));
    expect(style.backgroundColor).toBe(colors.disabledBg);
    expect(style.opacity).toBeUndefined();
    expect(flat(screen.getByText("Go")).color).toBe(colors.disabledText);
  });
});

describe("IconButton (E .ib)", () => {
  it("40 round Navy 800 with a white 20 icon; pressed is Navy 700; a badge sits at the corner", async () => {
    const onPress = jest.fn();
    await render(<IconButton icon={Bell} accessibilityLabel="Inbox" badge={63} onPress={onPress} />);
    expect(flat(screen.getByRole("button", { name: "Inbox" }))).toMatchObject({ width: 40, height: 40, borderRadius: 20, backgroundColor: colors.bandRaised });
    expect(screen.getByText("63")).toBeOnTheScreen();
    expect((await hold("Inbox")).backgroundColor).toBe(colors.bandField);
    await fireEvent.press(screen.getByRole("button", { name: "Inbox" }));
    expect(onPress).toHaveBeenCalled();
  });

  it("ghost is transparent, 36 wide, pulled 8 left", async () => {
    await render(<IconButton icon={ChevronLeft} variant="ghost" accessibilityLabel="Back" onPress={jest.fn()} />);
    expect(flat(screen.getByRole("button", { name: "Back" }))).toMatchObject({ width: 36, marginLeft: -8, backgroundColor: colors.transparentBorder });
  });
});

describe("HeaderButton (E .hbtn)", () => {
  it("36 tall primary pill; ghost is Navy 800, or Navy 700 on a raised band", async () => {
    const onPress = jest.fn();
    await render(
      <>
        <HeaderButton label="New" icon={Plus} onPress={onPress} />
        <HeaderButton label="Cancel" variant="ghost" onPress={jest.fn()} />
        <HeaderButton label="Mark read" variant="ghost" on="raised" onPress={jest.fn()} />
      </>,
    );
    expect(flat(screen.getByRole("button", { name: "New" }))).toMatchObject({ height: 36, borderRadius: 18, backgroundColor: colors.primary, paddingLeft: 12, paddingRight: 14 });
    expect(flat(screen.getByRole("button", { name: "Cancel" })).backgroundColor).toBe(colors.bandRaised);
    expect(flat(screen.getByRole("button", { name: "Mark read" })).backgroundColor).toBe(colors.bandField);
    expect((await hold("New")).backgroundColor).toBe(colors.primaryPressed);
    expect((await hold("Cancel")).backgroundColor).toBe(colors.bandField);
    expect((await hold("Mark read")).backgroundColor).toBe(colors.bandRaised);
    await fireEvent.press(screen.getByRole("button", { name: "New" }));
    expect(onPress).toHaveBeenCalled();
  });

  it("small is 28 with a chevron; disabled is solid and inert", async () => {
    const onPress = jest.fn();
    await render(<><HeaderButton label="Change status" small onPress={jest.fn()} /><HeaderButton label="Save" disabled onPress={onPress} /></>);
    expect(flat(screen.getByRole("button", { name: "Change status" }))).toMatchObject({ height: 28, paddingRight: 10 });
    const save = screen.getByRole("button", { name: "Save" });
    expect(flat(save).backgroundColor).toBe(colors.disabledBg);
    await fireEvent.press(save);
    expect(onPress).not.toHaveBeenCalled();
  });
});

describe("CircleAction", () => {
  it("44 green call by default, 40 primary when asked", async () => {
    const onPress = jest.fn();
    await render(<><CircleAction icon={Phone} accessibilityLabel="Call" onPress={onPress} /><CircleAction icon={Phone} tone="primary" size={40} accessibilityLabel="Call lead" onPress={jest.fn()} /></>);
    expect(flat(screen.getByRole("button", { name: "Call" }))).toMatchObject({ width: 44, height: 44, borderRadius: 22, backgroundColor: colors.success });
    expect(flat(screen.getByRole("button", { name: "Call lead" }))).toMatchObject({ width: 40, backgroundColor: colors.primary });
    expect((await hold("Call")).backgroundColor).toBe(colors.successText);
    expect((await hold("Call lead")).backgroundColor).toBe(colors.primaryPressed);
    await fireEvent.press(screen.getByRole("button", { name: "Call" }));
    expect(onPress).toHaveBeenCalled();
  });
});
