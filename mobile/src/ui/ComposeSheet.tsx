import { forwardRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { BottomSheetTextInput } from "@gorhom/bottom-sheet";

import { colors, radius, spacing, typography } from "../theme";
import { Button } from "./Button";
import { Sheet, type SheetRef } from "./Sheet";
import { Text } from "./Text";

export interface ComposeField {
  key: string;
  placeholder: string;
  label?: string;
  multiline?: boolean;
  /** Decimal keypad — hours worked, quantities. */
  numeric?: boolean;
  /** Submit stays disabled until every required field has content. */
  required?: boolean;
}

export interface ComposeSheetProps {
  title: string;
  submitLabel: string;
  fields: ComposeField[];
  busy?: boolean;
  onSubmit: (values: Record<string, string>) => void;
}

/**
 * A bottom sheet holding a short form — "add a checklist item", "write a
 * comment", "log 2.5 hours". One to three fields; anything longer belongs on a
 * screen, where the keyboard does not eat half the form.
 *
 * Uses @gorhom's BottomSheetTextInput rather than the design system's Input:
 * a plain RN TextInput inside a bottom sheet loses focus and sits under the
 * keyboard, because the sheet needs to know about the input to pan with it.
 * This file is inside src/ui, which is where raw inputs are allowed to live.
 */
export const ComposeSheet = forwardRef<SheetRef, ComposeSheetProps>(
  function ComposeSheet({ title, submitLabel, fields, busy = false, onSubmit }, ref) {
    const [values, setValues] = useState<Record<string, string>>({});

    const set = (key: string, value: string) =>
      setValues((prev) => ({ ...prev, [key]: value }));

    const complete = fields.every(
      (f) => !f.required || (values[f.key] ?? "").trim(),
    );

    const submit = () => {
      if (!complete) return;
      const trimmed: Record<string, string> = {};
      for (const field of fields) trimmed[field.key] = (values[field.key] ?? "").trim();
      onSubmit(trimmed);
      setValues({});
    };

    return (
      <Sheet
        ref={ref}
        title={title}
        keyboardAware
        onDismiss={() => setValues({})}
      >
        <View style={styles.body}>
          {fields.map((field, i) => (
            <View key={field.key} style={styles.field}>
              {field.label ? <Text variant="label">{field.label}</Text> : null}
              <BottomSheetTextInput
                value={values[field.key] ?? ""}
                onChangeText={(text) => set(field.key, text)}
                placeholder={field.placeholder}
                placeholderTextColor={colors.textMuted}
                style={[styles.input, field.multiline && styles.inputMultiline]}
                multiline={field.multiline}
                keyboardType={field.numeric ? "decimal-pad" : "default"}
                // Only the first field grabs focus — autofocusing a later one
                // scrolls the sheet past the fields above it.
                autoFocus={i === 0}
                returnKeyType={field.multiline ? undefined : "done"}
                onSubmitEditing={
                  field.multiline || fields.length > 1 ? undefined : submit
                }
              />
            </View>
          ))}

          <Button
            title={submitLabel}
            onPress={submit}
            loading={busy}
            disabled={!complete}
            fullWidth
          />
        </View>
      </Sheet>
    );
  },
);

const styles = StyleSheet.create({
  body: { paddingHorizontal: spacing[4], gap: spacing[3] },
  field: { gap: spacing[2] },
  input: {
    ...typography.body,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.md,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[3],
    backgroundColor: colors.surface,
    // Same reasoning as Input: a single-line TextInput does not centre its
    // glyphs inside a lineHeight box, and Android reserves accent room it does
    // not need. Both push the text off centre against the padding around it.
    lineHeight: undefined,
    includeFontPadding: false,
    textAlignVertical: "center",
  },
  inputMultiline: {
    minHeight: 110,
    lineHeight: typography.body.lineHeight,
    textAlignVertical: "top",
  },
});

export default ComposeSheet;
