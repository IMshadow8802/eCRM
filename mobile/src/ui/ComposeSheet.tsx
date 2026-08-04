import { forwardRef, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { BottomSheetTextInput } from "@gorhom/bottom-sheet";

import { colors, radius, shadows, spacing, typography } from "../theme";
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

/**
 * A one-of-N pick, rendered as a chip row above the fields.
 *
 * Chips rather than a `Select`, because Select opens a sheet of its own and
 * stacking two bottom sheets is fragile. Keep the option count small — past
 * about six the row wraps into a wall and belongs on a screen instead.
 */
export interface ComposeChoice {
  key: string;
  label?: string;
  options: { value: string | number; label: string }[];
  required?: boolean;
}

export interface ComposeSheetProps {
  title: string;
  submitLabel: string;
  fields: ComposeField[];
  choices?: ComposeChoice[];
  busy?: boolean;
  onSubmit: (
    values: Record<string, string>,
    choices: Record<string, string | number>,
  ) => void;
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
  function ComposeSheet(
    { title, submitLabel, fields, choices = [], busy = false, onSubmit },
    ref,
  ) {
    const [values, setValues] = useState<Record<string, string>>({});
    const [picked, setPicked] = useState<Record<string, string | number>>({});

    const set = (key: string, value: string) =>
      setValues((prev) => ({ ...prev, [key]: value }));

    const reset = () => {
      setValues({});
      setPicked({});
    };

    const complete =
      fields.every((f) => !f.required || (values[f.key] ?? "").trim()) &&
      choices.every((c) => !c.required || picked[c.key] != null);

    const submit = () => {
      if (!complete) return;
      const trimmed: Record<string, string> = {};
      for (const field of fields) trimmed[field.key] = (values[field.key] ?? "").trim();
      onSubmit(trimmed, picked);
      reset();
    };

    return (
      <Sheet
        ref={ref}
        title={title}
        keyboardAware
        onDismiss={reset}
      >
        <View style={styles.body}>
          {/* Choices first: they are the shape of the record, and picking one
              should not mean scrolling back past a keyboard-covered field. */}
          {choices.map((choice) => (
            <View key={choice.key} style={styles.field}>
              {choice.label ? (
                <Text variant="label">
                  {choice.label}
                  {choice.required ? (
                    <Text variant="label" color="danger">
                      {" *"}
                    </Text>
                  ) : null}
                </Text>
              ) : null}
              <View style={styles.chips}>
                {choice.options.map((option) => {
                  const active = picked[choice.key] === option.value;
                  return (
                    <Pressable
                      key={String(option.value)}
                      onPress={() =>
                        setPicked((prev) => ({ ...prev, [choice.key]: option.value }))
                      }
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                      style={({ pressed }) => [
                        styles.chip,
                        active ? styles.chipActive : styles.chipIdle,
                        pressed && !active && styles.chipPressed,
                      ]}
                    >
                      <Text
                        variant="label"
                        color={active ? "textOnBrand" : "textSecondary"}
                      >
                        {option.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ))}

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
                // Only the first field, and only when nothing above it needs a
                // decision first — a keyboard covering an unanswered chip row
                // is how a required choice gets missed.
                autoFocus={i === 0 && !choices.length}
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
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing[2] },
  chip: {
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2],
    borderRadius: radius.full,
    borderWidth: 1,
  },
  chipIdle: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    ...shadows.sm,
  },
  chipPressed: { backgroundColor: colors.surfacePressed },
  chipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
    ...shadows.md,
  },
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
