import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook } from "@testing-library/react";

// Stub the fetch layer — what matters is the config useLookups hands it (above
// all the query key), not the request.
vi.mock("./useApiQuery.jsx", () => ({
  useApiQuery: vi.fn(() => ({ data: null, isLoading: false, error: null })),
}));

import { useLookups } from "./useLookups.jsx";
import { useApiQuery } from "./useApiQuery.jsx";

const lastCall = () => useApiQuery.mock.calls.at(-1)[0];

describe("useLookups", () => {
  beforeEach(() => {
    useApiQuery.mockClear();
    useApiQuery.mockReturnValue({ data: null, isLoading: false, error: null });
  });

  it("queries the shared config endpoint with the kind as the payload", () => {
    renderHook(() => useLookups("priority"));
    const args = lastCall();
    expect(args.endpoint).toBe("/api/config/fetchLookups");
    expect(args.params).toEqual({ Kind: "priority" });
  });

  /**
   * The reason this hook exists. Six different keys were in use for these
   * rows — ["ticket-priorities"], ["support-priorities"],
   * ["ticket-lookups","priority"] and so on — while every Settings page
   * invalidates ["lookups", kind] after a save or delete. A rename therefore
   * reached nobody. If this assertion is ever loosened, that bug is back.
   */
  it.each([
    ["priority"],
    ["ticket_category"],
    ["resolution"],
    ["lead_source"],
    ["lost_reason"],
    ["call_outcome"],
  ])("keys %s under ['lookups', kind] so Settings invalidation reaches it", (kind) => {
    renderHook(() => useLookups(kind));
    expect(lastCall().queryKey).toEqual(["lookups", kind]);
  });

  it("returns the rows from the payload", () => {
    const lookups = [{ Id: 1, Value: "High" }];
    useApiQuery.mockReturnValue({ data: { lookups }, isLoading: false });
    const { result } = renderHook(() => useLookups("priority"));
    expect(result.current.lookups).toEqual(lookups);
  });

  it("returns an empty array before the payload arrives", () => {
    const { result } = renderHook(() => useLookups("priority"));
    expect(result.current.lookups).toEqual([]);
  });

  it("keeps the empty array referentially stable across renders", () => {
    // Consumers feed this straight into useMemo deps; a fresh [] each render
    // would re-run every one of them on every render.
    const { result, rerender } = renderHook(() => useLookups("priority"));
    const first = result.current.lookups;
    rerender();
    expect(result.current.lookups).toBe(first);
  });

  it("passes the rest of the query result through for the Settings pages", () => {
    const refetch = vi.fn();
    useApiQuery.mockReturnValue({ data: null, isLoading: true, refetch });
    const { result } = renderHook(() => useLookups("priority"));
    expect(result.current.isLoading).toBe(true);
    expect(result.current.refetch).toBe(refetch);
  });

  it("defers the fetch when disabled, for lookups behind a closed modal", () => {
    renderHook(() => useLookups("call_outcome", { enabled: false }));
    expect(lastCall().enabled).toBe(false);
  });

  it("does not fire without a kind, which would fetch every lookup row", () => {
    renderHook(() => useLookups(undefined));
    expect(lastCall().enabled).toBe(false);
  });

  it("toasts on failure by default but lets background feeders opt out", () => {
    renderHook(() => useLookups("priority"));
    expect(lastCall().showErrorMessage).toBe(true);

    renderHook(() => useLookups("priority", { showErrorMessage: false }));
    expect(lastCall().showErrorMessage).toBe(false);
  });
});
