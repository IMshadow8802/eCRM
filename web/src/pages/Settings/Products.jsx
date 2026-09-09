// src/pages/Settings/Products.jsx
//
// The product master. `fetchProducts` defaults to active-only, which is right
// for the pickers that consume it and wrong here: the one screen that can
// reactivate a product must be able to see the deactivated ones, so the table
// asks for `IsActive: null` (all).
import { useMemo, useState } from "react";
import { Helmet } from "react-helmet-async";
import { Box } from "@mui/material";
import { MaterialReactTable } from "material-react-table";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useSnackbar } from "notistack";

import PageHeader from "../../components/ui/PageHeader";
import { Button, Chip, IconButton, Tooltip } from "../../components/ui";
import ConfirmationDialog from "../../components/ConfirmationDialog";
import {
  FormModal,
  FormContainer,
  FormRow,
  FormInput,
  FormNumberInput,
  FormSelect,
  FormCheckbox,
  FormButtons,
} from "../../components/Design/FormComponents";
import useServerTable from "../../hooks/useServerTable";
import { useApiMutation } from "../../hooks/useApiMutation";
import { useLookups } from "../../hooks/useLookups";
import { useConfirmation } from "../../hooks";
import { SALES_ENDPOINTS } from "../../api/salesQueries";
import { formatCurrency } from "../../utils/format";

const EMPTY = { Name: "", Code: "", CategoryId: "", UnitPrice: "", MarginPct: "", IsActive: true };

const toForm = (p) => ({
  Name: p.Name ?? "",
  Code: p.Code ?? "",
  CategoryId: p.CategoryId ? String(p.CategoryId) : "",
  UnitPrice: p.UnitPrice == null ? "" : String(p.UnitPrice),
  MarginPct: p.MarginPct == null ? "" : String(p.MarginPct),
  IsActive: Boolean(p.IsActive),
});

// A refusal from the SP carries a message worth showing; a transport failure
// arrives as an axios error whose message ("Network Error") does not.
const errorText = (error, fallback) =>
  error.isAxiosError ? error.response?.data?.message || fallback : error.message;

export default function Products() {
  const { enqueueSnackbar } = useSnackbar();
  const confirmation = useConfirmation();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [errors, setErrors] = useState({});

  const { lookups: categories } = useLookups("product_category", { showErrorMessage: false });
  const categoryOptions = categories.map((c) => ({ value: String(c.Id), label: c.Value }));

  const columns = useMemo(
    () => [
      { accessorKey: "Name", header: "Name" },
      { accessorKey: "Code", header: "Code", Cell: ({ cell }) => cell.getValue() || "—" },
      { accessorKey: "CategoryName", header: "Category", Cell: ({ cell }) => cell.getValue() || "—" },
      {
        accessorKey: "UnitPrice",
        header: "Unit price",
        Cell: ({ cell }) => formatCurrency(cell.getValue(), { empty: "—" }),
      },
      {
        accessorKey: "MarginPct",
        header: "Margin %",
        Cell: ({ cell }) => (cell.getValue() == null ? "—" : `${cell.getValue()}%`),
      },
      {
        accessorKey: "IsActive",
        header: "Status",
        Cell: ({ cell }) => (
          <Chip
            label={cell.getValue() ? "Active" : "Inactive"}
            tone={cell.getValue() ? "success" : "default"}
            size="sm"
          />
        ),
      },
    ],
    []
  );

  const { table, refetch } = useServerTable({
    columns,
    queryKey: "products",
    endpoint: SALES_ENDPOINTS.products.fetchProducts,
    dataKey: "products",
    extraParams: { IsActive: null },
    getRowId: (row) => row.Id,
    enableRowActions: true,
    displayColumnDefOptions: { "mrt-row-actions": { size: 80, grow: false, header: "Actions" } },
    renderRowActions: ({ row }) => (
      <Box sx={{ display: "flex", gap: 0.5 }}>
        <Tooltip title="Edit">
          <IconButton
            size="sm"
            variant="ghost"
            aria-label="Edit product"
            onClick={() => {
              setEditing(row.original);
              setForm(toForm(row.original));
              setErrors({});
              setOpen(true);
            }}
          >
            <Pencil size={16} />
          </IconButton>
        </Tooltip>
        <Tooltip title="Delete">
          <IconButton
            size="sm"
            variant="ghost"
            aria-label="Delete product"
            onClick={() =>
              confirmation.confirmDelete({
                title: "Delete Product",
                message: `Delete "${row.original.Name}"? Leads keep their reference; it just leaves the pick-list.`,
                confirmText: "Delete Product",
                onConfirm: () => deleteMutation.mutateAsync({ Id: row.original.Id }),
              })
            }
          >
            <Trash2 size={16} />
          </IconButton>
        </Tooltip>
      </Box>
    ),
  });

  const saveMutation = useApiMutation({
    endpoint: SALES_ENDPOINTS.products.saveProduct,
    successMessage: `Product ${editing ? "updated" : "created"}`,
    invalidateQueries: [["products"]],
    showErrorMessage: false,
    onSuccess: () => {
      setOpen(false);
      setEditing(null);
      refetch?.();
    },
    onError: (e) => enqueueSnackbar(errorText(e, "Failed to save product"), { variant: "error" }),
  });

  const deleteMutation = useApiMutation({
    endpoint: SALES_ENDPOINTS.products.deleteProduct,
    successMessage: "Product deleted",
    invalidateQueries: [["products"]],
    showErrorMessage: false,
    onError: (e) => enqueueSnackbar(errorText(e, "Failed to delete product"), { variant: "error" }),
  });

  const set = (k) => (e) => {
    setForm((f) => ({
      ...f,
      [k]: e?.target?.type === "checkbox" ? e.target.checked : e.target.value,
    }));
    if (errors[k]) setErrors((x) => ({ ...x, [k]: "" }));
  };

  const validate = () => {
    const next = {};
    if (!form.Name.trim()) next.Name = "Name is required";
    const m = form.MarginPct === "" ? null : Number(form.MarginPct);
    if (m != null && (Number.isNaN(m) || m < 0 || m > 100))
      next.MarginPct = "Margin must be between 0 and 100";
    if (form.UnitPrice !== "" && Number(form.UnitPrice) < 0)
      next.UnitPrice = "Price cannot be negative";
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const submit = () => {
    if (!validate()) return;
    saveMutation.mutate({
      Id: editing?.Id ?? 0,
      Name: form.Name.trim(),
      Code: form.Code.trim() || null,
      CategoryId: form.CategoryId ? Number(form.CategoryId) : null,
      UnitPrice: form.UnitPrice === "" ? null : Number(form.UnitPrice),
      MarginPct: form.MarginPct === "" ? null : Number(form.MarginPct),
      IsActive: Boolean(form.IsActive),
    });
  };

  return (
    <Box sx={{ display: "flex", flexDirection: "column", flexGrow: 1 }}>
      <PageHeader
        title="Products"
        subtitle="What you sell, at what price, and the margin reports count as profit."
        actions={
          <Button
            variant="primary"
            size="sm"
            leftIcon={<Plus size={14} />}
            onClick={() => {
              setEditing(null);
              setForm(EMPTY);
              setErrors({});
              setOpen(true);
            }}
            data-testid="new-product-btn"
          >
            New Product
          </Button>
        }
      />
      <Helmet>
        <title>PRD Infotech | Products</title>
      </Helmet>
      <Box sx={{ mt: 1.5, width: "100%", overflowX: "auto" }}>
        <MaterialReactTable table={table} />
      </Box>

      <FormModal
        open={open}
        title={`${editing ? "Edit" : "Create"} Product`}
        maxWidth="max-w-2xl"
        onClose={() => setOpen(false)}
      >
        <div className="p-6">
          <FormContainer spacing="space-y-4">
            <FormRow columns={2}>
              <FormInput
                label="Name"
                value={form.Name}
                onChange={set("Name")}
                error={errors.Name}
                required
              />
              <FormInput
                label="Code"
                value={form.Code}
                onChange={set("Code")}
                placeholder="SKU / short code"
              />
            </FormRow>
            <FormRow columns={1}>
              <FormSelect
                label="Category"
                value={form.CategoryId}
                onChange={set("CategoryId")}
                options={categoryOptions}
                placeholder="Select a category"
              />
            </FormRow>
            <FormRow columns={2}>
              <FormNumberInput
                label="Unit price"
                value={form.UnitPrice}
                onChange={set("UnitPrice")}
                error={errors.UnitPrice}
              />
              <FormNumberInput
                label="Margin %"
                value={form.MarginPct}
                onChange={set("MarginPct")}
                error={errors.MarginPct}
                placeholder="Profit % reports use"
              />
            </FormRow>
            <FormRow columns={1}>
              <FormCheckbox label="Active" checked={form.IsActive} onChange={set("IsActive")} />
            </FormRow>
          </FormContainer>
        </div>
        <FormButtons
          onCancel={() => setOpen(false)}
          onSubmit={submit}
          submitText={`${editing ? "Update" : "Create"} Product`}
          isLoading={saveMutation.isPending}
        />
      </FormModal>

      <ConfirmationDialog
        open={confirmation.isOpen}
        onClose={confirmation.hideConfirmation}
        onConfirm={confirmation.handleConfirm}
        title={confirmation.confirmationState.title}
        message={confirmation.confirmationState.message}
        confirmText={confirmation.confirmationState.confirmText}
        cancelText={confirmation.confirmationState.cancelText}
        type={confirmation.confirmationState.type}
        icon={confirmation.confirmationState.icon}
        isLoading={confirmation.isLoading}
        maxWidth={confirmation.confirmationState.maxWidth}
      />
    </Box>
  );
}
