// src/pages/Support/CustomerPicker.jsx
import { useEffect, useState } from "react";

import { Combobox } from "../../components/ui";
import { useApiQuery } from "../../hooks/useApiQuery";
import { SUPPORT_ENDPOINTS } from "../../api/supportQueries";
import CustomerFormModal from "./CustomerFormModal";

const NEW = "__new__";
const NEW_OPTION = { value: NEW, label: "+ New customer" };

/** "Acme Corp · 9990001111" — the mobile is what an agent recognises; email when there is none. */
export const customerLabel = (c) => `${c.Name} · ${c.Mobile ?? c.Email ?? "—"}`;
const toOption = (c) => ({ value: c.Id, label: customerLabel(c), row: c });

/**
 * Search-or-create customer picker for the complaint form (spec 2 §4). Types a
 * mobile or a name → sp_FetchCustomers does the matching (Name / ContactPerson /
 * Mobile / Email / City), so client-side filtering is switched off. The last
 * option is always "+ New customer": it opens CustomerFormModal and the saved
 * row becomes the value — the agent never leaves the complaint they are logging.
 *
 * `value` is any row with { Id, Name, Mobile?, Email? } (a customer row, or the
 * CustomerId/CustomerName/CustomerMobile trio off a ticket); `onChange` gets
 * the picked row or null.
 */
export default function CustomerPicker({ value, onChange, error }) {
  const [text, setText] = useState("");
  const [term, setTerm] = useState("");
  const [createOpen, setCreateOpen] = useState(false);

  // 300 ms, like useServerTable's search box — one request per pause, not per key.
  useEffect(() => {
    const t = setTimeout(() => setTerm(text.trim()), 300);
    return () => clearTimeout(t);
  }, [text]);

  const { data, isFetching } = useApiQuery({
    queryKey: ["customers", "search", term],
    endpoint: SUPPORT_ENDPOINTS.customers.fetchCustomers,
    params: { SearchTerm: term || null, PageSize: 20 },
    showErrorMessage: false,
  });
  const rows = data?.customers ?? [];

  const selected = value ? toOption(value) : null;
  // Keep the current value listed even when the search did not return it, so
  // MUI does not log "value not in options" and the input keeps its label.
  const options = [
    ...(selected && !rows.some((r) => r.Id === selected.value) ? [selected] : []),
    ...rows.map(toOption),
    NEW_OPTION,
  ];

  return (
    <>
      <Combobox
        label="Customer"
        required
        error={error}
        options={options}
        value={selected}
        filterOptions={(x) => x}
        onInputChange={(_, v, reason) => {
          if (reason === "input" || reason === "clear") setText(v);
        }}
        onChange={(opt) => {
          if (opt?.value === NEW) {
            setCreateOpen(true);
            return;
          }
          onChange?.(opt?.row ?? null);
        }}
        // blurOnSelect: picking "+ New customer" must not leave its label in
        // the input — blurring resyncs the text to the controlled value.
        blurOnSelect
        loading={isFetching}
        placeholder="Type a mobile or a name"
        noOptionsText="No customer found"
        data-testid="customer-picker"
      />
      <CustomerFormModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onSaved={(row) => {
          setCreateOpen(false);
          onChange?.(row);
        }}
      />
    </>
  );
}
