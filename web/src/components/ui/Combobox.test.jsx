import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThemeProvider } from "@mui/material/styles";
import { buildTheme } from "../../theme";
import Combobox from "./Combobox";

const wrap = (ui, mode = "light") =>
  render(<ThemeProvider theme={buildTheme(mode)}>{ui}</ThemeProvider>);

const OPTS = [
  { value: "a", label: "Apple" },
  { value: "b", label: "Banana" },
  { value: "c", label: "Cherry" },
];

describe("Combobox", () => {
  it("renders label + placeholder", () => {
    wrap(
      <Combobox
        options={OPTS}
        value={null}
        onChange={() => {}}
        label="Fruit"
        placeholder="Pick one"
        data-testid="cb"
      />,
    );
    expect(screen.getByLabelText("Fruit")).toBeInTheDocument();
  });

  it("opens menu and selects option", async () => {
    const onChange = vi.fn();
    wrap(
      <Combobox
        options={OPTS}
        value={null}
        onChange={onChange}
        label="Fruit"
        data-testid="cb"
      />,
    );
    const user = userEvent.setup();
    const input = screen.getByRole("combobox");
    await user.click(input);
    await user.click(await screen.findByText("Apple"));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ value: "a" }),
    );
  });

  it("filters options by typing", async () => {
    wrap(
      <Combobox
        options={OPTS}
        value={null}
        onChange={() => {}}
        label="F"
        data-testid="cb"
      />,
    );
    const user = userEvent.setup();
    const input = screen.getByRole("combobox");
    await user.type(input, "Ban");
    expect(await screen.findByText("Banana")).toBeInTheDocument();
    expect(screen.queryByText("Apple")).not.toBeInTheDocument();
  });

  it("multiple mode shows selected as chips", () => {
    wrap(
      <Combobox
        options={OPTS}
        value={[OPTS[0], OPTS[1]]}
        onChange={() => {}}
        multiple
        label="F"
        data-testid="cb"
      />,
    );
    expect(screen.getByText("Apple")).toBeInTheDocument();
    expect(screen.getByText("Banana")).toBeInTheDocument();
  });

  it("error + helper text displayed", () => {
    wrap(
      <Combobox
        options={OPTS}
        value={null}
        onChange={() => {}}
        label="F"
        error="required"
        data-testid="cb"
      />,
    );
    expect(screen.getByText("required")).toBeInTheDocument();
  });

  it("disabled prevents interaction", async () => {
    const onChange = vi.fn();
    wrap(
      <Combobox
        options={OPTS}
        value={null}
        onChange={onChange}
        label="F"
        disabled
      />,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("combobox"));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("no options shows noOptionsText", async () => {
    wrap(
      <Combobox
        options={[]}
        value={null}
        onChange={() => {}}
        label="F"
      />,
    );
    const user = userEvent.setup();
    const input = screen.getByRole("combobox");
    await user.click(input);
    expect(await screen.findByText(/Nothing found/i)).toBeInTheDocument();
  });
});
