import { queryClient } from "./queryClient";

it("retries a query once, never pauses on connectivity, and never retries a mutation", () => {
  const { queries, mutations } = queryClient.getDefaultOptions();
  expect(queries).toMatchObject({
    retry: 1,
    retryDelay: 1000,
    networkMode: "always",
    staleTime: 60_000,
    gcTime: 600_000,
    refetchOnWindowFocus: false,
  });
  expect(mutations).toEqual({ retry: 0, networkMode: "always" });
});
