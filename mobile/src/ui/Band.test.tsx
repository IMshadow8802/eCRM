// Band, BandSheet, Screen (navy top), ActionBar.
import { Text as RNText } from "react-native";
import { fireEvent, screen } from "@testing-library/react-native";
import { CircleCheck, PhoneCall, Search } from "lucide-react-native";

import { colors } from "../theme";
import { renderWithProviders } from "../test/renderWithProviders";
import { flat } from "../test/style";
import { PHONE, TABLET, setWindow } from "../test/window";

import { ActionBar } from "./ActionBar";
import { Band, BandSheet } from "./Band";
import { IconButton } from "./IconButton";
import { Screen } from "./Screen";

beforeEach(() => setWindow(...PHONE));

const bandOf = (text: string) => {
  let n = screen.getByText(text);
  while (n.parent && flat(n).backgroundColor !== colors.band && flat(n).backgroundColor !== colors.bandRaised) n = n.parent;
  return n;
};

describe("Band (E .hd)", () => {
  it("navy, under the status bar, gutter 16, h1 title, actions; tabs padding 16 below", async () => {
    await renderWithProviders(
      <Band title="Complaints" actions={<IconButton icon={Search} accessibilityLabel="Search" onPress={jest.fn()} />} />,
    );
    expect(flat(bandOf("Complaints"))).toMatchObject({ backgroundColor: colors.band, paddingTop: 47, paddingHorizontal: 16, paddingBottom: 16 });
    expect(flat(screen.getByText("Complaints"))).toMatchObject({ fontSize: 22, color: colors.textOnBrand });
    expect(screen.getByRole("header")).toHaveTextContent("Complaints");
    expect(flat(screen.getByText("Complaints").parent!.parent!).height).toBe(52);
  });

  it.each([["home", 28, 56], ["record", 30, 52], ["profile", 36, 52]] as const)("%s pads %i below; row %i", async (variant, pad, row) => {
    await renderWithProviders(<Band title="T" variant={variant} />);
    expect(flat(bandOf("T")).paddingBottom).toBe(pad);
    expect(flat(screen.getByText("T").parent!.parent!).height).toBe(row);
  });

  it("an h2 record id with a muted subtitle; back goes back; close for forms", async () => {
    const onBack = jest.fn();
    await renderWithProviders(<Band titleVariant="h2" title="C-1042" subtitle="Opened Mon, 2 Nov" onBack={onBack} variant="record" />);
    expect(flat(screen.getByText("Opened Mon, 2 Nov")).color).toBe(colors.onBandMuted);
    await fireEvent.press(screen.getByRole("button", { name: "Go back" }));
    expect(onBack).toHaveBeenCalled();
    await renderWithProviders(<Band title="New complaint" onBack={onBack} backIcon="close" />);
    expect(screen.getByRole("button", { name: "Close" })).toBeOnTheScreen();
  });

  it("a baseline count; a subtitle-only lead; search, tabs and children in order; raised tone", async () => {
    const onChange = jest.fn();
    await renderWithProviders(
      <Band
        title="Leads"
        count="12 yours"
        tone="raised"
        search={{ placeholder: "Search leads", value: "", onChangeText: jest.fn() }}
        tabs={{ value: "mine", onChange, options: [{ value: "mine", label: "Mine" }, { value: "all", label: "All" }] }}
      >
        <RNText>extra</RNText>
      </Band>,
    );
    expect(screen.getByText("12 yours")).toBeOnTheScreen();
    expect(flat(bandOf("Leads")).backgroundColor).toBe(colors.bandRaised);
    expect(screen.getByLabelText("Search leads")).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("tab", { name: "All" }));
    expect(onChange).toHaveBeenCalledWith("all");
    expect(screen.getByText("extra")).toBeOnTheScreen();
  });

  it("subtitle as the row lead; centred profile with no title", async () => {
    await renderWithProviders(<><Band subtitle="Sales Ops · In Progress" /><Band align="center" variant="profile"><RNText>Ayush</RNText></Band></>);
    expect(flat(screen.getByText("Sales Ops · In Progress")).color).toBe(colors.onBandMuted);
    expect(screen.getByText("Ayush")).toBeOnTheScreen();
  });

  it("a centred profile with nothing in the row draws no row (E 19)", async () => {
    await renderWithProviders(<Band align="center" variant="profile"><RNText>Ayush</RNText></Band>);
    // The child is the band's first content: no 52 row above it.
    const band = bandOf("Ayush");
    expect(band.children.some((c) => typeof c !== "string" && flat(c).height === 52)).toBe(false);
    expect(screen.getByText("Ayush").parent).toBe(band);
  });

  it("a leading slot heads the row after back; with no title it replaces the title block (E 04)", async () => {
    await renderWithProviders(
      <Band
        variant="home"
        leading={<RNText>lead</RNText>}
        actions={<IconButton icon={Search} accessibilityLabel="Search" onPress={jest.fn()} />}
      />,
    );
    const row = screen.getByText("lead").parent!;
    expect(flat(row)).toMatchObject({ height: 56, gap: 10 });
    // lead, then the action — no empty subtitle spacer between them.
    expect(row.children.length).toBe(2);
  });

  it("gutter overrides the side padding on the band and the sheet (T2 panes)", async () => {
    setWindow(...TABLET);
    await renderWithProviders(<><Band title="Pane" gutter={20} /><BandSheet gutter={16}><RNText>pane body</RNText></BandSheet></>);
    expect(flat(bandOf("Pane")).paddingHorizontal).toBe(20);
    expect(flat(screen.getByText("pane body").parent!).paddingHorizontal).toBe(16);
  });

  it("noInset skips the status bar padding", async () => {
    await renderWithProviders(<Band title="Pane" noInset />);
    expect(flat(bandOf("Pane")).paddingTop).toBe(0);
  });

  it("tablet: row 60, gutter 32; the sheet overlaps 20 with 24 corners", async () => {
    setWindow(...TABLET);
    await renderWithProviders(<><Band title="Home" /><BandSheet><RNText>tbody</RNText></BandSheet></>);
    expect(flat(bandOf("Home")).paddingHorizontal).toBe(32);
    expect(flat(screen.getByText("Home").parent!.parent!).height).toBe(60);
    expect(flat(screen.getByText("tbody").parent!)).toMatchObject({ marginTop: -20, borderTopLeftRadius: 24, paddingHorizontal: 32 });
  });
});

describe("BandSheet (E .sheet)", () => {
  it("overlaps the band by 16 with 20 top corners, padding 16", async () => {
    await renderWithProviders(<BandSheet><RNText>body</RNText></BandSheet>);
    expect(flat(screen.getByText("body").parent!)).toMatchObject({
      backgroundColor: colors.background, marginTop: -16, borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingTop: 16, paddingHorizontal: 16,
    });
  });

  it("bleedRight pads only the left; center puts content 96 down", async () => {
    await renderWithProviders(<><BandSheet bleedRight padded={false}><RNText>board</RNText></BandSheet><BandSheet center padded={false}><RNText>empty</RNText></BandSheet></>);
    expect(flat(screen.getByText("board").parent!)).toMatchObject({ paddingLeft: 16, paddingRight: 0 });
    expect(flat(screen.getByText("empty").parent!)).toMatchObject({ alignItems: "center", paddingTop: 96 });
  });

  it("scroll wraps a ScrollView with pull to refresh", async () => {
    const onRefresh = jest.fn();
    await renderWithProviders(<BandSheet scroll refresh={{ refreshing: false, onRefresh }} contentBottom={40}><RNText>list</RNText></BandSheet>);
    expect(screen.getByText("list")).toBeOnTheScreen();
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it("Screen band: the page behind the sheet is navy", async () => {
    await renderWithProviders(<Screen band><RNText>s</RNText></Screen>);
    expect(flat(screen.getByText("s").parent!).backgroundColor).toBe(colors.band);
  });
});

describe("ActionBar (E 11)", () => {
  const actions = (calls: Record<string, jest.Mock>) => [
    { key: "call", label: "Log call", icon: PhoneCall, onPress: calls.call! },
    { key: "resolve", label: "Resolve", icon: CircleCheck, main: true, onPress: calls.resolve! },
    { key: "x", label: "Transfer", icon: PhoneCall, disabled: true, onPress: calls.x! },
    { key: "a", label: "A", icon: PhoneCall, onPress: jest.fn() },
    { key: "b", label: "B", icon: PhoneCall, onPress: jest.fn() },
    { key: "c", label: "Sixth", icon: PhoneCall, onPress: jest.fn() },
  ];

  it("navy bar over the inset, max five items, one primary main pill; disabled is inert", async () => {
    const calls = { call: jest.fn(), resolve: jest.fn(), x: jest.fn() };
    await renderWithProviders(<ActionBar actions={actions(calls)} />);
    expect(flat(screen.getByTestId("action-bar"))).toMatchObject({ backgroundColor: colors.band, height: 58 + 34, paddingBottom: 34 });
    expect(screen.queryByText("Sixth")).toBeNull();
    expect(flat(screen.getByTestId("action-main"))).toMatchObject({ width: 56, height: 30, borderRadius: 15, backgroundColor: colors.primary });
    expect(flat(screen.getByText("Resolve"))).toMatchObject({ color: colors.textOnBrand, fontFamily: "Inter_600SemiBold" });
    expect(flat(screen.getByText("Log call")).color).toBe(colors.onBandMuted);
    expect(flat(screen.getByText("Transfer")).color).toBe(colors.bandField);
    await fireEvent.press(screen.getByRole("button", { name: "Resolve" }));
    await fireEvent.press(screen.getByRole("button", { name: "Transfer" }));
    expect(calls.resolve).toHaveBeenCalledTimes(1);
    expect(calls.x).not.toHaveBeenCalled();
  });
});
