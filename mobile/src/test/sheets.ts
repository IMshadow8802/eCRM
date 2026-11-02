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
