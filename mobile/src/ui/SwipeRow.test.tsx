import { Text as RNText } from "react-native";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { ChevronsUp, CircleCheck, CirclePause, Phone } from "lucide-react-native";

import { colors } from "../theme";
import { SwipeRow, type SwipeAction } from "./SwipeRow";

import { flat } from "../test/style";

// ReanimatedSwipeable under the reanimated jest mock reports its JS callbacks
// as "not worklets" — library noise in tests only. Swallow exactly that line.
const realError = console.error;
beforeEach(() => {
  jest.spyOn(console, "error").mockImplementation((msg: unknown, ...rest: unknown[]) => {
    if (!String(msg).includes("Some of the callbacks in the gesture are worklets")) realError(msg, ...rest);
  });
});
afterEach(() => jest.mocked(console.error).mockRestore());

const make = () => {
  const calls = { call: jest.fn(), hold: jest.fn(), resolve: jest.fn(), escalate: jest.fn() };
  const right: SwipeAction[] = [
    { key: "call", label: "Call", icon: Phone, color: "primary", onPress: calls.call },
    { key: "hold", label: "On hold", icon: CirclePause, color: "swipeHold", onPress: calls.hold },
    { key: "resolve", label: "Resolve", icon: CircleCheck, color: "success", onPress: calls.resolve },
  ];
  const left: SwipeAction[] = [{ key: "esc", label: "Escalate", icon: ChevronsUp, color: "escalate", wide: true, onPress: calls.escalate }];
  return { calls, left, right };
};

it("solid blocks: 72 wide (Escalate 88), each in its colour", async () => {
  const { left, right } = make();
  await render(<SwipeRow left={left} right={right}><RNText>Row</RNText></SwipeRow>);
  expect(flat(screen.getByRole("button", { name: "Call" }))).toMatchObject({ width: 72, backgroundColor: colors.primary });
  expect(flat(screen.getByRole("button", { name: "On hold" }))).toMatchObject({ width: 72, backgroundColor: colors.swipeHold });
  expect(flat(screen.getByRole("button", { name: "Resolve" }))).toMatchObject({ width: 72, backgroundColor: colors.success });
  expect(flat(screen.getByRole("button", { name: "Escalate" }))).toMatchObject({ width: 88, backgroundColor: colors.escalate });
});

it("no action runs until a block is tapped; a tap calls only that block's onPress", async () => {
  const { calls, left, right } = make();
  await render(<SwipeRow left={left} right={right}><RNText>Row</RNText></SwipeRow>);
  for (const fn of Object.values(calls)) expect(fn).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole("button", { name: "Resolve" }));
  expect(calls.resolve).toHaveBeenCalledTimes(1);
  expect(calls.call).not.toHaveBeenCalled();
  expect(calls.hold).not.toHaveBeenCalled();
  expect(calls.escalate).not.toHaveBeenCalled();
});

it("with no actions it is just the row", async () => {
  await render(<SwipeRow><RNText>Plain</RNText></SwipeRow>);
  expect(screen.getByText("Plain")).toBeOnTheScreen();
  expect(screen.queryByRole("button")).toBeNull();
});
