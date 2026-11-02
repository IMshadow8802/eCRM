// Task 33 review round: E sizes, 44 dp targets, tablet board, layout
// consistency, and the regressions it found on un-migrated screens.
import { Text as RNText } from "react-native";
import { render, screen } from "@testing-library/react-native";
import { Bell, CircleCheck, Phone, Plus } from "lucide-react-native";

import { colors, metrics, notificationBadge } from "../theme";
import { renderWithProviders } from "../test/renderWithProviders";
import { flat } from "../test/style";
import { PHONE, TABLET, setWindow } from "../test/window";
import { ActionBar } from "./ActionBar";
import { ActionSheet } from "./ActionSheet";
import { Avatar } from "./Avatar";
import { Band, BandSheet } from "./Band";
import { BoardColumns } from "./BoardColumns";
import { Button } from "./Button";
import { ChoiceList } from "./ChoiceList";
import { EmptyState } from "./EmptyState";
import { CircleAction, IconButton } from "./IconButton";
import { MobileInput } from "./MobileInput";
import { Screen } from "./Screen";
import { SearchField } from "./SearchField";
import { Select } from "./Select";
import { FilterPills } from "./Tabs";
import { Timeline } from "./Timeline";
import { layoutFor } from "./useLayout";

beforeEach(() => setWindow(...PHONE));

describe("E sizes", () => {
  it("action bar icons are 22 (E .tb .i), the main one included", async () => {
    await renderWithProviders(
      <ActionBar actions={[{ key: "a", label: "Log call", icon: Phone, onPress: jest.fn() }, { key: "b", label: "Resolve", icon: CircleCheck, main: true, onPress: jest.fn() }]} />,
    );
    type Node = { props: { width?: unknown }; children: (Node | string)[] };
    const svgWidth = (n: Node): unknown =>
      typeof n.props.width === "number" ? n.props.width : n.children.map((c) => (typeof c === "string" ? undefined : svgWidth(c))).find((w) => w != null);
    const sizes = screen.getAllByRole("button").map((b) => svgWidth(b as unknown as Node));
    expect(sizes).toEqual([22, 22]);
  });

  it("the icon button's badge sits at top -5 (E .ib .bdg)", async () => {
    await render(<IconButton icon={Bell} accessibilityLabel="Inbox" badge={3} onPress={jest.fn()} />);
    expect(flat(screen.getByLabelText("3 new"))).toMatchObject({ top: -5, right: -8 });
  });
});

describe("44 dp targets", () => {
  it.each([["sm", 4], ["xs", 6], ["md", 0]] as const)("Button %s reaches 44 with hitSlop %i", async (size, slop) => {
    await render(<Button title="Go" size={size} />);
    expect(screen.getByRole("button").props.hitSlop).toBe(slop);
  });

  it("CircleAction 40 reaches 44", async () => {
    await render(<CircleAction icon={Phone} size={40} accessibilityLabel="Call" onPress={jest.fn()} />);
    expect(screen.getByRole("button").props.hitSlop).toBe(2);
  });

  it("ActionSheet and ChoiceList rows are at least 44 tall without a badge", async () => {
    await renderWithProviders(
      <>
        <ActionSheet actions={[{ key: "x", label: "Edit", onPress: jest.fn() }]} />
        <ChoiceList value={null} choices={[{ value: 1, label: "Plain" }]} onChange={jest.fn()} />
      </>,
    );
    expect(flat(screen.getByRole("menuitem", { name: "Edit" })).minHeight).toBe(44);
    expect(flat(screen.getByRole("radio", { name: "Plain" })).minHeight).toBe(44);
  });

  it("the search clear button reaches 44", async () => {
    await render(<SearchField placeholder="Search" value="AC" onChangeText={jest.fn()} />);
    expect(screen.getByRole("button", { name: "Clear search" }).props.hitSlop).toBe(13);
  });
});

describe("tablet board", () => {
  const cols = [{ id: "a" }, { id: "b" }];
  const mount = () =>
    render(<BoardColumns columns={cols} keyOf={(c) => c.id} renderColumn={(c) => <RNText>{c.id}</RNText>} />);

  it("phone: E's window − 80 (310 on 390), so the next column peeks", async () => {
    await mount();
    expect(flat(screen.getByText("a").parent!).width).toBe(310);
  });

  it("tablet: capped, so several columns show beside the rail instead of one 1114-wide column", async () => {
    setWindow(...TABLET);
    await mount();
    expect(flat(screen.getByText("a").parent!).width).toBe(metrics.boardColumnMax);
    expect(metrics.boardColumnMax * 3).toBeLessThan(TABLET[0] - metrics.railWidth);
  });
});

describe("one layout predicate, gutters from metrics", () => {
  it("useLayout gutters are the metrics", () => {
    expect(layoutFor(390, 844).gutter).toBe(metrics.gutter);
    expect(layoutFor(700, 1000).gutter).toBe(metrics.gutterMedium);
    expect(layoutFor(1194, 834).gutter).toBe(metrics.gutterExpanded);
  });

  it("at a medium rail size the band and the sheet both take tablet geometry", async () => {
    setWindow(700, 1000);
    await renderWithProviders(<><Band title="T" /><BandSheet><RNText>s</RNText></BandSheet></>);
    expect(flat(screen.getByText("T").parent!.parent!).height).toBe(metrics.bandRowTablet);
    expect(flat(screen.getByText("s").parent!)).toMatchObject({ marginTop: -metrics.sheetOverlapTablet, paddingHorizontal: metrics.gutterMedium });
  });

  it("filter pills bleed by the screen's own gutter", async () => {
    setWindow(...TABLET);
    await render(<FilterPills testID="p" value={null} options={[{ value: "a", label: "A" }]} onChange={jest.fn()} />);
    expect(flat(screen.getByTestId("p")).marginRight).toBe(-metrics.gutterExpanded);
  });
});

describe("un-migrated screens keep their look", () => {
  it("a timeline entry without a badge (a comment) is regular text, not semibold", async () => {
    await render(<Timeline entries={[{ key: "c", title: "Looks good", node: <RNText>AV</RNText> }, { key: "t", title: "Breached", badge: { tone: "red", icon: Plus } }]} />);
    expect(flat(screen.getByText("Looks good"))).toMatchObject({ fontFamily: "Inter_400Regular", fontSize: 14 });
    expect(flat(screen.getByText("Breached")).fontFamily).toBe("Inter_600SemiBold");
  });

  it("EmptyState is centred in its space", async () => {
    await render(<EmptyState title="Nothing" />);
    expect(flat(screen.getByText("Nothing").parent!)).toMatchObject({ flex: 1, justifyContent: "center", alignItems: "center" });
  });

  it("Screen: band, padded and both insets", async () => {
    await renderWithProviders(<Screen edgeTop edgeBottom padded><RNText>x</RNText></Screen>);
    expect(flat(screen.getByText("x").parent!)).toMatchObject({ paddingTop: 47, paddingBottom: 34, paddingHorizontal: 16, backgroundColor: colors.background });
  });
});

describe("Phase-2 needs in the kit", () => {
  it("Select shows a person as Avatar 24 + name", async () => {
    await renderWithProviders(
      <Select label="Assigned to" value={4} onChange={jest.fn()} options={[{ value: 4, label: "Neha Kapoor", avatar: { name: "Neha Kapoor", userId: 4 } }]} />,
    );
    const trigger = screen.getByRole("button", { name: "Assigned to: Neha Kapoor" });
    expect(screen.getAllByText("NK")[0]).toBeOnTheScreen();
    expect(flat(screen.getAllByText("NK")[0]!.parent!)).toMatchObject({ width: 24, height: 24 });
    expect(trigger).toBeOnTheScreen();
  });

  it("MobileInput draws tabular digits", async () => {
    await render(<MobileInput placeholder="Mobile" />);
    expect(flat(screen.getByPlaceholderText("Mobile")).fontVariant).toEqual(["tabular-nums"]);
  });

  it("Avatar 28 has E's 2 px surface ring by default; ring={null} removes it", async () => {
    await render(<><Avatar name="A B" /><Avatar name="C D" ring={null} /><Avatar name="E F" size={40} /></>);
    expect(flat(screen.getByText("AB").parent!)).toMatchObject({ borderWidth: 2, borderColor: colors.surface });
    expect(flat(screen.getByText("CD").parent!).borderWidth).toBeUndefined();
    expect(flat(screen.getByText("EF").parent!).borderWidth).toBeUndefined();
  });

  it.each([
    ["task_dismissed", "slate"], ["followup_missed", "red"], ["missed_call", "red"], ["ticket_escalated", "lilac"],
    ["task_due_soon", "butter"], ["overdue_notice", "butter"], ["comment_added", "teal"], ["workspace_added", "indigo"],
  ] as const)("notification %s → %s (whole words only)", (type, tone) => expect(notificationBadge(type).tone).toBe(tone));
});
