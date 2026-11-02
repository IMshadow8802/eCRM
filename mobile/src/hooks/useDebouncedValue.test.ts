import { act, renderHook } from "@testing-library/react-native";

import { useDebouncedValue } from "./useDebouncedValue";

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

const mount = (initial: string, delayMs?: number) =>
  renderHook(({ value }: { value: string }) => useDebouncedValue(value, delayMs), {
    initialProps: { value: initial },
  });

it("lags the value by 300 ms by default", async () => {
  const { result, rerender } = await mount("");
  await rerender({ value: "cem" });
  expect(result.current).toBe("");
  await act(() => jest.advanceTimersByTime(299));
  expect(result.current).toBe("");
  await act(() => jest.advanceTimersByTime(1));
  expect(result.current).toBe("cem");
});

it("rapid changes collapse into one, the last value", async () => {
  const seen: string[] = [];
  const { result, rerender } = await renderHook(
    ({ value }: { value: string }) => {
      const v = useDebouncedValue(value);
      seen.push(v);
      return v;
    },
    { initialProps: { value: "" } },
  );
  for (const v of ["c", "ce", "cem"]) {
    await rerender({ value: v });
    await act(() => jest.advanceTimersByTime(100));
  }
  await act(() => jest.advanceTimersByTime(300));
  expect(result.current).toBe("cem");
  expect([...new Set(seen)]).toEqual(["", "cem"]);
});

it("clearing applies at once, and typing again does not bring the old term back", async () => {
  const { result, rerender } = await mount("cement");
  await rerender({ value: "" });
  expect(result.current).toBe("");
  await rerender({ value: "b" });
  expect(result.current).toBe("");
  await act(() => jest.advanceTimersByTime(300));
  expect(result.current).toBe("b");
});

it("honours a custom delay", async () => {
  const { result, rerender } = await mount("", 50);
  await rerender({ value: "x" });
  await act(() => jest.advanceTimersByTime(50));
  expect(result.current).toBe("x");
});

it("unmounting clears the pending timer", async () => {
  const { rerender, unmount } = await mount("");
  await rerender({ value: "cem" });
  const clear = jest.spyOn(globalThis, "clearTimeout");
  await unmount();
  expect(clear).toHaveBeenCalled();
  clear.mockRestore();
});
