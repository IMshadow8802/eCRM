import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook } from "@testing-library/react";

// Stub the fetch layer — what matters here is the config useTeams/useUsers
// hand to it (endpoint, query key, base payload), not the request itself.
vi.mock("./useApiQuery.jsx", () => ({
  useApiQuery: vi.fn(() => ({ data: null, isLoading: false, error: null })),
}));

import { useTeams, useUsers } from "./useTaskData.jsx";
import { useApiQuery } from "./useApiQuery.jsx";

const lastCall = () => useApiQuery.mock.calls.at(-1)[0];

describe("useTaskData", () => {
  beforeEach(() => {
    useApiQuery.mockClear();
  });

  // Regression: the query keys used to come from an exported TASK_QUERY_KEYS
  // map. That map had no importers and was deleted with the other 21 dead
  // exports, so the literals below are now the only thing pinning the cache
  // keys — changing them silently splits every consumer's cache.
  it.each([
    ["useTeams", useTeams, "teams", "/api/teams/fetchTeams"],
    ["useUsers", useUsers, "users", "/api/users/fetchUsers"],
  ])("%s queries its endpoint under a stable key", (_name, hook, key, endpoint) => {
    renderHook(() => hook());
    const args = lastCall();
    expect(args.endpoint).toBe(endpoint);
    expect(args.dataKeys).toBe(key);
    expect(args.queryKey).toEqual([key, {}]);
    expect(args.enabled).toBe(true);
  });

  it("merges filters into the base payload and the query key", () => {
    const filters = { PageSize: 200, SearchTerm: "ana" };
    renderHook(() => useUsers(filters));
    const args = lastCall();
    expect(args.params).toEqual({
      Id: 0,
      PageNumber: 1,
      PageSize: 200,
      SearchTerm: "ana",
    });
    expect(args.queryKey).toEqual(["users", filters]);
  });

  it("passes enabled=false through so callers can defer the fetch", () => {
    renderHook(() => useTeams({}, false));
    expect(lastCall().enabled).toBe(false);
  });
});
