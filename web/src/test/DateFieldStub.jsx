// Test-only stand-in for ui/DateField. MUI X 9's accessible field renders
// contenteditable sections that jsdom cannot type into; tests that need to
// enter a date mock the real component with this native input. Same props
// contract: value 'YYYY-MM-DD', onChange('YYYY-MM-DD').
export default function DateFieldStub({ value = "", onChange, label, required, error, hint, "data-testid": testId, disabled }) {
  return (
    <label style={{ display: "flex", flexDirection: "column" }}>
      {label}{required ? " *" : ""}
      <input type="date" value={value} disabled={disabled} data-testid={testId} onChange={(e) => onChange?.(e.target.value)} />
      {(error || hint) && <span>{error || hint}</span>}
    </label>
  );
}
