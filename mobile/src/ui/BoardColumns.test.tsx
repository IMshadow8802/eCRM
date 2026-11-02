import { Dimensions, FlatList, StyleSheet } from "react-native";
import { fireEvent, render, screen } from "@testing-library/react-native";

import { BOARD_GAP, BoardColumns, boardColumnWidth } from "./BoardColumns";

import { Text } from "./Text";
import { useOnBoard } from "./boardSurface";

// A settle re-renders the FlatList, which arms VirtualizedList's 50 ms batch
// timer. On a slow (cold) run that timer fired between the test and cleanup,
// outside act(). Fake timers keep it parked until unmount clears it.
jest.useFakeTimers();

const columns = [
  { id: "a", title: "To do" },
  { id: "b", title: "Doing" },
  { id: "c", title: "Done" },
];

function Probe({ title }: { title: string }) {
  // Cards read this to drop their shadow; a column must provide it.
  return <Text>{`${title}:${useOnBoard() ? "board" : "page"}`}</Text>;
}

const mount = (onSettle?: (i: number) => void) =>
  render(
    <BoardColumns
      columns={columns}
      keyOf={(c) => c.id}
      renderColumn={(c) => <Probe title={c.title} />}
      onSettle={onSettle}
    />,
  );

it("renders every column, each inside the board surface", async () => {
  await mount();
  for (const c of columns) expect(screen.getByText(`${c.title}:board`)).toBeOnTheScreen();
});

it("outside a board the surface flag is off", async () => {
  await render(<Probe title="Loose" />);
  expect(screen.getByText("Loose:page")).toBeOnTheScreen();
});

it("settles on the column whose snap interval the scroll ended in", async () => {
  const onSettle = jest.fn();
  await mount(onSettle);
  const snap = boardColumnWidth(Dimensions.get("window").width) + BOARD_GAP;
  // A little short of two full snaps still rounds to the third column.
  await fireEvent(screen.root!, "momentumScrollEnd", {
    nativeEvent: { contentOffset: { x: snap * 2 - 10, y: 0 } },
  });
  expect(onSettle).toHaveBeenLastCalledWith(2);
});

it("settling without a listener does not throw", async () => {
  await mount();
  await fireEvent(screen.root!, "momentumScrollEnd", {
    nativeEvent: { contentOffset: { x: 0, y: 0 } },
  });
  expect(screen.getByText("Doing:board")).toBeOnTheScreen();
});

it("a column is the window less 80 (310 on a 390 phone), 10 apart; the left inset is the caller's", async () => {
  expect(boardColumnWidth(390)).toBe(310);
  await render(<BoardColumns columns={columns} keyOf={(c) => c.id} insetLeft={0} renderColumn={(c) => <Probe title={c.title} />} />);
  const wrapper = StyleSheet.flatten(screen.getByText("To do:board").parent!.props.style);
  expect(wrapper.width).toBe(boardColumnWidth(Dimensions.get("window").width));
  const strip = StyleSheet.flatten(screen.root!.props.contentContainerStyle);
  expect(strip).toMatchObject({ paddingLeft: 0, gap: 10 });
});

describe("index: the caller pages the strip (a band tab tap)", () => {
  const scroll = jest.spyOn(FlatList.prototype, "scrollToOffset").mockImplementation(() => {});
  afterAll(() => scroll.mockRestore());
  const snap = () => boardColumnWidth(Dimensions.get("window").width) + BOARD_GAP;
  const strip = (index?: number, onSettle?: (i: number) => void) => (
    <BoardColumns columns={columns} keyOf={(c) => c.id} index={index} onSettle={onSettle} renderColumn={(c) => <Probe title={c.title} />} />
  );

  it("scrolls to that column's snap offset when the index changes", async () => {
    const { rerender } = await render(strip(0));
    scroll.mockClear();
    await rerender(strip(2));
    expect(scroll).toHaveBeenLastCalledWith({ offset: snap() * 2, animated: true });
  });

  it("does not scroll again to where a swipe already settled", async () => {
    const onSettle = jest.fn();
    const { rerender } = await render(strip(0, onSettle));
    await fireEvent(screen.root!, "momentumScrollEnd", { nativeEvent: { contentOffset: { x: snap(), y: 0 } } });
    scroll.mockClear();
    await rerender(strip(1, onSettle));
    expect(scroll).not.toHaveBeenCalled();
  });

  it("without an index it never scrolls on its own", async () => {
    scroll.mockClear();
    await render(strip());
    expect(scroll).not.toHaveBeenCalled();
  });
});
