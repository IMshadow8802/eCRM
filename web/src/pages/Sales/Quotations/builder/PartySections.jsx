import { Box } from "@mui/material";
import { Combobox, FormGrid, FormGridSpan, MobileInput, TextArea, TextInput } from "../../../../components/ui";
import { STATE_OPTIONS, isValidGstin, stateFromGstin } from "../gst";

const byValue = (v) => STATE_OPTIONS.find((o) => o.value === v) ?? null;

/** The seller's block. With a valid GSTIN the state is read off it and the picker locks — it is not a second thing to get wrong. */
export function CompanySection({ value, disabled = false, onChange }) {
  const set = (k) => (e) => onChange({ ...value, [k]: e.target.value });
  const derived = stateFromGstin(value.gstin);
  const gstinError = value.gstin && !isValidGstin(value.gstin) ? "15 characters, e.g. 24ABCDE1234F1Z5" : undefined;
  return (
    <FormGrid min={200} data-testid="company-section">
      <TextInput label="Company name" required value={value.name} onChange={set("name")} disabled={disabled} />
      <TextInput label="GSTIN" value={value.gstin} onChange={set("gstin")} disabled={disabled} error={gstinError}
        hint={value.gstin ? undefined : "Leave empty if you are not GST-registered — no tax will be charged"} />
      <Combobox label="State" options={STATE_OPTIONS} value={byValue(derived ?? value.stateCode)} disabled={disabled || Boolean(derived)}
        onChange={(o) => onChange({ ...value, stateCode: o?.value ?? "" })} data-testid="company-state" />
      <TextInput label="Phone" value={value.phone} onChange={set("phone")} disabled={disabled} />
      <TextInput label="Email" value={value.email} onChange={set("email")} disabled={disabled} inputMode="email" />
      <TextInput label="Website" value={value.website} onChange={set("website")} disabled={disabled} />
      <FormGridSpan><TextInput label="Address" value={value.address} onChange={set("address")} disabled={disabled} /></FormGridSpan>
      <TextInput label="City" value={value.city} onChange={set("city")} disabled={disabled} />
      <TextInput label="Pincode" value={value.pincode} onChange={set("pincode")} disabled={disabled} inputMode="numeric" />
      <TextInput label="Signatory" value={value.signatory} onChange={set("signatory")} disabled={disabled} placeholder="Who signs" />
      <FormGridSpan><TextArea label="Bank details" rows={2} value={value.bank} onChange={set("bank")} disabled={disabled} /></FormGridSpan>
    </FormGrid>
  );
}

/** Who the quotation is for. Place of supply decides CGST+SGST vs IGST. */
export function CustomerSection({ value, taxed, disabled = false, onChange }) {
  const set = (k) => (e) => onChange({ ...value, [k]: e.target.value });
  const gstinError = value.ToGSTIN && !isValidGstin(value.ToGSTIN) ? "15 characters, e.g. 27AAAAA0000A1Z5" : undefined;
  return (
    <FormGrid min={200} data-testid="customer-section">
      <TextInput label="Customer name" required value={value.ToName} onChange={set("ToName")} disabled={disabled} />
      <TextInput label="Company" value={value.ToCompany} onChange={set("ToCompany")} disabled={disabled} />
      <MobileInput label="Mobile" value={value.ToMobile} onChange={(v) => onChange({ ...value, ToMobile: v })} disabled={disabled} />
      <TextInput label="Email" value={value.ToEmail} onChange={set("ToEmail")} disabled={disabled} inputMode="email" />
      <FormGridSpan><TextInput label="Address" value={value.ToAddress} onChange={set("ToAddress")} disabled={disabled} /></FormGridSpan>
      <TextInput label="City" value={value.ToCity} onChange={set("ToCity")} disabled={disabled} />
      <TextInput label="Pincode" value={value.ToPincode} onChange={set("ToPincode")} disabled={disabled} inputMode="numeric" />
      <Box>
        <Combobox label="Place of supply" required={taxed} options={STATE_OPTIONS} value={byValue(value.ToStateCode)} disabled={disabled}
          hint={taxed ? "Same state as yours → CGST + SGST. Another state → IGST." : undefined}
          onChange={(o) => onChange({ ...value, ToStateCode: o?.value ?? "" })} data-testid="place-of-supply" />
      </Box>
      <TextInput label="Customer GSTIN" value={value.ToGSTIN} onChange={set("ToGSTIN")} disabled={disabled} error={gstinError} />
    </FormGrid>
  );
}
