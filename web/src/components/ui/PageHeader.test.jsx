import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ThemeProvider } from "@mui/material/styles";
import { buildTheme } from "../../theme";
import PageHeader from "./PageHeader";
import { Home } from "lucide-react";
import { useState } from "react";
import { HeaderSlotContext } from "./headerSlot";

// A stand-in for RootLayout + TopNav: the layout owns the element, the bar renders it.
function Layout({ children }) {
  const [slot, setSlot] = useState(null);
  return (
    <HeaderSlotContext.Provider value={{ slot, setSlot }}>
      <header data-testid="bar"><div ref={setSlot} data-testid="slot" /></header>
      <main data-testid="body">{children}</main>
    </HeaderSlotContext.Provider>
  );
}

const wrap = (ui) => render(<ThemeProvider theme={buildTheme()}>{ui}</ThemeProvider>);

describe("PageHeader", () => {
  it("renders title + subtitle", () => {
    wrap(<PageHeader title="Dashboard" subtitle="At a glance" data-testid="h" />);
    expect(screen.getByText("Dashboard")).toBeInTheDocument();
    expect(screen.getByText("At a glance")).toBeInTheDocument();
  });

  it("breadcrumb with links", () => {
    wrap(
      <PageHeader
        title="X"
        breadcrumb={[
          { label: "Home", href: "/" },
          { label: "Tasks" },
        ]}
      />,
    );
    expect(screen.getByRole("link", { name: "Home" })).toBeInTheDocument();
    expect(screen.getByText("Tasks")).toBeInTheDocument();
  });

  it("icon + actions + tabs slots render", () => {
    wrap(
      <PageHeader
        title="X"
        icon={<Home />}
        actions={<button data-testid="btn">New</button>}
        tabs={<div data-testid="tabs">tabs</div>}
      />,
    );
    expect(screen.getByTestId("btn")).toBeInTheDocument();
    expect(screen.getByTestId("tabs")).toBeInTheDocument();
  });

  it("draws inline as one compact row when there is no top bar", () => {
    wrap(<PageHeader title="Leads" actions={<button>New</button>} data-testid="h" />);
    const h = screen.getByTestId("h");
    expect(h.dataset.pageHeader).toBe("inline");
    expect(screen.getByRole("heading", { level: 1, name: "Leads" })).toBeInTheDocument();
    expect(h).toContainElement(screen.getByRole("button", { name: "New" }));
  });

  it("portals title + actions into the top bar, and keeps tabs in the page", () => {
    wrap(
      <Layout>
        <PageHeader
          title="Task deadlines"
          subtitle="Did people finish in time?"
          actions={<button>Export CSV</button>}
          tabs={<div data-testid="tabs">tabs</div>}
          data-testid="h"
        />
      </Layout>,
    );
    const bar = screen.getByTestId("bar");
    expect(bar).toContainElement(screen.getByRole("heading", { level: 1, name: "Task deadlines" }));
    expect(bar).toContainElement(screen.getByRole("button", { name: "Export CSV" }));
    expect(bar).toHaveTextContent("Did people finish in time?");
    expect(screen.getByTestId("h").dataset.pageHeader).toBe("bar");
    expect(screen.getByTestId("body")).toContainElement(screen.getByTestId("tabs"));
    expect(screen.getByTestId("body")).not.toHaveTextContent("Task deadlines");
    // exactly one h1 on the page
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });

  it("leaves the bar when the page unmounts", () => {
    const { unmount } = wrap(<Layout><PageHeader title="Gone" /></Layout>);
    expect(screen.getByTestId("slot")).toHaveTextContent("Gone");
    unmount();
    expect(screen.queryByText("Gone")).not.toBeInTheDocument();
  });

  it("subtitle carries its full text as a tooltip when it is a string", () => {
    wrap(<PageHeader title="X" subtitle="A long line" />);
    expect(screen.getByText("A long line")).toHaveAttribute("title", "A long line");
  });

  it("draws an icon as a glyph in the tile's colour, never white on the white bar", () => {
    const { container } = wrap(<PageHeader title="Tasks" icon={<Home />} iconBg="#10B981" iconFg="#FFFFFF" />);
    const glyph = container.querySelector(".lucide").parentElement;
    expect(glyph.getAttribute("aria-hidden")).toBe("true");
    expect(getComputedStyle(glyph).color).toBe("rgb(16, 185, 129)");
    const { container: c2 } = wrap(<PageHeader title="X" icon={<Home />} iconBg="linear-gradient(red, blue)" />);
    expect(getComputedStyle(c2.querySelector(".lucide").parentElement).color).not.toBe("");
  });

  it("no breadcrumb renders fine", () => {
    wrap(<PageHeader title="X" />);
    expect(screen.getByText("X")).toBeInTheDocument();
  });
});

// Regression, 2026-09-19: the actions slot was `inline-flex; flexShrink: 0`
// with no wrap. The row above it wraps, which lets the whole block drop under
// the title, but never breaks it internally — so a detail page's ~570px of
// actions ran straight off a 336px screen and `<main>`'s `overflowX: hidden`
// clipped the primary button away entirely.
describe("actions overflow", () => {
  it("lets a crowded action cluster wrap instead of running off screen", () => {
    wrap(
      <PageHeader
        title="Lead"
        actions={
          <>
            <button type="button">Edit</button>
            <button type="button">Transfer</button>
            <button type="button">Schedule follow-up</button>
          </>
        }
      />,
    );
    const slot = screen.getByRole("button", { name: "Edit" }).parentElement;
    expect(slot.style.flexWrap).toBe("wrap");
    expect(slot.style.flexShrink).not.toBe("0");
  });

describe("on a phone", () => {
  const orig = window.matchMedia;
  beforeEach(() => {
    window.matchMedia = (q) => ({ matches: q.includes("max-width:767.98px"), media: q, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false; } });
  });
  afterEach(() => { window.matchMedia = orig; });

  it("folds the actions behind one button; picking one closes the menu", async () => {
    const onNew = vi.fn();
    wrap(<PageHeader title="Leads" actions={<button type="button" onClick={onNew}>New Lead</button>} />);
    expect(screen.queryByRole("button", { name: "New Lead" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("page-actions-more"));
    fireEvent.click(await screen.findByRole("button", { name: "New Lead" }));
    expect(onNew).toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole("button", { name: "New Lead" })).not.toBeInTheDocument());
  });

  it("clicking inside the menu but not on a button leaves it open", async () => {
    wrap(<PageHeader title="Leads" actions={<span>Note</span>} />);
    fireEvent.click(screen.getByTestId("page-actions-more"));
    fireEvent.click(await screen.findByText("Note"));
    expect(screen.getByTestId("page-actions-menu")).toBeInTheDocument();
  });
});
});
