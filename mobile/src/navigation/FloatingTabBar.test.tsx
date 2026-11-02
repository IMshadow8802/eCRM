import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { fireEvent, screen } from "@testing-library/react-native";

import { renderWithProviders } from "../test/renderWithProviders";
import FloatingTabBar from "./FloatingTabBar";

const routes = [
  { key: "MyWork-1", name: "MyWork", params: undefined },
  { key: "Inbox-1", name: "Inbox", params: undefined },
  { key: "Work-1", name: "Work", params: undefined },
  { key: "Me-1", name: "Me", params: undefined },
  // A route with no icon of its own and no title still renders.
  { key: "Extra-1", name: "Extra", params: { from: "test" } },
];
const titles: Record<string, string | undefined> = { MyWork: "My Work", Inbox: "Inbox", Work: "Work", Me: "Profile" };

const mountBar = (index: number, defaultPrevented = false) => {
  const navigation = {
    emit: jest.fn(() => ({ defaultPrevented })),
    navigate: jest.fn(),
  };
  const descriptors = Object.fromEntries(routes.map((r) => [r.key, { options: { title: titles[r.name] } }]));
  const props = {
    state: { index, routes },
    descriptors,
    navigation,
  } as unknown as BottomTabBarProps;
  return renderWithProviders(<FloatingTabBar {...props} />).then(() => navigation);
};

it("shows one tab per route, labelled by title, with the focused one selected", async () => {
  await mountBar(1);
  const tabs = screen.getAllByRole("tab");
  expect(tabs.map((t) => t.props.accessibilityLabel)).toEqual(["My Work", "Inbox", "Work", "Profile", "Extra"]);
  expect(screen.getByRole("tab", { name: "Inbox" })).toBeSelected();
  expect(screen.getByRole("tab", { name: "My Work" })).not.toBeSelected();
});

it("pressing another tab announces it, then navigates to it", async () => {
  const navigation = await mountBar(0);
  await fireEvent.press(screen.getByRole("tab", { name: "Extra" }));
  expect(navigation.emit).toHaveBeenCalledWith({ type: "tabPress", target: "Extra-1", canPreventDefault: true });
  expect(navigation.navigate).toHaveBeenCalledWith("Extra", { from: "test" });
});

it("pressing the tab you are on does not navigate", async () => {
  const navigation = await mountBar(2);
  await fireEvent.press(screen.getByRole("tab", { name: "Work" }));
  expect(navigation.emit).toHaveBeenCalled();
  expect(navigation.navigate).not.toHaveBeenCalled();
});

it("a screen that cancels the tab press keeps the user where they are", async () => {
  const navigation = await mountBar(0, true);
  await fireEvent.press(screen.getByRole("tab", { name: "Profile" }));
  expect(navigation.navigate).not.toHaveBeenCalled();
});
