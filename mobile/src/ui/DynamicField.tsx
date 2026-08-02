import { Pressable, StyleSheet, View } from "react-native";
import { Check } from "lucide-react-native";

import type { CustomFieldDef } from "../types/api";
import { colors, radius, spacing, CONTROL_HEIGHT } from "../theme";
import { DateField } from "./DateField";
import { Input } from "./Input";
import { Select } from "./Select";
import { Text } from "./Text";

export interface DynamicFieldProps {
  field: CustomFieldDef;
  value: string | boolean;
  onChange: (value: string | boolean) => void;
  error?: string | null;
}

/**
 * `Options` on a dropdown definition comes back as a JSON string — either
 * `["Web","Referral"]` or `[{"value":"a","label":"Apple"}]`, both of which
 * exist in live data. Normalise both, and swallow bad JSON rather than
 * crashing the whole form over one malformed definition.
 */
function parseOptions(options: string | null): { value: string; label: string }[] {
  if (!options) return [];
  let raw: unknown = options;
  try {
    raw = JSON.parse(options);
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  return raw.map((option) =>
    typeof option === "string"
      ? { value: option, label: option }
      : (option as { value: string; label: string }),
  );
}

/**
 * One input, rendered from a `tblCustomFieldDef` row.
 *
 * The config engine lets each company define its own fields on leads and
 * tickets, so neither module can hardcode its form. This is the mobile twin of
 * web/src/components/DynamicField.jsx — same five types, same Options parsing,
 * so a field configured once renders the same on both clients.
 *
 * `onChange` always receives the raw value, never a component's event or
 * option object, so callers can serialise a draft without unwrapping anything.
 */
export function DynamicField({ field, value, onChange, error }: DynamicFieldProps) {
  const { Label, Type, Options, IsRequired } = field;

  if (Type === "dropdown") {
    return (
      <Select
        label={Label}
        required={IsRequired}
        error={error}
        value={typeof value === "string" && value ? value : null}
        options={parseOptions(Options)}
        onChange={(next) => onChange(next as string)}
      />
    );
  }

  if (Type === "date") {
    return (
      <DateField
        label={Label}
        required={IsRequired}
        error={error}
        value={typeof value === "string" && value ? value : null}
        onChange={(next) => onChange(next ?? "")}
      />
    );
  }

  if (Type === "checkbox") {
    const checked = value === true;
    return (
      <View style={styles.checkboxWrap}>
        <Pressable
          onPress={() => onChange(!checked)}
          accessibilityRole="checkbox"
          accessibilityState={{ checked }}
          style={({ pressed }) => [
            styles.checkboxRow,
            pressed && styles.checkboxPressed,
          ]}
        >
          <View style={[styles.box, checked && styles.boxChecked]}>
            {checked ? <Check size={16} color={colors.textOnBrand} /> : null}
          </View>
          <Text variant="body" style={styles.checkboxLabel}>
            {Label}
            {IsRequired ? (
              <Text variant="body" color="danger">
                {" *"}
              </Text>
            ) : null}
          </Text>
        </Pressable>
        {error ? (
          <Text variant="caption" color="danger">
            {error}
          </Text>
        ) : null}
      </View>
    );
  }

  return (
    <Input
      label={Label}
      required={IsRequired}
      error={error}
      value={typeof value === "string" ? value : ""}
      onChangeText={onChange}
      keyboardType={Type === "number" ? "decimal-pad" : "default"}
    />
  );
}

const styles = StyleSheet.create({
  checkboxWrap: { gap: spacing[2] },
  checkboxRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    minHeight: CONTROL_HEIGHT,
    paddingHorizontal: spacing[3],
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  checkboxPressed: { backgroundColor: colors.surfacePressed },
  box: {
    width: 24,
    height: 24,
    borderRadius: radius.sm,
    borderWidth: 2,
    borderColor: colors.borderStrong,
    alignItems: "center",
    justifyContent: "center",
  },
  boxChecked: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  checkboxLabel: { flex: 1 },
});

export default DynamicField;
