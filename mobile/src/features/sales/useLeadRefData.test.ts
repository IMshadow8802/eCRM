import { createElement, type ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { fetchLookups } from "../../api/configQueries";
import { fetchProducts } from "../../api/productQueries";
import { fetchAssignableUsers } from "../../api/userQueries";
import type { AssignableUser, Lookup, Product } from "../../types/api";
import { useLeadRefData } from "./useLeadRefData";

jest.mock("../../api/configQueries", () => ({
  ...jest.requireActual("../../api/configQueries"),
  fetchLookups: jest.fn(),
}));
jest.mock("../../api/productQueries");
jest.mock("../../api/userQueries");

const row = (Kind: string) => [{ Id: 1, Kind, Value: Kind }] as Lookup[];
const users = [{ Id: 5, FullName: "Asha" }] as AssignableUser[];
const products = [{ Id: 8 }] as Product[];

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return createElement(QueryClientProvider, { client }, children);
}

it("returns each list under its name, users scoped to the leads module", async () => {
  jest.mocked(fetchLookups).mockImplementation(async ({ Kind }) => row(Kind));
  jest.mocked(fetchAssignableUsers).mockResolvedValue(users);
  jest.mocked(fetchProducts).mockResolvedValue(products);

  const { result } = await renderHook(() => useLeadRefData(), { wrapper });

  await waitFor(() => expect(result.current.products).toEqual(products));
  await waitFor(() =>
    expect(result.current).toEqual({
      statuses: row("lead_status"),
      sources: row("lead_source"),
      lostReasons: row("lost_reason"),
      transferReasons: row("transfer_reason"),
      callOutcomes: row("call_outcome"),
      users,
      products,
      lostReasonsLoaded: true,
      transferReasonsLoaded: true,
      choicesState: "ready",
      retryChoices: expect.any(Function),
    }),
  );
  expect(fetchAssignableUsers).toHaveBeenCalledWith({ Module: "leads" });
});

it("is empty lists while loading, never undefined", async () => {
  jest.mocked(fetchLookups).mockReturnValue(new Promise(() => {}));
  jest.mocked(fetchAssignableUsers).mockReturnValue(new Promise(() => {}));
  jest.mocked(fetchProducts).mockReturnValue(new Promise(() => {}));

  const { result } = await renderHook(() => useLeadRefData(), { wrapper });

  expect(result.current).toEqual({
    statuses: [],
    sources: [],
    lostReasons: [],
    transferReasons: [],
    callOutcomes: [],
    users: [],
    products: [],
    // An empty list while loading is not "none configured".
    lostReasonsLoaded: false,
    transferReasonsLoaded: false,
    choicesState: "loading",
    retryChoices: expect.any(Function),
  });
});

it("reports a failed status or team list, and the retry refetches it", async () => {
  jest.mocked(fetchLookups).mockImplementation(async ({ Kind }) => row(Kind));
  jest.mocked(fetchAssignableUsers).mockRejectedValueOnce(new Error("down")).mockResolvedValue(users);
  jest.mocked(fetchProducts).mockResolvedValue(products);

  const { result } = await renderHook(() => useLeadRefData(), { wrapper });

  await waitFor(() => expect(result.current.choicesState).toBe("failed"));
  await act(async () => result.current.retryChoices());
  await waitFor(() => expect(result.current.choicesState).toBe("ready"));
  expect(result.current.users).toEqual(users);
});
