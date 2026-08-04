import { createContext, useContext } from "react";

/**
 * True for anything rendered inside a board column.
 *
 * Cards use it to drop their shadow. A blur spreads sideways as well as down,
 * so a column of same-width cards draws two continuous grey lines down its
 * edges and the cards look like they are in a narrow lane — and the column
 * beside it, being a later sibling, paints over the spill and slices those
 * lines off. Neither happens in a full-width list, where the spill lands in
 * the screen gutter with nothing next to it.
 *
 * A context rather than a prop because it is a fact about WHERE the card is,
 * not about the card. Every call site would otherwise have to remember to pass
 * `flat`, and the one that forgot would be the one that looked wrong.
 */
export const BoardSurfaceContext = createContext(false);

export const useOnBoard = (): boolean => useContext(BoardSurfaceContext);
