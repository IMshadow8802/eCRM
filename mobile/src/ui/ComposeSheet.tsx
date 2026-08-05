import { forwardRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { BottomSheetTextInput } from "@gorhom/bottom-sheet";

import { colors, radius, spacing, typography } from "../theme";
import { Button } from "./Button";
import { ChipGroup } from "./ChipGroup";
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
  /**
   * Why the last submit failed. Shown above the button, and the reason the
   * sheet does not clear itself on submit — see `submit` below.
   */
  error?: string | null;
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
    { title, submitLabel, fields, choices = [], busy = false, error, onSubmit },
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

    /**
     * Deliberately does NOT clear the fields.
     *
     * It used to reset synchronously, right after handing the values over — so
     * a comment, a checklist item or a time entry was wiped from the sheet the
     * instant it was submitted, before the request had been anywhere. When the
     * save then failed the text was already gone, with nothing to retry and no
     * way to get it back.
     *
     * Every caller dismisses the sheet in its mutation's `onSuccess`, and
     * `onDismiss` resets. So a success still leaves an empty sheet for next
     * time, while a failure keeps what was typed and shows `error` next to it.
     */
    const submit = () => {
      if (!complete) return;
      const trimmed: Record<string, string> = {};
      for (const field of fields) trimmed[field.key] = (values[field.key] ?? "").trim();
      onSubmit(trimmed, picked);
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
              <ChipGroup
                value={picked[choice.key] ?? null}
                options={choice.options}
                onChange={(value) =>
                  setPicked((prev) => ({ ...prev, [choice.key]: value }))
                }
              />
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

          {error ? (
            <Text variant="caption" color="danger">
              {error}
            </Text>
          ) : null}

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
  chipPressed: { backgroundColor: colors.surfacePressed },
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
