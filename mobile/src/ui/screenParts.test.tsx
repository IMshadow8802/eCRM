// EmptyState, Card, Timeline.
import { StyleSheet, Text as RNText } from "react-native";
import { fireEvent, screen } from "@testing-library/react-native";
import { Plus } from "lucide-react-native";

import { colors } from "../theme";
import { renderWithProviders } from "../test/renderWithProviders";
import { BoardSurfaceContext } from "./boardSurface";
import { Card } from "./Card";
import { EmptyState } from "./EmptyState";
import { Text } from "./Text";
import { Timeline } from "./Timeline";


// A finger landing and staying down: the responder grant RNTL's own press()
// dispatches, without the release, so the pressed style can be read.
const holdTouch = () => {
  const touch = { pageX: 0, pageY: 0, locationX: 0, locationY: 0, timestamp: 0 };
  return { persist: () => {}, currentTarget: { measure: () => {} }, nativeEvent: { ...touch, touches: [touch], changedTouches: [touch] } };
};

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

describe("Card", () => {
  const shell = (label: string) => StyleSheet.flatten(screen.getByText(label).parent!.props.style);

  // §9.5: no border, never overflow hidden (it clips the card's own shadow on iOS).
  it("is a plain surface with a shadow, no border and no clipping", async () => {
    await renderWithProviders(<Card><Text>Body</Text></Card>);
    const style = shell("Body");
    expect(style.backgroundColor).toBe(colors.surface);
    expect(style.borderWidth).toBeUndefined();
    expect(style.overflow).not.toBe("hidden");
    // E's whisper: a solid-colour shadow, never an opacity.
    expect(style.boxShadow).toBe("0 1px 2px #DCE0EC");
  });

  it("drops the shadow inside a board column", async () => {
    await renderWithProviders(
      <BoardSurfaceContext.Provider value>
        <Card padded={false}><Text>On board</Text></Card>
      </BoardSurfaceContext.Provider>,
    );
    expect(shell("On board").boxShadow).toBeUndefined();
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
