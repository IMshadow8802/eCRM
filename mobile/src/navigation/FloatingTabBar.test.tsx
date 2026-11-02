import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { fireEvent, screen } from "@testing-library/react-native";

import { renderWithProviders } from "../test/renderWithProviders";
import FloatingTabBar from "./FloatingTabBar";

const routes = [
  { key: "Home-1", name: "Home", params: undefined },
  { key: "Tasks-1", name: "Tasks", params: undefined },
  { key: "Complaints-1", name: "Complaints", params: undefined },
  { key: "More-1", name: "More", params: undefined },
  // A route with no icon of its own and no title still renders.
  { key: "Extra-1", name: "Extra", params: { from: "test" } },
];
const titles: Record<string, string | undefined> = { Home: "Home", Tasks: "Tasks", Complaints: "Complaints", More: "More" };

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
  expect(tabs.map((t) => t.props.accessibilityLabel)).toEqual(["Home", "Tasks", "Complaints", "More", "Extra"]);
  expect(screen.getByRole("tab", { name: "Tasks" })).toBeSelected();
  expect(screen.getByRole("tab", { name: "Home" })).not.toBeSelected();
});

it("pressing another tab announces it, then navigates to it", async () => {
  const navigation = await mountBar(0);
  await fireEvent.press(screen.getByRole("tab", { name: "Extra" }));
  expect(navigation.emit).toHaveBeenCalledWith({ type: "tabPress", target: "Extra-1", canPreventDefault: true });
  expect(navigation.navigate).toHaveBeenCalledWith("Extra", { from: "test" });
});

it("pressing the tab you are on does not navigate", async () => {
  const navigation = await mountBar(2);
  await fireEvent.press(screen.getByRole("tab", { name: "Complaints" }));
  expect(navigation.emit).toHaveBeenCalled();
  expect(navigation.navigate).not.toHaveBeenCalled();
});

it("a screen that cancels the tab press keeps the user where they are", async () => {
  const navigation = await mountBar(0, true);
  await fireEvent.press(screen.getByRole("tab", { name: "More" }));
  expect(navigation.navigate).not.toHaveBeenCalled();
});
