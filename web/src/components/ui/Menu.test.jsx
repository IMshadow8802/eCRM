import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ThemeProvider } from "@mui/material/styles";
import { buildTheme } from "../../theme";
import Menu from "./Menu";

const wrap = (ui) => render(<ThemeProvider theme={buildTheme()}>{ui}</ThemeProvider>);

describe("Menu", () => {
  it("renders items with icon + shortcut + header", () => {
    const anchor = document.createElement("div");
    document.body.appendChild(anchor);
    const items = [
      { header: "File" },
      { id: "open", label: "Open", icon: <span data-testid="ic">i</span>, shortcut: "⌘O" },
      { id: "del", label: "Delete", destructive: true },
      { id: "dis", label: "Disabled", disabled: true },
    ];
    wrap(
      <Menu open anchorEl={anchor} onClose={() => {}} items={items} data-testid="menu" />,
    );
    expect(screen.getByText("File")).toBeInTheDocument();
    expect(screen.getByText("Open")).toBeInTheDocument();
    expect(screen.getByText("⌘O")).toBeInTheDocument();
    expect(screen.getByText("Delete")).toBeInTheDocument();
    expect(screen.getByTestId("menu-dis")).toHaveAttribute("aria-disabled", "true");
    anchor.remove();
  });

  it("item click fires onClick + onClose", () => {
    const anchor = document.createElement("div");
    document.body.appendChild(anchor);
    const onClickItem = vi.fn();
    const onClose = vi.fn();
    wrap(
      <Menu
        open
        anchorEl={anchor}
        onClose={onClose}
        items={[{ id: "x", label: "Go", onClick: onClickItem }]}
        data-testid="menu"
      />,
    );
    fireEvent.click(screen.getByTestId("menu-x"));
    expect(onClickItem).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
    anchor.remove();
  });

  it("renders children when no items provided", () => {
    const anchor = document.createElement("div");
    document.body.appendChild(anchor);
    wrap(
      <Menu open anchorEl={anchor} onClose={() => {}}>
        <div>custom</div>
      </Menu>,
    );
    expect(screen.getByText("custom")).toBeInTheDocument();
    anchor.remove();
  });
});
