import { act, renderHook } from "@testing-library/react-native";

import { useParamState } from "./useParamState";

type Params = { queue?: string } | undefined;

const mount = (params: Params) =>
  renderHook((p: Params) => useParamState(p, p?.queue, "mine"), { initialProps: params });

it("starts on the param, or the fallback without one", async () => {
  expect((await mount({ queue: "overdue" })).result.current[0]).toBe("overdue");
  expect((await mount(undefined)).result.current[0]).toBe("mine");
});

it("a new navigate() re-applies its param, even the same value after a local change", async () => {
  const first = { queue: "overdue" };
  const { result, rerender } = await mount(first);
  await act(async () => result.current[1]("team"));
  expect(result.current[0]).toBe("team");
  // Same object (a plain re-render): the user's choice stands.
  await rerender(first);
  expect(result.current[0]).toBe("team");
  // A fresh navigate() with the same value wins again.
  await rerender({ queue: "overdue" });
  expect(result.current[0]).toBe("overdue");
});

it("a navigate() that brings a value also runs onNavigate; a plain re-render does not", async () => {
  const onNavigate = jest.fn();
  const first: Params = { queue: "overdue" };
  const { rerender } = await renderHook((p: Params) => useParamState(p, p?.queue, "mine", onNavigate), {
    initialProps: first,
  });
  await rerender(first);
  await rerender({});
  expect(onNavigate).not.toHaveBeenCalled();
  await rerender({ queue: "mine" });
  expect(onNavigate).toHaveBeenCalledTimes(1);
});

it("new params without the key keep the current value", async () => {
  const { result, rerender } = await mount({ queue: "overdue" });
  await rerender({});
  expect(result.current[0]).toBe("overdue");
});
