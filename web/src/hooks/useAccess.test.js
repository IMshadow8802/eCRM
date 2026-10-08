import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import useAuthStore from "../stores/useAuthStore";
import { useAccess, useIsAdmin, useCanSeeSensitive } from "./useAccess";

const setAccess = (access) => useAuthStore.setState({ access });

describe("useAccess", () => {
  it("reads a module's rights and computes wide", () => {
    setAccess({ isAdmin: false, modules: { leads: { view: true, add: true, edit: false, delete: false, reach: "Office" } } });
    const { result } = renderHook(() => useAccess("leads"));
    expect(result.current).toEqual({ view: true, add: true, edit: false, delete: false, reach: "Office", wide: true });
  });
  it("Own and Team reach are not wide", () => {
    setAccess({ isAdmin: false, modules: { leads: { view: true, reach: "Own" }, tasks: { view: true, reach: "Team" } } });
    expect(renderHook(() => useAccess("leads")).result.current.wide).toBe(false);
    expect(renderHook(() => useAccess("tasks")).result.current.wide).toBe(false);
  });
  it("a missing module is all false", () => {
    setAccess({ isAdmin: false, modules: {} });
    expect(renderHook(() => useAccess("complaints")).result.current).toMatchObject({ view: false, wide: false, reach: null });
  });
  it("no access at all (signed out) is all false", () => {
    setAccess(null);
    expect(renderHook(() => useAccess("leads")).result.current.view).toBe(false);
    expect(renderHook(() => useIsAdmin()).result.current).toBe(false);
    expect(renderHook(() => useCanSeeSensitive()).result.current).toBe(false);
  });
  it("admin is everything", () => {
    setAccess({ isAdmin: true, canSeeSensitive: true, modules: {} });
    expect(renderHook(() => useAccess("settings")).result.current).toMatchObject({ view: true, delete: true, wide: true });
    expect(renderHook(() => useIsAdmin()).result.current).toBe(true);
    expect(renderHook(() => useCanSeeSensitive()).result.current).toBe(true);
  });
});
