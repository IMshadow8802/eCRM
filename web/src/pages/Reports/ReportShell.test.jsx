import { describe, it, expect, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import renderWithProviders from "../../test/renderWithProviders";
import { ReportShellPage, ReportBarChart, ReportTable } from "./ReportShell";

const rows = [
  { Id: 1, Name: "A", N: 3 },
  { Id: 2, Name: "B", N: 5 },
];
const columns = [
  { header: "Name", cell: (r) => r.Name },
  { header: "N", align: "right", cell: (r) => r.N },
];

describe("ReportTable", () => {
  it("renders header + rows without row click affordances by default", () => {
    renderWithProviders(
      <ReportTable rows={rows} columns={columns} rowKey={(r) => r.Id} testId="t" />,
      { router: false },
    );
    const table = screen.getByTestId("t");
    expect(within(table).getAllByRole("columnheader").map((h) => h.textContent)).toEqual([
      "Name",
      "N",
    ]);
    const trs = table.querySelectorAll("tbody tr");
    expect(trs).toHaveLength(2);
    expect(trs[0].style.cursor).toBe("");
    expect(trs[0]).not.toHaveAttribute("tabindex");
    expect(screen.queryAllByTestId("t-row")).toHaveLength(0);
  });

  it("calls onRowClick with the row and marks rows clickable", async () => {
    const onRowClick = vi.fn();
    renderWithProviders(
      <ReportTable
        rows={rows}
        columns={columns}
        rowKey={(r) => r.Id}
        testId="t"
        onRowClick={onRowClick}
      />,
      { router: false },
    );
    const trs = screen.getAllByTestId("t-row");
    expect(trs).toHaveLength(2);
    expect(trs[1].style.cursor).toBe("pointer");
    await userEvent.setup().click(within(trs[1]).getByText("B"));
    expect(onRowClick).toHaveBeenCalledWith(rows[1]);
  });

  it("activates a row from the keyboard", async () => {
    const onRowClick = vi.fn();
    renderWithProviders(
      <ReportTable
        rows={rows}
        columns={columns}
        rowKey={(r) => r.Id}
        testId="t"
        onRowClick={onRowClick}
      />,
      { router: false },
    );
    const user = userEvent.setup();
    const [first, second] = screen.getAllByTestId("t-row");
    first.focus();
    await user.keyboard("{Enter}");
    expect(onRowClick).toHaveBeenCalledWith(rows[0]);

    second.focus();
    await user.keyboard(" ");
    expect(onRowClick).toHaveBeenCalledWith(rows[1]);

    onRowClick.mockClear();
    await user.keyboard("{Escape}");
    expect(onRowClick).not.toHaveBeenCalled();
  });
});

describe("ReportPage (shell) states", () => {
  const base = {
    title: "T",
    documentTitle: "T",
    testId: "p",
    errorText: "err",
    emptyText: "empty",
  };
  // Rendered one at a time rather than via `rerender`: renderWithProviders wraps
  // the tree inline, and RTL's rerender would drop the ThemeProvider.
  const show = (props) =>
    renderWithProviders(
      <ReportShellPage {...base} {...props}>
        <div>child</div>
      </ReportShellPage>,
      { router: false },
    );

  it("shows loading, error, empty, then children", () => {
    let view = show({ isLoading: true });
    expect(screen.getByTestId("p-loading")).toBeInTheDocument();
    view.unmount();

    view = show({ error: new Error("x") });
    expect(screen.getByTestId("p-error")).toHaveTextContent("err");
    view.unmount();

    view = show({ isEmpty: true });
    expect(screen.getByTestId("p-empty")).toHaveTextContent("empty");
    view.unmount();

    show({ subtitle: "S" });
    expect(screen.getByText("child")).toBeInTheDocument();
  });
});

describe("ReportBarChart", () => {
  it("renders with and without a legend", () => {
    const first = renderWithProviders(
      <ReportBarChart data={[{ n: "A", v: 1 }]} xKey="n" bars={[{ key: "v", name: "V" }]} />,
      { router: false },
    );
    expect(first.container.firstChild).toBeTruthy();
    first.unmount();

    const second = renderWithProviders(
      <ReportBarChart
        data={[]}
        xKey="n"
        legend={false}
        bars={[{ key: "v", name: "V", tone: "success" }]}
      />,
      { router: false },
    );
    expect(second.container.firstChild).toBeTruthy();
  });
});

