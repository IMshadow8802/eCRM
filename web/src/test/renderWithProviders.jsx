import { ThemeProvider } from "@mui/material/styles";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SnackbarProvider } from "notistack";
import { MemoryRouter } from "react-router-dom";
import { render } from "@testing-library/react";

import { buildTheme } from "../theme";

export default function renderWithProviders(
  ui,
  { mode = "light", router = true, route } = {},
) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const tree = (
    <ThemeProvider theme={buildTheme(mode)}>
      <QueryClientProvider client={client}>
        <SnackbarProvider>{ui}</SnackbarProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
  if (!router) return render(tree);
  // `route` sets the starting URL, for tests that assert on route matching.
  return render(
    <MemoryRouter initialEntries={route ? [route] : undefined}>
      {tree}
    </MemoryRouter>,
  );
}
