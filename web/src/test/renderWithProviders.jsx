import { ThemeProvider } from "@mui/material/styles";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SnackbarProvider } from "notistack";
import { MemoryRouter } from "react-router-dom";
import { render } from "@testing-library/react";

import { buildTheme } from "../theme";

export default function renderWithProviders(ui, { mode = "light", router = true } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const tree = (
    <ThemeProvider theme={buildTheme(mode)}>
      <QueryClientProvider client={client}>
        <SnackbarProvider>{ui}</SnackbarProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
  return render(router ? <MemoryRouter>{tree}</MemoryRouter> : tree);
}
