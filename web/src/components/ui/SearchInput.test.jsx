import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ThemeProvider } from "@mui/material/styles";
import { buildTheme } from "../../theme";
import SearchInput from "./SearchInput";

const wrap = (ui) => render(<ThemeProvider theme={buildTheme()}>{ui}</ThemeProvider>);

describe("SearchInput", () => {
  it("debounces onChange calls", async () => {
    const onChange = vi.fn();
    wrap(
      <SearchInput
        value=""
        onChange={onChange}
        debounceMs={50}
        data-testid="s"
      />,
    );
    fireEvent.change(screen.getByTestId("s"), { target: { value: "hello" } });
    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith("hello");
    });
  });

  it("clear button resets + fires empty", async () => {
    const onChange = vi.fn();
    wrap(
      <SearchInput
        value="abc"
        onChange={onChange}
        debounceMs={10}
        data-testid="s"
      />,
    );
    const clear = await screen.findByTestId("s-clear");
    fireEvent.click(clear);
    expect(onChange).toHaveBeenCalledWith("");
  });

  it("shortcut hint renders when no value", () => {
    wrap(
      <SearchInput
        value=""
        onChange={() => {}}
        shortcutHint="⌘K"
        data-testid="s"
      />,
    );
    expect(screen.getByText("⌘K")).toBeInTheDocument();
  });

  it("external value prop updates local", () => {
    const { rerender } = wrap(
      <SearchInput value="" onChange={() => {}} data-testid="s" />,
    );
    rerender(
      <ThemeProvider theme={buildTheme()}>
        <SearchInput value="updated" onChange={() => {}} data-testid="s" />
      </ThemeProvider>,
    );
    expect(screen.getByTestId("s")).toHaveValue("updated");
  });
});
