import { Dimensions } from "react-native";
import { fireEvent, render, screen } from "@testing-library/react-native";

import { spacing } from "../theme";
import { BOARD_COLUMN_RATIO, BoardColumns } from "./BoardColumns";
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
  const snap = Math.round(Dimensions.get("window").width * BOARD_COLUMN_RATIO) + spacing[3];
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
