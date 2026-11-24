import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";

vi.mock("./useApiQuery", () => ({ useApiQuery: vi.fn(() => ({ data: { users: [{ Id: 1 }] } })) }));
import { useApiQuery } from "./useApiQuery";
import { useAssignableUsers } from "./useAssignableUsers";

const last = () => useApiQuery.mock.calls.at(-1)[0];

describe("useAssignableUsers", () => {
  beforeEach(() => useApiQuery.mockClear());

  it("defaults to the leads roster", () => {
    const { result } = renderHook(() => useAssignableUsers());
    expect(last().params).toEqual({ Module: "leads" });
    expect(last().queryKey).toEqual(["assignable-users", "leads", null]);
    expect(result.current.users).toEqual([{ Id: 1 }]);
  });
  it("posts { Module, RecordId } and never a BranchId", () => {
    renderHook(() => useAssignableUsers({ module: "complaints", recordId: 9, branchId: 2 }));
    expect(last().params).toEqual({ Module: "complaints", RecordId: 9 });
    expect(last().queryKey).toEqual(["assignable-users", "complaints", 9]);
  });
  it("passes enabled through and survives no data", () => {
    useApiQuery.mockReturnValueOnce({ data: undefined });
    const { result } = renderHook(() => useAssignableUsers({ enabled: false }));
    expect(last().enabled).toBe(false);
    expect(result.current.users).toEqual([]);
  });
});
