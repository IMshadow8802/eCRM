// HeroCard, StatGrid, FigureBox, SplitBar, ModuleTile, Facts, Timeline.
import { Text as RNText } from "react-native";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { CirclePlay, Headset, OctagonAlert } from "lucide-react-native";

import { badgeTones, colors } from "../theme";
import { Facts } from "./Facts";
import { FigureBox, HeroCard, ModuleTile, SplitBar, StatGrid } from "./HeroCard";
import { Timeline } from "./Timeline";

import { flat } from "../test/style";

describe("HeroCard (E .hero)", () => {
  it("indigo card, title, subtitle, Open link, four stats in order; overdue in warn; each stat opens", async () => {
    const onOpen = jest.fn();
    const onOverdue = jest.fn();
    await render(
      <HeroCard
        icon={Headset}
        title="My complaints"
        subtitle="This week · 2 past their TAT"
        onOpen={onOpen}
        stats={[
          { label: "Open", value: 7 },
          { label: "Overdue", value: 2, warn: true, onPress: onOverdue },
          { label: "Escalated", value: 1 },
          { label: "Resolved", value: undefined },
        ]}
      />,
    );
    expect(flat(screen.getByText("My complaints").parent!.parent!.parent!)).toMatchObject({ backgroundColor: colors.primary, borderRadius: 20 });
    expect(flat(screen.getByText("This week · 2 past their TAT")).color).toBe(colors.onBrandMuted);
    expect(flat(screen.getByText("2"))).toMatchObject({ color: colors.onBrandWarn, fontSize: 32 });
    expect(flat(screen.getByText("7")).color).toBe(colors.textOnBrand);
    expect(screen.getByText("—")).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("button", { name: "Overdue 2" }));
    await fireEvent.press(screen.getByRole("link", { name: "Open My complaints" }));
    expect(onOverdue).toHaveBeenCalled();
    expect(onOpen).toHaveBeenCalled();
  });

  it("tablet: 40 figures; children render", async () => {
    await render(<HeroCard icon={Headset} title="T" size="tablet" stats={[{ label: "Open", value: 7 }]}><RNText>kid</RNText></HeroCard>);
    expect(flat(screen.getByText("7")).fontSize).toBe(40);
    expect(screen.getByText("kid")).toBeOnTheScreen();
  });

  it("a right-hand slot sits on the title row (09's state chip), in place of the Open link", async () => {
    await render(<HeroCard icon={Headset} title="Your clock" right={<RNText testID="state">Missed deadline</RNText>} />);
    const row = screen.getByText("Your clock").parent!.parent!;
    expect(row.props.style).toBeDefined();
    expect(flat(row).flexDirection).toBe("row");
    expect(screen.getByTestId("state").parent).toBe(row);
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("StatGrid alone", async () => {
    await render(<StatGrid stats={[{ label: "A", value: "3" }]} />);
    expect(screen.getByText("3")).toBeOnTheScreen();
  });

  it("FigureBox: two figures on primary-pressed with a divider; SplitBar used + overrun", async () => {
    await render(
      <>
        <FigureBox figures={[{ label: "Target", value: "8 h 00 m" }, { label: "Over by", value: "3 h 41 m", warn: true }]} />
        <SplitBar used={0.9} overrun={0.4} />
      </>,
    );
    expect(screen.getAllByTestId("figure-divider")).toHaveLength(1);
    expect(flat(screen.getByText("3 h 41 m"))).toMatchObject({ color: colors.onBrandWarn, fontSize: 24 });
    expect(flat(screen.getByTestId("split-used")).flex).toBe(0.9);
    expect(flat(screen.getByTestId("split-overrun"))).toMatchObject({ backgroundColor: colors.onBrandOverrun });
    expect(flat(screen.getByTestId("split-overrun")).flex).toBeCloseTo(0.1);
  });

  it("SplitBar with no overrun and junk input", async () => {
    await render(<SplitBar used={Number.NaN} />);
    expect(screen.queryByTestId("split-overrun")).toBeNull();
    expect(screen.getByLabelText("0% used")).toBeOnTheScreen();
  });
});

describe("ModuleTile (E .tile)", () => {
  it("module colour, 112 high, radius 20, value + unit, opens", async () => {
    const onPress = jest.fn();
    await render(<ModuleTile module="tasks" title="Tasks" subtitle="1 needs you" value={3} unit="assigned to you" onPress={onPress} />);
    const tile = screen.getByRole("button", { name: "Tasks, 3 assigned to you" });
    expect(flat(tile)).toMatchObject({ backgroundColor: badgeTones.lilac.fill, height: 112, borderRadius: 20 });
    expect(flat(screen.getByText("3"))).toMatchObject({ color: badgeTones.lilac.ink, fontSize: 28 });
    await fireEvent.press(tile);
    expect(onPress).toHaveBeenCalled();
  });

  it("loading shows a skeleton block, never 0; tablet is 128", async () => {
    await render(<ModuleTile module="leads" title="Leads" value={undefined} unit="yours" onPress={jest.fn()} size="tablet" />);
    expect(flat(screen.getByTestId("tile-skeleton"))).toMatchObject({ width: 28, height: 32, backgroundColor: colors.skeleton });
    expect(flat(screen.getByRole("button")).height).toBe(128);
  });
});

describe("Facts (E 11, T2)", () => {
  it("grid: 2 columns of label + value, danger tone, a node, a dash for empty", async () => {
    await render(<Facts items={[{ label: "Category", value: "AC" }, { label: "Due", value: "12:40 pm · 2 h over", tone: "danger" }, { label: "Assigned to", node: <RNText>Neha</RNText> }, { label: "Product" }]} />);
    expect(flat(screen.getByText("Category"))).toMatchObject({ color: colors.textMuted, fontSize: 12 });
    expect(flat(screen.getByText("12:40 pm · 2 h over")).color).toBe(colors.dangerText);
    expect(screen.getByText("Neha")).toBeOnTheScreen();
    expect(screen.getByText("—")).toBeOnTheScreen();
    expect(flat(screen.getByText("Category").parent!).width).toBe("50%");
  });

  it("list: label left, value right", async () => {
    await render(<Facts layout="list" items={[{ label: "Owner", value: "Ayush" }]} />);
    expect(flat(screen.getByText("Ayush")).textAlign).toBe("right");
  });
});

describe("Timeline (E 09)", () => {
  it("28 badges on a 2 px track that stops after the last; danger titles and times", async () => {
    await render(
      <Timeline
        entries={[
          { key: "s", title: "Started", time: "9:00 am", badge: { tone: "sky", icon: CirclePlay } },
          { key: "b", title: "Breached", time: "5:00 pm", meta: "Stays on record, even if reopened", danger: true, badge: { tone: "red", icon: OctagonAlert } },
        ]}
      />,
    );
    expect(screen.getAllByTestId("timeline-track")).toHaveLength(1);
    expect(flat(screen.getByTestId("timeline-track"))).toMatchObject({ width: 2, top: 30, bottom: 2, backgroundColor: colors.track });
    expect(flat(screen.getByText("Breached")).color).toBe(colors.dangerText);
    expect(flat(screen.getByText("5:00 pm")).color).toBe(colors.dangerText);
    expect(flat(screen.getByText("9:00 am")).color).toBe(colors.textSecondary);
    expect(screen.getByText("Stays on record, even if reopened")).toBeOnTheScreen();
  });

  it("retired dots, nodes, indent, muted, and a long press", async () => {
    const onLongPress = jest.fn();
    await render(
      <Timeline entries={[
        { key: "1", title: "Dot", icon: CirclePlay, tone: "success" },
        { key: "2", title: "Gone", muted: true, indent: true, node: <RNText>AV</RNText>, onLongPress },
        { key: "3", title: "Plain" },
      ]} />,
    );
    expect(flat(screen.getByText("Gone"))).toMatchObject({ fontStyle: "italic", color: colors.textMuted });
    await fireEvent(screen.getByText("Gone"), "longPress");
    expect(onLongPress).toHaveBeenCalled();
    expect(screen.getByText("AV")).toBeOnTheScreen();
  });
});
