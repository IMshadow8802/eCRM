// ScreenHeader, ScreenLoader, EmptyState, Fab, Card, Timeline.
import { StyleSheet, Text as RNText } from "react-native";
import { act, fireEvent, screen } from "@testing-library/react-native";
import { Plus, Settings } from "lucide-react-native";

import { colors } from "../theme";
import { renderWithProviders } from "../test/renderWithProviders";
import { BoardSurfaceContext } from "./boardSurface";
import { Card } from "./Card";
import { EmptyState } from "./EmptyState";
import { Fab } from "./Fab";
import { ScreenHeader } from "./ScreenHeader";
import { ScreenLoader } from "./ScreenLoader";
import { Text } from "./Text";
import { Timeline } from "./Timeline";

afterEach(() => jest.useRealTimers());

// A finger landing and staying down: the responder grant RNTL's own press()
// dispatches, without the release, so the pressed style can be read.
const holdTouch = () => {
  const touch = { pageX: 0, pageY: 0, locationX: 0, locationY: 0, timestamp: 0 };
  return { persist: () => {}, currentTarget: { measure: () => {} }, nativeEvent: { ...touch, touches: [touch], changedTouches: [touch] } };
};

describe("ScreenHeader", () => {
  it("shows title and subtitle; back and each action do their thing", async () => {
    const onBack = jest.fn();
    const onSettings = jest.fn();
    await renderWithProviders(
      <ScreenHeader title="Complaint #12" subtitle="Open" tint="danger" onBack={onBack} actions={[{ icon: Settings, label: "Settings", onPress: onSettings }]} />,
    );
    expect(screen.getByText("Complaint #12")).toBeOnTheScreen();
    expect(screen.getByText("Open")).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("button", { name: "Go back" }));
    await fireEvent.press(screen.getByRole("button", { name: "Settings" }));
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(onSettings).toHaveBeenCalledTimes(1);
  });

  // Solid colour plus a sink, never an opacity fade (§9.3).
  it("a held button sinks onto the page in a solid pressed colour", async () => {
    await renderWithProviders(
      <ScreenHeader title="T" onBack={jest.fn()} actions={[{ icon: Settings, label: "Settings", onPress: jest.fn() }]} />,
    );
    for (const [name, fill] of [["Go back", colors.primaryPressed], ["Settings", colors.surfacePressed]] as const) {
      await fireEvent(screen.getByRole("button", { name }), "responderGrant", holdTouch());
      const style = StyleSheet.flatten(screen.getByRole("button", { name }).props.style);
      expect(style.backgroundColor).toBe(fill);
      expect(style.transform).toEqual([{ translateY: 2 }]);
      expect(style.opacity).toBeUndefined();
    }
  });

  it("no back handler means no back button", async () => {
    await renderWithProviders(<ScreenHeader title="Today" />);
    expect(screen.queryByRole("button", { name: "Go back" })).toBeNull();
  });
});

describe("ScreenLoader", () => {
  it("spins quietly, then after 6s admits it is slow and offers a retry", async () => {
    jest.useFakeTimers();
    const onRetry = jest.fn();
    await renderWithProviders(<ScreenLoader onRetry={onRetry} />);
    expect(screen.queryByText("Still trying…")).toBeNull();
    await act(async () => jest.advanceTimersByTime(6000));
    expect(screen.getByText("Still trying…")).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("a failed load says so at once, with the caller's message and no retry when none is given", async () => {
    await renderWithProviders(<ScreenLoader failed message="Server is down" />);
    expect(screen.getByText("Could not load this")).toBeOnTheScreen();
    expect(screen.getByText("Server is down")).toBeOnTheScreen();
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("EmptyState", () => {
  it("offers its action only when it has both a label and a handler", async () => {
    const onAction = jest.fn();
    const view = await renderWithProviders(
      <EmptyState icon={Plus} title="No leads" message="Add your first lead" actionLabel="Add lead" onAction={onAction} />,
    );
    expect(screen.getByText("Add your first lead")).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("button", { name: "Add lead" }));
    expect(onAction).toHaveBeenCalledTimes(1);
    await view.rerender(<EmptyState title="No leads" actionLabel="Add lead" />);
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("Fab", () => {
  it("presses, shows a label, and is blocked while loading", async () => {
    const onPress = jest.fn();
    const onBusy = jest.fn();
    await renderWithProviders(
      <>
        <Fab icon={Plus} label="New" accessibilityLabel="New complaint" offsetBottom={56} onPress={onPress} />
        <Fab icon={Plus} accessibilityLabel="Saving" loading onPress={onBusy} />
      </>,
    );
    expect(screen.getByText("New")).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("button", { name: "New complaint" }));
    expect(onPress).toHaveBeenCalledTimes(1);
    await fireEvent.press(screen.getByRole("button", { name: "Saving" }));
    expect(onBusy).not.toHaveBeenCalled();
  });
});

describe("Card", () => {
  const shell = (label: string) => StyleSheet.flatten(screen.getByText(label).parent!.props.style);

  // §9.5: no border, never overflow hidden (it clips the card's own shadow on iOS).
  it("is a plain surface with a shadow, no border and no clipping", async () => {
    await renderWithProviders(<Card><Text>Body</Text></Card>);
    const style = shell("Body");
    expect(style.backgroundColor).toBe(colors.surface);
    expect(style.borderWidth).toBeUndefined();
    expect(style.overflow).not.toBe("hidden");
    expect(style.shadowOpacity).toBeGreaterThan(0);
  });

  it("drops the shadow inside a board column", async () => {
    await renderWithProviders(
      <BoardSurfaceContext.Provider value>
        <Card padded={false}><Text>On board</Text></Card>
      </BoardSurfaceContext.Provider>,
    );
    expect(shell("On board").shadowOpacity).toBeUndefined();
  });

  it("a pressable card reports press and long press", async () => {
    const onPress = jest.fn();
    const onLongPress = jest.fn();
    await renderWithProviders(<Card onPress={onPress} onLongPress={onLongPress}><RNText>Lead</RNText></Card>);
    await fireEvent.press(screen.getByText("Lead"));
    await fireEvent(screen.getByText("Lead"), "longPress");
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(onLongPress).toHaveBeenCalledTimes(1);
  });

  // §9.5: a press sinks the card, it does not tint it.
  it("a held card sinks and keeps its colour", async () => {
    await renderWithProviders(<Card onPress={jest.fn()}><RNText>Held</RNText></Card>);
    await fireEvent(screen.getByText("Held"), "responderGrant", holdTouch());
    const style = shell("Held");
    expect(style.transform).toContainEqual({ translateY: 1 });
    expect(style.backgroundColor).toBe(colors.surface);
  });
});

describe("Timeline", () => {
  it("lists each entry with its meta, and a custom node replaces the dot", async () => {
    await renderWithProviders(
      <Timeline
        entries={[
          { key: "1", title: "Created", meta: "Asha · 2h ago", icon: Plus, tone: "success" },
          { key: "2", title: "Commented", node: <RNText>AV</RNText> },
        ]}
      />,
    );
    expect(screen.getByText("Created")).toBeOnTheScreen();
    expect(screen.getByText("Asha · 2h ago")).toBeOnTheScreen();
    expect(screen.getByText("Commented")).toBeOnTheScreen();
    expect(screen.getByText("AV")).toBeOnTheScreen();
  });
});
