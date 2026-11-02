import { fireEvent, render, screen } from "@testing-library/react-native";
import { PhoneOutgoing } from "lucide-react-native";

import { chipTones, colors } from "../theme";
import { BandTabs, FilterPills, FilterPillsSkeleton, SegmentedTabs } from "./Tabs";

import { flat } from "../test/style";
const PRESETS = [
  { value: "mine", label: "Mine", count: 7 },
  { value: "team", label: "Team", count: 18 },
  { value: "overdue", label: "Overdue", count: 2, countTone: "danger" as const },
  { value: "escalated", label: "Escalated", count: 1 },
  { value: "unassigned", label: "Unassigned", count: 5 },
];

describe("BandTabs (E .seg)", () => {
  it("marks the active tab selected, white, with the 3 px indicator; switching calls onChange", async () => {
    const onChange = jest.fn();
    await render(<BandTabs testID="tabs" value="mine" options={PRESETS} onChange={onChange} />);
    expect(screen.getByTestId("tabs")).toBeOnTheScreen();
    expect(screen.getByRole("tab", { name: "Mine, 7" })).toBeSelected();
    expect(screen.getByRole("tab", { name: "Team, 18" })).not.toBeSelected();
    expect(flat(screen.getByText("Mine")).color).toBe(colors.textOnBrand);
    expect(flat(screen.getByText("Team")).color).toBe(colors.onBandMuted);
    expect(flat(screen.getByTestId("band-tab-indicator"))).toMatchObject({ height: 3, backgroundColor: colors.bandMark, left: 0, right: 0 });
    await fireEvent.press(screen.getByRole("tab", { name: "Team, 18" }));
    expect(onChange).toHaveBeenCalledWith("team");
  });

  it("counts: active primary, danger coral, others navy", async () => {
    await render(<BandTabs value="mine" options={PRESETS} onChange={jest.fn()} spread size="sm" />);
    const pill = (n: string) => flat(screen.getByText(n).parent!).backgroundColor;
    expect(pill("7")).toBe(colors.primary);
    expect(pill("2")).toBe(colors.coral);
    expect(pill("18")).toBe(colors.bandField);
    expect(flat(screen.getByText("Mine")).fontSize).toBe(13);
  });

  it("a fifth preset that does not fit scrolls sideways; a row that fits does not", async () => {
    await render(<BandTabs testID="tabs" value="mine" options={PRESETS} onChange={jest.fn()} spread />);
    const list = screen.getByTestId("tabs");
    expect(list.props.scrollEnabled).toBe(false);
    await fireEvent(list, "layout", { nativeEvent: { layout: { width: 358, height: 44 } } });
    await fireEvent(list, "contentSizeChange", 420, 44);
    expect(screen.getByTestId("tabs").props.scrollEnabled).toBe(true);
    await fireEvent(list, "contentSizeChange", 300, 44);
    expect(screen.getByTestId("tabs").props.scrollEnabled).toBe(false);
  });
});

describe("SegmentedTabs (E .sgp)", () => {
  const OPTS = [
    { value: "out", label: "Outgoing", icon: PhoneOutgoing },
    { value: "in", label: "Incoming" },
    { value: "c", label: "Comments", count: 3 },
    { value: "d", label: "Due", count: 2, countTone: "danger" as const },
  ];

  it("the active segment is solid primary, 34 tall, radius 17; tapping another changes it", async () => {
    const onChange = jest.fn();
    await render(<SegmentedTabs testID="tabs" value="out" options={OPTS} onChange={onChange} />);
    const on = screen.getByRole("tab", { name: "Outgoing" });
    expect(on).toBeSelected();
    expect(flat(on)).toMatchObject({ backgroundColor: colors.primary, height: 34, borderRadius: 17 });
    expect(flat(screen.getByTestId("tabs"))).toMatchObject({ backgroundColor: colors.surface, borderRadius: 20, padding: 4, boxShadow: "0 1px 2px #DCE0EC" });
    expect(screen.getByText("3")).toBeOnTheScreen();
    expect(flat(screen.getByText("2").parent!).backgroundColor).toBe(colors.coral);
    await fireEvent.press(screen.getByRole("tab", { name: "Incoming" }));
    expect(onChange).toHaveBeenCalledWith("in");
  });

  it("inSheet is field-tinted without a shadow; compact and tall adjust the geometry", async () => {
    await render(<SegmentedTabs testID="tabs" value="in" options={OPTS.slice(0, 2)} onChange={jest.fn()} tone="inSheet" compact tall />);
    expect(flat(screen.getByTestId("tabs"))).toMatchObject({ backgroundColor: colors.fieldTint, padding: 3, gap: 2 });
    expect(flat(screen.getByTestId("tabs")).boxShadow).toBeUndefined();
    expect(flat(screen.getByRole("tab", { name: "Incoming" })).height).toBe(36);
  });

  it("past four segments it scrolls at natural width", async () => {
    const five = [...OPTS, { value: "e", label: "Extra" }];
    await render(<SegmentedTabs testID="tabs" value="e" options={five} onChange={jest.fn()} />);
    expect(flat(screen.getByRole("tab", { name: "Extra" })).flex).toBeUndefined();
    expect(flat(screen.getByRole("tab", { name: "Extra" })).paddingHorizontal).toBe(14);
  });
});

describe("FilterPills (E .pills)", () => {
  const OPTS = [
    { value: "all", label: "All", count: 9 },
    { value: "open", label: "Open", count: 6, tone: "sky" as const },
    { value: "rejected", label: "Rejected" },
  ];

  it("active is primary with no shadow; toned pills wear their chip pair; idle are white with the whisper", async () => {
    const onChange = jest.fn();
    await render(<FilterPills testID="pills" value="all" options={OPTS} onChange={onChange} label="Status" />);
    expect(screen.getByTestId("pills")).toBeOnTheScreen();
    const all = screen.getByRole("radio", { name: "All, 9" });
    expect(all).toBeChecked();
    expect(flat(all)).toMatchObject({ backgroundColor: colors.primary, height: 32, borderRadius: 16 });
    expect(flat(all).boxShadow).toBeUndefined();
    expect(flat(screen.getByRole("radio", { name: "Open, 6" })).backgroundColor).toBe(chipTones.sky.fill);
    expect(flat(screen.getByRole("radio", { name: "Rejected" }))).toMatchObject({ backgroundColor: colors.surface, boxShadow: "0 1px 2px #DCE0EC" });
    await fireEvent.press(screen.getByRole("radio", { name: "Rejected" }));
    expect(onChange).toHaveBeenCalledWith("rejected");
  });

  it("in a sheet: 34 tall, idle pills field-tinted; wrap shows a check on the active pill", async () => {
    await render(<FilterPills testID="pills" value="open" options={OPTS.map((o) => ({ ...o, tone: undefined }))} onChange={jest.fn()} tone="inSheet" wrap />);
    expect(flat(screen.getByRole("radio", { name: "All, 9" }))).toMatchObject({ backgroundColor: colors.fieldTint, height: 34 });
    expect(flat(screen.getByTestId("pills"))).toMatchObject({ flexWrap: "wrap" });
  });

  it("the skeleton is four solid 32 blocks", async () => {
    await render(<FilterPillsSkeleton />);
    const blocks = screen.getByTestId("pills-skeleton").props.children;
    expect(blocks).toHaveLength(4);
  });
});
