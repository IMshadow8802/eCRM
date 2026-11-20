import { BottomSheetModal } from "@gorhom/bottom-sheet";

const live: jest.SpyInstance[] = [];

/**
 * Spies on every sheet's present/dismiss. The gorhom mock keeps sheet content
 * mounted and both calls are no-ops, so "did the sheet open / close" is only
 * visible here. The spies are restored after the test.
 */
export function spySheets() {
  const present = jest.spyOn(BottomSheetModal.prototype, "present");
  const dismiss = jest.spyOn(BottomSheetModal.prototype, "dismiss");
  live.push(present, dismiss);
  return { present, dismiss };
}

afterEach(() => {
  while (live.length) live.pop()!.mockRestore();
});

interface HostNode { type: string; props: Record<string, unknown>; children: (HostNode | string)[] }

/**
 * A sheet's list must sit in gorhom's scrollable (the sheet body) and in NO
 * vertical react-native ScrollView: under the sheet's pan a plain one does not
 * scroll on Android. Returns the body scroll after asserting both.
 */
export function expectSheetScroll(root: unknown, body: HostNode) {
  expect(body.props.bottomSheetScrollable).toBe(true);
  const vertical: HostNode[] = [];
  const walk = (n: HostNode | string) => {
    if (typeof n === "string") return;
    if (n.type === "RCTScrollView" && !n.props.horizontal) vertical.push(n);
    n.children.forEach(walk);
  };
  walk(root as HostNode);
  // The body itself is the only vertical scroller on screen.
  expect(vertical).toEqual([body]);
  return body;
}
