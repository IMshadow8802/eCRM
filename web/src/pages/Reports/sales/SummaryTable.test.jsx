import { describe, it, expect } from "vitest";
import { fireEvent, screen, within } from "@testing-library/react";

import renderWithProviders from "../../../test/renderWithProviders";
import { buildTheme } from "../../../theme";
import { reportKey } from "../../../styles/tokens";
import { formatCurrency } from "../../../utils/format";
import SummaryTable from "./SummaryTable";
import { COLUMNS } from "./columns";
import { previousLabel } from "./salesReportUtils";

const p = buildTheme("light").tokens;
const rgb = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
};
const cols = ["new", "missed", "wonValue", "due", "openNow", "conversion"].map((k) => COLUMNS[k]);
const lines = [
  { GroupKey: 1, GroupLabel: "Amit", LineKind: "person", New: 5, FuMissed: 0, WonValue: 17000, OpenNow: 3, CohortWon: 1 },
  { GroupKey: 2, GroupLabel: "Sara", LineKind: "person", New: null, FuMissed: 2, WonValue: 0, OpenNow: 0 },
];
const totals = { New: 300, FuMissed: 400, WonValue: 17000, FuOpen: 229, OpenNow: 3 };
const previous = { range: { from: "2026-08-01", to: "2026-08-31" }, totals: { New: 221, FuMissed: 88, WonValue: 17000, FuOpen: 0, OpenNow: 9 } };
const href = (line, c) => (c.drill && Number(c.value(line)) ? `/rows/${line.LineKind}/${c.key}` : null);

const renderTable = (over = {}) =>
  renderWithProviders(
    <SummaryTable
      firstHeader="Person"
      columns={cols}
      lines={lines}
      totals={totals}
      previous={null}
      nameCell={(l) => l.GroupLabel}
      cellHref={href}
      sectionBefore={() => null}
      data-testid="sum"
      {...over}
    />,
  );

const rowOf = (text) => screen.getByText(text).closest("tr");

describe("SummaryTable", () => {
  it("heads with firstHeader then each column, a dot per key, `now` under a now column, the hint on hover", async () => {
    renderTable();
    const heads = screen.getAllByRole("columnheader");
    expect(heads.map((h) => h.textContent.replace(/now$/, ""))).toEqual(["Person", "New leads", "Missed", "Won ₹", "Follow-ups due", "Open leads", "Conversion %"]);
    expect(heads[5]).toHaveTextContent(/now$/);
    expect(heads[1]).not.toHaveTextContent(/now$/);
    expect(heads[1].querySelector('[data-key="new"]')).toBeInTheDocument();
    expect(heads[2].querySelector('[data-key="late"]')).toBeInTheDocument();
    fireEvent.mouseOver(within(heads[1]).getByText("New leads"));
    expect(await screen.findByText(COLUMNS.new.hint)).toBeInTheDocument();
  });

  it("a non-zero number with an href is a link in its key colour; zero is plain 0; null is —; money is formatCurrency", () => {
    renderTable();
    const amit = rowOf("Amit");
    const five = within(amit).getByRole("link", { name: "5" });
    expect(five).toHaveAttribute("href", "/rows/person/new");
    expect(five.style.color).toBe(rgb(reportKey.new.text));
    expect(five.style.textDecorationColor.toLowerCase()).toBe(reportKey.new.underline.toLowerCase());
    expect(within(amit).getByRole("link", { name: formatCurrency(17000) })).toHaveStyle({ color: rgb(reportKey.won.text) });
    // stock ink is the theme's own text colour
    expect(within(amit).getByRole("link", { name: "3" }).style.color).toBe(rgb(p.text.primary));
    // a derived number has no drill: plain text
    expect(within(amit).getByText("20.0%").closest("a")).toBeNull();
    const sara = rowOf("Sara");
    expect(within(sara).getAllByRole("cell")[1].textContent).toBe("—");
    expect(within(sara).getAllByText("0").every((el) => !el.closest("a"))).toBe(true);
    expect(within(sara).getAllByText("0").length).toBeGreaterThanOrEqual(2);
  });

  it("draws a full-width section row before a line when asked", () => {
    renderTable({ sectionBefore: (l) => (l.GroupKey === 2 ? "Not under anyone" : null) });
    const cell = screen.getByText("Not under anyone");
    expect(cell).toHaveAttribute("colspan", String(cols.length + 1));
    expect(cell.closest("tr").nextElementSibling).toBe(rowOf("Sara"));
    expect(screen.getAllByText("Not under anyone")).toHaveLength(1);
  });

  it("Total row follows the link rule against the totals line; no previous row without previous", () => {
    renderTable();
    const tot = rowOf("Total");
    expect(within(tot).getByRole("link", { name: "300" })).toHaveAttribute("href", "/rows/total/new");
    expect(screen.queryByText(/Previous period/)).toBeNull();
  });

  it("previous row: each value with its difference, ▲ better ▼ worse, bare when neither, nothing when equal, — on now", () => {
    renderTable({ previous });
    const row = rowOf(previousLabel(previous.range));
    const cells = within(row).getAllByRole("cell");
    expect(cells[1]).toHaveTextContent("221▲ +79");
    expect(within(cells[1]).getByText("▲ +79").style.color).toBe(rgb(reportKey.better));
    expect(within(cells[2]).getByText("▼ +312").style.color).toBe(rgb(reportKey.worse));
    expect(cells[3]).toHaveTextContent(formatCurrency(17000));
    expect(cells[3].textContent).toBe(formatCurrency(17000)); // equal: nothing
    // due = missed + open: 629 now against 88 before, and a rise is neither good nor bad
    expect(within(cells[4]).getByText("+541").style.color).toBe(rgb(p.text.tertiary));
    expect(cells[5].textContent).toBe("—");
    expect(cells[6].textContent).toBe("0"); // a zero is plain 0, and equal shows no difference
  });

  it("money differences carry the rupee sign", () => {
    renderTable({ previous: { ...previous, totals: { ...previous.totals, WonValue: 12000 } } });
    expect(screen.getByText("▲ +₹5,000")).toBeInTheDocument();
  });

  it("loading: six skeleton rows under the header, no footer", () => {
    renderTable({ loading: true, lines: [], previous });
    expect(screen.getAllByTestId("summary-skeleton-row")).toHaveLength(6);
    expect(screen.getByRole("columnheader", { name: /New leads/ })).toBeInTheDocument();
    expect(screen.queryByText("Total")).toBeNull();
    expect(screen.queryByText(/Previous period/)).toBeNull();
  });
});
