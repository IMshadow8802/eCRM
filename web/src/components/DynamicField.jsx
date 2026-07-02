import { useTheme } from "@mui/material/styles";

import TextInput from "./ui/TextInput";
import NumberInput from "./ui/NumberInput";
import DateField from "./ui/DateField";
import Combobox from "./ui/Combobox";
import Switch from "./ui/Switch";

// Custom-field `Options` comes back from the DB as either a JSON string
// (`'["Web","Referral"]'` or `'[{"value":"a","label":"Apple"}]'`) or an
// already-parsed array. Normalize both to [{value,label}] and swallow bad
// JSON rather than crashing the field.
const parseOptions = (options) => {
  if (!options) return [];
  let raw = options;
  if (typeof options === "string") {
    try {
      raw = JSON.parse(options);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(raw)) return [];
  return raw.map((opt) =>
    typeof opt === "string" ? { value: opt, label: opt } : opt,
  );
};

/**
 * Renders one custom-field input from its definition
 * `{Id, Label, Type, Options, IsRequired}`, controlled via value/onChange.
 * onChange always receives the field's raw value (string/number/boolean),
 * never the underlying ui component's event/option object.
 */
const DynamicField = ({ field, value, onChange }) => {
  const theme = useTheme();
  const { Label, Type, Options, IsRequired } = field || {};

  switch (Type) {
    case "number":
      return (
        <NumberInput
          label={Label}
          required={IsRequired}
          value={value ?? ""}
          onChange={(e) => onChange?.(e.target.value)}
        />
      );

    case "date":
      return (
        <DateField
          label={Label}
          required={IsRequired}
          value={value ?? ""}
          onChange={(next) => onChange?.(next)}
        />
      );

    case "dropdown": {
      const options = parseOptions(Options);
      const selected = options.find((o) => o.value === value) ?? null;
      return (
        <Combobox
          label={Label}
          required={IsRequired}
          options={options}
          value={selected}
          onChange={(opt) => onChange?.(opt?.value ?? null)}
        />
      );
    }

    case "checkbox":
      // Switch has no built-in required marker (unlike the text-style
      // inputs), so render one alongside its label here.
      return (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {Label && (
            <span
              style={{
                fontSize: 13,
                fontWeight: 500,
                color: theme.tokens.text.secondary,
              }}
            >
              {Label}
              {IsRequired && (
                <span style={{ color: theme.tokens.error.main, marginLeft: 4 }}>
                  *
                </span>
              )}
            </span>
          )}
          <Switch
            checked={Boolean(value)}
            onChange={(e) => onChange?.(e.target.checked)}
          />
        </div>
      );

    case "text":
    default:
      return (
        <TextInput
          label={Label}
          required={IsRequired}
          value={value ?? ""}
          onChange={(e) => onChange?.(e.target.value)}
        />
      );
  }
};

export default DynamicField;
