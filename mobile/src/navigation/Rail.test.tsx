import { fireEvent, screen } from "@testing-library/react-native";

import { colors } from "../theme";
import { renderWithProviders, seedAuth } from "../test/renderWithProviders";
import { flat } from "../test/style";
import { BottomBar } from "./BottomBar";
import { CreateSheet } from "./CreateSheet";
import { Rail } from "./Rail";

const holdTouch = () => {
  const touch = { pageX: 0, pageY: 0, locationX: 0, locationY: 0, timestamp: 0 };
  return { persist: () => {}, currentTarget: { measure: () => {} }, nativeEvent: { ...touch, touches: [touch], changedTouches: [touch] } };
};

beforeEach(() => seedAuth({ user: { FullName: "Ayush Mishra" } }));

it("E T1: 92 wide navy rail; logo, +, items, then More as the avatar; the active item marked at the left", async () => {
  const onPress = jest.fn();
  const onCreate = jest.fn();
  await renderWithProviders(
    <Rail items={["Home", "Leads", "Inbox", "More"]} active="Leads" onPress={onPress} badges={{ Inbox: 63 }} onCreate={onCreate} createLabel="Create" />,
  );
  expect(flat(screen.getByTestId("rail"))).toMatchObject({ width: 92, backgroundColor: colors.band });
  expect(flat(screen.getByTestId("indicator-Leads"))).toMatchObject({ left: 0, top: 14, bottom: 14, width: 3 });
  expect(screen.getByText("AM")).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("tab", { name: "More" }));
  expect(onPress).toHaveBeenCalledWith("More");
  await fireEvent.press(screen.getByRole("tab", { name: "Inbox" }));
  expect(onPress).toHaveBeenLastCalledWith("Inbox");
  const create = screen.getByRole("button", { name: "Create" });
  expect(flat(create)).toMatchObject({ width: 52, height: 52, borderRadius: 16, backgroundColor: colors.primary });
  await fireEvent(create, "responderGrant", holdTouch());
  expect(flat(screen.getByRole("button", { name: "Create" })).backgroundColor).toBe(colors.primaryPressed);
  await fireEvent.press(create);
  expect(onCreate).toHaveBeenCalled();
});

it("More active is marked; a rail without More draws no avatar", async () => {
  const view = await renderWithProviders(
    <Rail items={["Home", "More"]} active="More" onPress={jest.fn()} badges={{}} onCreate={jest.fn()} createLabel="Create" />,
  );
  expect(screen.getByRole("tab", { name: "More" })).toBeSelected();
  await view.unmount();
  await renderWithProviders(<Rail items={["Home"]} active={null} onPress={jest.fn()} badges={{}} onCreate={jest.fn()} createLabel="Create" />);
  expect(screen.queryByRole("tab", { name: "More" })).toBeNull();
});

it("BottomBar: a held item sinks; badges sit beside the pill", async () => {
  const onPress = jest.fn();
  await renderWithProviders(<BottomBar tabs={["Home", "Tasks"]} active="Home" onPress={onPress} badges={{ Tasks: 1 }} />);
  await fireEvent(screen.getByRole("tab", { name: "Tasks" }), "responderGrant", holdTouch());
  expect(flat(screen.getByRole("tab", { name: "Tasks" })).transform).toEqual([{ scale: 0.97 }]);
  expect(flat(screen.getByLabelText("1 new"))).toMatchObject({ position: "absolute", top: -4, left: 30 });
  await fireEvent.press(screen.getByRole("tab", { name: "Tasks" }));
  expect(onPress).toHaveBeenCalledWith("Tasks");
});

it("CreateSheet: a held row sinks; a tap picks it", async () => {
  const onPick = jest.fn();
  await renderWithProviders(<CreateSheet kinds={["lead", "task"]} onPick={onPick} />);
  expect(screen.getAllByRole("button", { name: /^New / }).map((b) => b.props.accessibilityLabel)).toEqual(["New task", "New lead"]);
  await fireEvent(screen.getByRole("button", { name: "New lead" }), "responderGrant", holdTouch());
  expect(flat(screen.getByRole("button", { name: "New lead" })).transform).toEqual([{ scale: 0.985 }, { translateY: 1 }]);
  await fireEvent.press(screen.getByRole("button", { name: "New lead" }));
  expect(onPick).toHaveBeenCalledWith("lead");
});
