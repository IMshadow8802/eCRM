import { createContext, useContext } from "react";

/**
 * Where a page's header lives. RootLayout owns the element; TopNav renders it
 * on the bar's own line; PageHeader portals into it. Outside RootLayout (a page
 * rendered alone in a test) there is no slot and PageHeader draws inline.
 */
export const HeaderSlotContext = createContext({ slot: null, setSlot: () => {} });

export const useHeaderSlot = () => useContext(HeaderSlotContext);
