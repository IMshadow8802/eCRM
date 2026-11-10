import { useEffect, useRef, type ReactElement } from "react";
import {
  FlatList,
  StyleSheet,
  View,
  useWindowDimensions,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";

import { metrics, SCREEN_PADDING, spacing } from "../theme";
import { BoardSurfaceContext } from "./boardSurface";

/**
 * E 07: a column is the window less 80 (310 on a 390 phone), so the next one
 * peeks. Capped, so a tablet beside the rail shows several columns and a peek
 * instead of one column a thousand wide.
 */
export const boardColumnWidth = (windowWidth: number) =>
  Math.min(windowWidth - metrics.boardColumnInset, metrics.boardColumnMax);
/** Gap between columns (E 07). */
export const BOARD_GAP = 10;

export interface BoardColumnsProps<T> {
  columns: T[];
  keyOf: (column: T) => string;
  /** Rendered inside a fixed-width wrapper — the column fills it. */
  renderColumn: (column: T) => ReactElement | null;
  /** Fires with the index that settled under the viewport after a swipe. */
  onSettle?: (index: number) => void;
  /**
   * The column to show. A change pages the strip there (a band tab tap); a
   * swipe reports through onSettle, and an index equal to where it settled
   * does not scroll again.
   */
  index?: number;
  /**
   * Left inset of the strip. Inside a `BandSheet bleedRight` the sheet already
   * pads 16 on the left, so pass 0 there; the default suits a bare screen.
   */
  insetLeft?: number;
}

/**
 * The horizontal, snapping column strip a board sits on. It exists so the
 * snap arithmetic lives once: width and gap must agree exactly or every swipe
 * lands a few pixels off and the drift compounds.
 */
export function BoardColumns<T>({ columns, keyOf, renderColumn, onSettle, index, insetLeft = SCREEN_PADDING }: BoardColumnsProps<T>) {
  const { width } = useWindowDimensions();
  const list = useRef<FlatList<T>>(null);
  // Where the strip is now, so an index that only echoes a swipe is not re-scrolled.
  const at = useRef(index ?? 0);

  const columnWidth = boardColumnWidth(width);
  const snap = columnWidth + BOARD_GAP;

  const settle = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const next = Math.round(event.nativeEvent.contentOffset.x / snap);
    at.current = next;
    onSettle?.(next);
  };

  useEffect(() => {
    if (index == null || index === at.current) return;
    at.current = index;
    list.current?.scrollToOffset({ offset: index * snap, animated: true });
  }, [index, snap]);

  return (
    // Cards inside a column drop their shadow (ui/boardSurface).
    <BoardSurfaceContext value={true}>
      <FlatList
        ref={list}
        horizontal
        data={columns}
        keyExtractor={keyOf}
        showsHorizontalScrollIndicator={false}
        snapToInterval={snap}
        decelerationRate="fast"
        onMomentumScrollEnd={settle}
        contentContainerStyle={[styles.board, { paddingLeft: insetLeft }]}
        renderItem={({ item }) => <View style={[styles.column, { width: columnWidth }]}>{renderColumn(item)}</View>}
      />
    </BoardSurfaceContext>
  );
}

const styles = StyleSheet.create({
  board: { paddingRight: SCREEN_PADDING, paddingTop: spacing[3], gap: BOARD_GAP },
  column: { flex: 1 },
});
