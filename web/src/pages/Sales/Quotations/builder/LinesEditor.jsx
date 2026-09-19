import { useMemo } from "react";
import { Box } from "@mui/material";
import { useTheme } from "@mui/material/styles";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { Button, Combobox, IconButton, TextInput } from "../../../../components/ui";
import { money } from "../buildQuoteDoc";
import { emptyLine, lineFromProduct } from "../quoteForm";

const num = { inputMode: "decimal" };

/**
 * The priced lines. Amounts shown here come from `amounts` (quoteMath), never
 * from this component doing its own multiplication — one definition of the
 * arithmetic, and it is not here.
 */
export default function LinesEditor({ lines, amounts, products = [], disabled = false, onChange }) {
  const theme = useTheme();
  const p = theme.tokens;
  const productOpts = useMemo(() => products.map((x) => ({ value: x.Id, label: x.Name, product: x })), [products]);

  const patch = (i, field) => (e) => onChange(lines.map((l, j) => (j === i ? { ...l, [field]: e.target.value } : l)));
  // sp_FinaliseQuotation refuses Rate < 0 — block it at entry so it never gets
  // that far. A zero rate (a free replacement line) is still legal.
  const patchRate = (i) => (e) => { if (!(Number(e.target.value) < 0)) patch(i, "rate")(e); };
  const setType = (i, discountType) => onChange(lines.map((l, j) => (j === i ? { ...l, discountType } : l)));
  const remove = (i) => onChange(lines.filter((_, j) => j !== i));
  const move = (i, d) => { const next = [...lines]; [next[i], next[i + d]] = [next[i + d], next[i]]; onChange(next); };

  const seg = (active) => ({
    height: 32, minWidth: 30, border: `1px solid ${active ? p.primary.main : p.border.default}`, background: active ? p.primary.subtle : p.surface.card,
    color: active ? p.primary.main : p.text.secondary, fontSize: 12, fontWeight: 600, cursor: disabled ? "default" : "pointer",
  });

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
      {lines.length === 0 && <Box sx={{ fontSize: 13, color: p.text.tertiary }}>No lines yet — add one, or pick a product.</Box>}
      {lines.map((l, i) => (
        <Box key={l.key} data-testid="quote-line" sx={{ border: `1px solid ${p.border.default}`, borderRadius: `${theme.radii.md}px`, p: 1.5, display: "flex", flexDirection: "column", gap: 1 }}>
          <Box sx={{ display: "flex", gap: 1, alignItems: "flex-end" }}>
            <Box sx={{ flex: 1 }}><TextInput size="sm" label="Description" value={l.description} onChange={patch(i, "description")} disabled={disabled} /></Box>
            {!disabled && (
              <Box sx={{ display: "flex" }}>
                <IconButton size="sm" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp size={14} /></IconButton>
                <IconButton size="sm" aria-label="Move down" disabled={i === lines.length - 1} onClick={() => move(i, 1)}><ArrowDown size={14} /></IconButton>
                <IconButton size="sm" variant="destructive" aria-label="Remove line" onClick={() => remove(i)}><Trash2 size={14} /></IconButton>
              </Box>
            )}
          </Box>
          <Box sx={{ display: "grid", gap: 1, gridTemplateColumns: { xs: "repeat(2, minmax(0, 1fr))", sm: "repeat(6, minmax(0, 1fr))" }, alignItems: "end" }}>
            <TextInput size="sm" label="HSN/SAC" value={l.hsn} onChange={patch(i, "hsn")} disabled={disabled} />
            <TextInput size="sm" label="Qty" value={l.qty} onChange={patch(i, "qty")} disabled={disabled} {...num} />
            <TextInput size="sm" label="Unit" value={l.unit} onChange={patch(i, "unit")} disabled={disabled} placeholder="Nos" />
            <TextInput size="sm" label="Rate" value={l.rate} onChange={patchRate(i)} disabled={disabled} {...num} />
            <Box sx={{ display: "flex", alignItems: "flex-end" }}>
              <Box sx={{ flex: 1 }}><TextInput size="sm" label="Discount" value={l.discountValue} onChange={patch(i, "discountValue")} disabled={disabled} {...num} /></Box>
              <button type="button" aria-label="Discount in percent" aria-pressed={l.discountType !== "amt"} disabled={disabled} onClick={() => setType(i, "pct")} style={{ ...seg(l.discountType !== "amt"), borderRadius: "0", marginLeft: 4 }}>%</button>
              <button type="button" aria-label="Discount in rupees" aria-pressed={l.discountType === "amt"} disabled={disabled} onClick={() => setType(i, "amt")} style={{ ...seg(l.discountType === "amt"), borderRadius: "0 8px 8px 0", borderLeft: "none" }}>₹</button>
            </Box>
            <TextInput size="sm" label="GST %" value={l.taxPct} onChange={patch(i, "taxPct")} disabled={disabled} {...num} />
          </Box>
          <Box sx={{ display: "flex", justifyContent: "flex-end", gap: 1, fontSize: 13, color: p.text.secondary }}>
            Amount <strong data-testid="line-amount" style={{ color: p.text.primary }}>{money(amounts?.lines?.[i]?.taxableAmt)}</strong>
          </Box>
        </Box>
      ))}
      {!disabled && (
        <Box sx={{ display: "flex", gap: 1, alignItems: "center", flexWrap: "wrap" }}>
          <Button size="sm" variant="tonal" leftIcon={<Plus size={14} />} onClick={() => onChange([...lines, emptyLine()])}>Add line</Button>
          {productOpts.length > 0 && (
            <Box sx={{ width: 260 }}>
              {/* value stays null: this is an action ("add this product"), not a field that holds a choice. */}
              <Combobox size="sm" placeholder="Add from products…" options={productOpts} value={null} blurOnSelect
                onChange={(opt) => opt && onChange([...lines, lineFromProduct(opt.product)])} data-testid="add-from-product" />
            </Box>
          )}
        </Box>
      )}
    </Box>
  );
}
