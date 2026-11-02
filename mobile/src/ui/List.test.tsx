import { Text as RNText } from "react-native";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { Flag, Headset } from "lucide-react-native";

import { chipTones, colors } from "../theme";
import { GroupHeader, ListGroup, ListGroupCell, ListRow } from "./List";

import { flat } from "../test/style";

const holdTouch = () => {
  const touch = { pageX: 0, pageY: 0, locationX: 0, locationY: 0, timestamp: 0 };
  return { persist: () => {}, currentTarget: { measure: () => {} }, nativeEvent: { ...touch, touches: [touch], changedTouches: [touch] } };
};

const rowOf = (text: string) => {
  let n = screen.getByText(text);
  while (n.parent && !flat(n).paddingVertical) n = n.parent;
  return n;
};

describe("ListGroup", () => {
  it("whisper on the outer view, the clip on the inner one", async () => {
    await render(<ListGroup testID="g"><RNText>row</RNText></ListGroup>);
    const outer = screen.getByTestId("g");
    expect(flat(outer)).toMatchObject({ backgroundColor: colors.surface, borderRadius: 16, boxShadow: "0 1px 2px #DCE0EC" });
    expect(flat(outer).overflow).toBeUndefined();
    expect(flat(screen.getByText("row").parent!)).toMatchObject({ overflow: "hidden", borderRadius: 16 });
  });
});

describe("ListGroupCell (a ListGroup per FlatList cell)", () => {
  it("first rounds the top, last the bottom, middle is square; whisper outside, clip inside", async () => {
    await render(
      <>
        <ListGroupCell first last={false}><RNText>a</RNText></ListGroupCell>
        <ListGroupCell first={false} last={false}><RNText>b</RNText></ListGroupCell>
        <ListGroupCell first={false} last><RNText>c</RNText></ListGroupCell>
      </>,
    );
    const [a, b, c] = screen.getAllByTestId("list-cell");
    expect(flat(a!)).toMatchObject({ backgroundColor: colors.surface, boxShadow: "0 1px 2px #DCE0EC", borderTopLeftRadius: 16, borderTopRightRadius: 16 });
    expect(flat(a!).overflow).toBeUndefined();
    expect(flat(a!).borderBottomLeftRadius).toBeUndefined();
    expect(flat(b!).borderTopLeftRadius).toBeUndefined();
    expect(flat(b!).borderRadius).toBeUndefined();
    expect(flat(c!)).toMatchObject({ borderBottomLeftRadius: 16, borderBottomRightRadius: 16 });
    expect(flat(screen.getByText("c").parent!)).toMatchObject({ overflow: "hidden", borderBottomLeftRadius: 16 });
  });
});

describe("ListRow gaps closed in Task 37b", () => {
  it("unreadDot: an 8 indigo dot at the end of line 2 (E 18)", async () => {
    await render(<ListRow title="Assigned" meta="AC not cooling" unreadDot />);
    const dot = screen.getByTestId("unread-dot");
    expect(flat(dot)).toMatchObject({ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.primary });
    const line2 = screen.getByText("AC not cooling").parent!;
    expect(line2.children[line2.children.length - 1]).toBe(dot);
  });

  it("unreadDot alone still draws line 2", async () => {
    await render(<ListRow title="Ping" unreadDot />);
    expect(screen.getByTestId("unread-dot")).toBeOnTheScreen();
  });

  it("menu: a 15/600 title and padding 12 14 (E 19)", async () => {
    await render(<ListRow title="Inbox" menu />);
    expect(flat(screen.getByText("Inbox"))).toMatchObject({ fontSize: 15, fontFamily: "Inter_600SemiBold" });
    expect(flat(rowOf("Inbox"))).toMatchObject({ paddingVertical: 12, paddingHorizontal: 14 });
  });

  it("titleVerb: the verb bold, the rest regular 14 (E 11 / T2)", async () => {
    await render(<ListRow title="to Neha Kapoor" titleVerb="Escalated" />);
    expect(screen.getByText("Escalated")).toBeOnTheScreen();
    expect(flat(screen.getByText("Escalated"))).toMatchObject({ fontFamily: "Inter_600SemiBold" });
    const line = screen.getByText(/to Neha Kapoor/);
    expect(line).toHaveTextContent("Escalated to Neha Kapoor");
    expect(flat(line)).toMatchObject({ fontSize: 14, fontFamily: "Inter_400Regular" });
  });
});

describe("ListRow (E .rw)", () => {
  it("anatomy: badge, title + right, number · meta + chips, line 3", async () => {
    await render(
      <ListRow
        badge={{ tone: "peach", icon: Headset, escalated: true }}
        title="AC not cooling"
        right={{ text: "Overdue 2 h", tone: "danger" }}
        number="C-1042"
        meta="Rakesh Sharma"
        chips={[{ label: "Open", tone: "sky" }, { iconOnly: true, icon: Flag, tone: "red", accessibilityLabel: "High" }]}
        line3={<RNText>third</RNText>}
      />,
    );
    expect(screen.getByTestId("escalated-dot")).toBeOnTheScreen();
    expect(flat(screen.getByText("Overdue 2 h")).color).toBe(colors.dangerText);
    expect(screen.getByText("C-1042 · ")).toBeOnTheScreen();
    expect(flat(screen.getByText("C-1042 · ")).color).toBe(colors.textMuted);
    expect(screen.getByText("Open")).toBeOnTheScreen();
    expect(screen.getByLabelText("High")).toBeOnTheScreen();
    expect(screen.getByText("third")).toBeOnTheScreen();
    expect(flat(rowOf("AC not cooling"))).toMatchObject({ paddingVertical: 11, paddingHorizontal: 14, gap: 12, backgroundColor: colors.surface });
  });

  it.each([
    [{ badge: { tone: "sky" as const, icon: Headset } }, 66],
    [{ separatorInset: 48 as const }, 48],
    [{}, 14],
  ])("separator inset %#", async (props, left) => {
    await render(<ListRow title="t" {...props} />);
    expect(flat(screen.getByTestId("row-separator"))).toMatchObject({ left, right: 0, top: 0, height: 1, backgroundColor: colors.divider });
  });

  it("the first row has no separator", async () => {
    await render(<ListRow title="t" noSeparator />);
    expect(screen.queryByTestId("row-separator")).toBeNull();
  });

  it("selected → primarySoft, unread → unreadTint; read titles are 500, muted titles ink 2", async () => {
    await render(
      <>
        <ListRow title="sel" selected onPress={jest.fn()} />
        <ListRow title="unread" unread />
        <ListRow title="read" titleWeight="read" titleTone="muted" />
        <ListRow title="bad" titleTone="danger" />
      </>,
    );
    expect(flat(rowOf("sel")).backgroundColor).toBe(colors.primarySoft);
    expect(screen.getByRole("button")).toBeSelected();
    expect(flat(rowOf("unread")).backgroundColor).toBe(colors.unreadTint);
    expect(flat(screen.getByText("read"))).toMatchObject({ fontFamily: "Inter_500Medium", color: colors.textSecondary });
    expect(flat(screen.getByText("bad")).color).toBe(colors.dangerText);
  });

  it("an amount on the right in tabular bold; align top; chevron and trailing", async () => {
    await render(<ListRow title="Lead" right={{ amount: "₹1,20,000" }} align="top" chevron trailing={<RNText>tail</RNText>} />);
    expect(flat(screen.getByText("₹1,20,000"))).toMatchObject({ fontFamily: "Inter_700Bold", fontVariant: ["tabular-nums"] });
    expect(flat(rowOf("Lead"))).toMatchObject({ alignItems: "flex-start", paddingVertical: 12, paddingHorizontal: 12 });
    expect(screen.getByText("tail")).toBeOnTheScreen();
  });

  it("muted amount, plain text right, and a custom badge node", async () => {
    await render(<><ListRow title="a" right={{ amount: "₹0", muted: true }} /><ListRow title="b" right={{ text: "2:05 pm" }} badge={<RNText>B</RNText>} /></>);
    expect(flat(screen.getByText("₹0")).color).toBe(colors.textSecondary);
    expect(flat(screen.getByText("2:05 pm")).color).toBe(colors.textSecondary);
    expect(screen.getByText("B")).toBeOnTheScreen();
  });

  it("press and long press; a held row is field-tinted", async () => {
    const onPress = jest.fn();
    const onLongPress = jest.fn();
    await render(<ListRow title="Row" onPress={onPress} onLongPress={onLongPress} accessibilityLabel="Open row" />);
    await fireEvent.press(screen.getByRole("button", { name: "Open row" }));
    await fireEvent(screen.getByRole("button"), "longPress");
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(onLongPress).toHaveBeenCalledTimes(1);
    expect(flat(screen.getByRole("button")).backgroundColor).toBe(colors.surface);
    await fireEvent(screen.getByRole("button"), "responderGrant", holdTouch());
    expect(flat(screen.getByRole("button")).backgroundColor).toBe(colors.fieldTint);
  });
});

describe("GroupHeader (E .gh-row)", () => {
  it("an overline label with a muted right string", async () => {
    await render(<GroupHeader label="Sorted by deadline" right="Updated 2:41 pm" />);
    expect(flat(screen.getByText("Sorted by deadline"))).toMatchObject({ textTransform: "uppercase", color: colors.textMuted });
    expect(screen.getByText("Updated 2:41 pm")).toBeOnTheScreen();
    expect(flat(screen.getByText("Sorted by deadline").parent!)).toMatchObject({ marginTop: 16, marginBottom: 8, marginHorizontal: 2 });
  });

  it("a title with a red count chip and a See all link", async () => {
    const onPress = jest.fn();
    await render(<GroupHeader title="Needs you" count={3} link={{ label: "See all", onPress }} first />);
    expect(flat(screen.getByText("3").parent!).backgroundColor).toBe(chipTones.red.fill);
    await fireEvent.press(screen.getByRole("link", { name: "See all" }));
    expect(onPress).toHaveBeenCalled();
    expect(flat(screen.getByText("Needs you").parent!.parent!).marginTop).toBe(0);
  });

  it("a chip on the right", async () => {
    await render(<GroupHeader label="Today" rightChip={{ label: "2 today", tone: "butter" }} />);
    expect(flat(screen.getByText("2 today").parent!).backgroundColor).toBe(chipTones.butter.fill);
  });
});
