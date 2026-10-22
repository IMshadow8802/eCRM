// src/pages/Sales/VisitingCards/VisitingCards.jsx
import { useMemo, useState } from "react";
import { Helmet } from "react-helmet-async";
import { Box } from "@mui/material";
import { useTheme } from "@mui/material/styles";
import { MaterialReactTable } from "material-react-table";
import { AlertCircle, ChevronLeft, ChevronRight, IdCard, LayoutGrid, List, Search } from "lucide-react";

import { Button, EmptyState, Skeleton, TextInput } from "../../../components/ui";
import PageHeader from "../../../components/ui/PageHeader";
import useServerTable from "../../../hooks/useServerTable";
import { CARD_ENDPOINTS } from "../../../api/cardQueries";
import { formatDate } from "../../../utils/format";
import { rem } from "../../../utils/rem";
import CardDetailModal from "./CardDetailModal";
import CardTile from "./CardTile";

const PAGE_SIZE = 24;
const VIEW_KEY = "visitingCards.view";
const readView = () => { try { return localStorage.getItem(VIEW_KEY) === "table" ? "table" : "cards"; } catch { return "cards"; } };
const saveView = (v) => { try { localStorage.setItem(VIEW_KEY, v); } catch { /* private window: the switch still works for this visit */ } };

const first = (list) => list?.[0] || "—";

// Two-icon segmented switch (VisiScan's ViewToggle), solid surfaces only.
function ViewToggle({ value, onChange }) {
  const theme = useTheme();
  const p = theme.tokens;
  const seg = (v, Icon, label) => (
    <button key={v} type="button" aria-label={label} aria-pressed={value === v} title={label} onClick={() => onChange(v)}
      style={{
        width: "calc(36rem / 15)", height: "calc(30rem / 15)", display: "inline-flex", alignItems: "center", justifyContent: "center",
        border: 0, borderRadius: rem(theme.radii.sm), cursor: "pointer",
        background: value === v ? p.surface.card : p.surface.track,
        color: value === v ? p.text.primary : p.text.secondary,
        boxShadow: value === v ? p.shadow.xs : "none",
      }}>
      <Icon size={16} />
    </button>
  );
  return (
    <div role="group" aria-label="View" style={{ display: "inline-flex", padding: "calc(3rem / 15)", borderRadius: rem(theme.radii.md), background: p.surface.track }}>
      {seg("cards", LayoutGrid, "Card view")}
      {seg("table", List, "Table view")}
    </div>
  );
}

const grid = { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, calc(250rem / 15)), 1fr))", gap: "calc(16rem / 15)", minWidth: 0 };

/** Cards scanned in the VisiScan app, within the caller's reach. Read-only. */
const VisitingCards = () => {
  const p = useTheme().tokens;
  const [card, setCard] = useState(null);
  const [view, setView] = useState(readView);
  const pickView = (v) => { setView(v); saveView(v); };

  const columns = useMemo(() => [
    { accessorKey: "businessName", header: "Business", enableSorting: false, Cell: ({ cell }) => cell.getValue() || "—" },
    { accessorKey: "contactPerson", header: "Contact", enableSorting: false, Cell: ({ cell }) => cell.getValue() || "—" },
    { id: "mobile", header: "Mobile", enableSorting: false, accessorFn: (r) => first(r.mobiles) },
    { id: "email", header: "Email", enableSorting: false, accessorFn: (r) => first(r.emails) },
    { accessorKey: "ownerName", header: "Scanned by", enableSorting: false, Cell: ({ cell }) => cell.getValue() || "—" },
    { accessorKey: "receivedAt", header: "Received", enableSorting: false, Cell: ({ cell }) => formatDate(cell.getValue(), { empty: "—" }) },
  ], []);

  // One query feeds both views: same page, same search, the switch never refetches.
  const { table, data, isLoading, error, refetch, totalRecords, pagination, globalFilter, debouncedFilter } = useServerTable({
    columns, queryKey: "cards", endpoint: CARD_ENDPOINTS.fetchCard, dataKey: "rows",
    initialPageSize: PAGE_SIZE, getRowId: (r) => r.id,
    // The shared search box above both views drives MRT's global filter.
    positionGlobalFilter: "none",
    // Multiples of the card grid's 2/3/4 columns, so a full page fills its rows.
    muiPaginationProps: { rowsPerPageOptions: [12, 24, 48, 96] },
    muiTableBodyRowProps: ({ row }) => ({ hover: true, sx: { cursor: "pointer" }, onClick: () => setCard(row.original) }),
  });

  const pages = Math.max(1, Math.ceil(totalRecords / pagination.pageSize));
  const page = pagination.pageIndex + 1;

  let body;
  if (error) {
    body = <EmptyState icon={<AlertCircle size={32} />} title="Couldn't load visiting cards" description="Check your connection and try again." action={<Button onClick={() => refetch()}>Retry</Button>} />;
  } else if (!isLoading && data.length === 0 && !debouncedFilter) {
    body = <EmptyState icon={<IdCard size={32} />} title="No visiting cards yet" description="Scan a card in the VisiScan app and it shows up here." />;
  } else if (view === "table") {
    body = <MaterialReactTable table={table} />;
  } else if (isLoading) {
    body = (
      <div style={grid} data-testid="cards-loading">
        {Array.from({ length: 8 }, (_, k) => <Skeleton key={k} style={{ width: "100%", aspectRatio: "1 / 1" }} rounded={rem(16)} />)}
      </div>
    );
  } else if (data.length === 0) {
    body = <EmptyState size="sm" icon={<Search size={24} />} title={`No cards match “${debouncedFilter}”`} description="Try a name, number or company." />;
  } else {
    body = (
      <>
        <div style={grid}>{data.map((c) => <CardTile key={c.id} card={c} onOpen={setCard} />)}</div>
        {pages > 1 && (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "calc(12rem / 15)", padding: "calc(20rem / 15) 0 calc(4rem / 15)" }}>
            <Button variant="secondary" size="sm" aria-label="Previous page" leftIcon={<ChevronLeft size={14} />} disabled={page <= 1} onClick={() => table.previousPage()}>Prev</Button>
            <span style={{ fontSize: "calc(13rem / 15)", fontWeight: 600, color: p.text.secondary, fontVariantNumeric: "tabular-nums" }}>{`Page ${page} of ${pages}`}</span>
            <Button variant="secondary" size="sm" aria-label="Next page" disabled={page >= pages} onClick={() => table.nextPage()}>
              Next <ChevronRight size={14} style={{ verticalAlign: "middle" }} />
            </Button>
          </div>
        )}
      </>
    );
  }

  return (
    <Box sx={{ display: "flex", flexDirection: "column", flexGrow: 1, minWidth: 0 }}>
      <PageHeader title="Visiting Cards" subtitle="Cards scanned in the VisiScan app." />
      <Helmet><title>PRD Infotech | Visiting Cards</title></Helmet>
      <Box sx={{ display: "flex", alignItems: "center", gap: "calc(12rem / 15)", mb: "calc(16rem / 15)" }}>
        <Box sx={{ flex: { xs: 1, sm: "0 1 calc(320rem / 15)" }, minWidth: 0 }}>
          <TextInput
            size="sm" placeholder="Search name, number, company…" aria-label="Search cards"
            leftAdornment={<Search size={14} />}
            value={globalFilter ?? ""}
            onChange={(e) => table.setGlobalFilter(e.target.value || undefined)}
          />
        </Box>
        <Box sx={{ ml: "auto", flexShrink: 0 }}><ViewToggle value={view} onChange={pickView} /></Box>
      </Box>
      {body}
      <CardDetailModal open={Boolean(card)} card={card} onClose={() => setCard(null)} />
    </Box>
  );
};

export default VisitingCards;
