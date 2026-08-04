import { useState, type ReactElement } from "react";
import {
  FlatList,
  StyleSheet,
  View,
  useWindowDimensions,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";

import { spacing, SCREEN_PADDING } from "../theme";
import { BoardSurfaceContext } from "./boardSurface";

/**
 * How much of the screen one column occupies. Under 1 deliberately: the sliver
 * of the next column is the only thing that tells the user a board scrolls
 * sideways at all.
 */
export const BOARD_COLUMN_RATIO = 0.86;


export interface BoardColumnsProps<T> {
  columns: T[];
  keyOf: (column: T) => string;
  /** Rendered inside a fixed-width wrapper — the column fills it. */
  renderColumn: (column: T) => ReactElement | null;
  /** Fires with the index that settled under the viewport after a swipe. */
  onSettle?: (index: number) => void;
}

/**
 * The horizontal, snapping column strip both boards sit on — tasks by kanban
 * column, complaints by pipeline stage.
 *
 * It exists so the snap arithmetic lives once. Column width and gap have to
 * agree exactly or every swipe lands a few pixels off and the drift compounds
 * across the board.
 */
export function BoardColumns<T>({
  columns,
  keyOf,
  renderColumn,
  onSettle,
}: BoardColumnsProps<T>) {
  const { width } = useWindowDimensions();
  const [, setIndex] = useState(0);

  const columnWidth = Math.round(width * BOARD_COLUMN_RATIO);
  // The column and the gap travel together, so a snap lands the next column in
  // exactly the same place the last one was.
  const snap = columnWidth + spacing[3];

  const settle = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const next = Math.round(event.nativeEvent.contentOffset.x / snap);
    setIndex(next);
    onSettle?.(next);
  };

  return (
    // Everything inside a column is on a board, and cards read that to drop
    // their shadow — a narrow column repeated across the screen cannot carry
    // one without banding. See ui/boardSurface.
    <BoardSurfaceContext value={true}>
      <FlatList
        horizontal
        data={columns}
        keyExtractor={keyOf}
        showsHorizontalScrollIndicator={false}
        snapToInterval={snap}
        decelerationRate="fast"
        onMomentumScrollEnd={settle}
        contentContainerStyle={styles.board}
        renderItem={({ item }) => (
          <View style={[styles.column, { width: columnWidth }]}>
            {renderColumn(item)}
          </View>
        )}
      />
    </BoardSurfaceContext>
  );
}

const styles = StyleSheet.create({
  board: {
    paddingHorizontal: SCREEN_PADDING,
    paddingTop: spacing[3],
    gap: spacing[3],
  },
  column: { flex: 1 },
});

export default BoardColumns;
