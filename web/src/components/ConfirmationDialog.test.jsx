import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ThemeProvider } from "@mui/material/styles";
import { Ghost } from "lucide-react";

import { buildTheme } from "../theme";
import ConfirmationDialog from "./ConfirmationDialog";

const wrap = (ui, mode = "light") =>
  render(<ThemeProvider theme={buildTheme(mode)}>{ui}</ThemeProvider>);

const base = {
  open: true,
  onClose: () => {},
  onConfirm: () => {},
  title: "Delete this lead?",
  message: "This cannot be undone.",
};

describe("ConfirmationDialog", () => {
  it("renders nothing while closed", () => {
    wrap(<ConfirmationDialog {...base} open={false} />);
    expect(screen.queryByText("Delete this lead?")).toBeNull();
  });

  it("shows its title, message and both button labels", () => {
    wrap(
      <ConfirmationDialog {...base} confirmText="Yes, delete" cancelText="Keep it" />,
    );
    expect(screen.getByText("Delete this lead?")).toBeInTheDocument();
    expect(screen.getByText("This cannot be undone.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Yes, delete" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Keep it" })).toBeInTheDocument();
  });

  it("defaults its button labels to Confirm and Cancel", () => {
    wrap(<ConfirmationDialog {...base} />);
    expect(screen.getByRole("button", { name: "Confirm" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
  });

  it("calls onConfirm on confirm and onClose on cancel", () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    wrap(<ConfirmationDialog {...base} onConfirm={onConfirm} onClose={onClose} />);

    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("survives a confirm with no handler attached", () => {
    wrap(<ConfirmationDialog {...base} onConfirm={undefined} />);
    expect(() =>
      fireEvent.click(screen.getByRole("button", { name: "Confirm" })),
    ).not.toThrow();
  });

  it("locks both buttons and spins the confirm while a confirm is in flight", () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    wrap(
      <ConfirmationDialog {...base} isLoading onConfirm={onConfirm} onClose={onClose} />,
    );

    // The confirm button's label is hidden behind its spinner, so it has no
    // accessible name to query by while it is busy.
    const [cancel, confirm] = screen.getAllByRole("button");
    expect(cancel).toHaveAccessibleName("Cancel");
    expect(confirm).toBeDisabled();
    expect(cancel).toBeDisabled();
    expect(confirm).toHaveAttribute("aria-busy", "true");

    fireEvent.click(confirm);
    fireEvent.click(cancel);
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  // Escape reaches handleClose directly, past the disabled Cancel button —
  // which is the only way the in-flight guard inside it can be exercised.
  it("ignores Escape while a confirm is in flight, and honours it otherwise", () => {
    const onClose = vi.fn();
    const { rerender } = wrap(
      <ThemeProvider theme={buildTheme("light")}>
        <ConfirmationDialog {...base} isLoading onClose={onClose} />
      </ThemeProvider>,
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();

    rerender(
      <ThemeProvider theme={buildTheme("light")}>
        <ConfirmationDialog {...base} isLoading={false} onClose={onClose} />
      </ThemeProvider>,
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("survives Escape with no onClose attached", () => {
    wrap(<ConfirmationDialog {...base} onClose={undefined} />);
    expect(() => fireEvent.keyDown(document, { key: "Escape" })).not.toThrow();
  });

  it.each([
    ["danger", "lucide-trash-2"],
    ["warning", "lucide-triangle-alert"],
    ["info", "lucide-info"],
    ["success", "lucide-circle-check"],
  ])("draws the %s tone with its own glyph", (type, glyph) => {
    wrap(<ConfirmationDialog {...base} type={type} />);
    expect(screen.getByRole("dialog").querySelector(`.${glyph}`)).toBeInTheDocument();
  });

  it("falls back to a neutral glyph for a tone it does not know", () => {
    wrap(<ConfirmationDialog {...base} type="fuchsia" />);
    expect(
      screen.getByRole("dialog").querySelector(".lucide-circle-alert"),
    ).toBeInTheDocument();
  });

  it("only the danger tone gets the destructive confirm button", () => {
    const confirmBackground = (type) => {
      const { unmount } = wrap(<ConfirmationDialog {...base} type={type} />);
      const bg = screen.getByRole("button", { name: "Confirm" }).style.background;
      unmount();
      return bg;
    };
    const danger = confirmBackground("danger");
    expect(danger).not.toBe(confirmBackground("warning"));
    expect(confirmBackground("info")).toBe(confirmBackground("warning"));
  });

  it("lets a caller replace the tone glyph with its own icon", () => {
    wrap(<ConfirmationDialog {...base} type="danger" icon={<Ghost size={22} />} />);
    const dialog = screen.getByRole("dialog");
    expect(dialog.querySelector(".lucide-ghost")).toBeInTheDocument();
    expect(dialog.querySelector(".lucide-trash-2")).toBeNull();
  });

  it("maps maxWidth onto the dialog width, treating xs as the small size", () => {
    const widthFor = (maxWidth) => {
      const { unmount } = wrap(<ConfirmationDialog {...base} maxWidth={maxWidth} />);
      const width = screen.getByRole("dialog").style.maxWidth;
      unmount();
      return width;
    };
    expect(widthFor("xs")).toBe(widthFor("sm"));
    expect(widthFor("lg")).not.toBe(widthFor("sm"));
  });

  it("gives the long message somewhere to scroll instead of overflowing", () => {
    wrap(<ConfirmationDialog {...base} message={"Line. ".repeat(400)} />);
    const body = screen.getByRole("dialog").firstChild;
    expect(body.style.overflowY).toBe("auto");
    expect(body.style.flex).toBe("1 1 0%");
  });

  it("renders in dark mode", () => {
    wrap(<ConfirmationDialog {...base} />, "dark");
    expect(screen.getByText("Delete this lead?")).toBeInTheDocument();
  });

  // Tones are looked up in the theme by name, and a theme that has no palette
  // for one must still draw a readable dialog rather than crash on undefined.
  it("falls back to the primary palette for a tone the theme has no colours for", () => {
    const full = buildTheme("light");
    const withoutInfo = { ...full, tokens: { ...full.tokens, info: undefined } };

    const iconColor = (theme, type) => {
      const { unmount } = render(
        <ThemeProvider theme={theme}>
          <ConfirmationDialog {...base} type={type} />
        </ThemeProvider>,
      );
      const color = screen.getByRole("dialog").firstChild.firstChild.style.color;
      unmount();
      return color;
    };

    const primary = iconColor(full, "fuchsia");
    expect(iconColor(full, "info")).not.toBe(primary);
    expect(iconColor(withoutInfo, "info")).toBe(primary);
  });
});
