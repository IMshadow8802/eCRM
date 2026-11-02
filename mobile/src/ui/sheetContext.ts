import { createContext, useContext } from "react";

/**
 * True inside a `Sheet`. Inputs read it to swap to gorhom's
 * BottomSheetTextInput: a plain TextInput inside a bottom sheet loses focus
 * and sits under the keyboard, because the sheet must know about the input to
 * pan with it.
 */
export const InSheetContext = createContext(false);

export const useInSheet = () => useContext(InSheetContext);
