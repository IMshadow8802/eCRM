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
    expect(result.current.users).toEqual([{ Id: 1 }]);
  });
  it("sends Module and a Module-specific key for complaints", () => {
    renderHook(() => useAssignableUsers({ module: "complaints", branchId: 2 }));
    expect(last().params).toEqual({ BranchId: 2, Module: "complaints" });
    expect(last().queryKey).toEqual(["assignable-users", 2, "complaints"]);
  });
});
