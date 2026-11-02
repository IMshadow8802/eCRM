import { forwardRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { metrics } from "../theme";
import { Button } from "./Button";
import { FieldLabel } from "./Field";
import { Input } from "./Input";
import type { StatusBadgeProps } from "./StatusBadge";
import { FilterPills } from "./Tabs";
import { Sheet, type SheetRef } from "./Sheet";
import { Text } from "./Text";

export interface ComposeField {
  key: string;
  placeholder: string;
  label?: string;
  multiline?: boolean;
  /** Decimal keypad — hours worked, quantities. */
  numeric?: boolean;
  /** Masked, with the show/hide eye (Change password). */
  secure?: boolean;
  /**
   * Submit stays disabled until every required field has content. A function
   * makes it depend on the picked choices ("Other" needs remarks).
   */
  required?: boolean | ((choices: Record<string, string | number>) => boolean);
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
  /** The line under the title ("C-1042 · AC not cooling"). */
  subtitle?: string;
  /** The 40 badge leading the header. */
  badge?: Pick<StatusBadgeProps, "tone" | "icon">;
  submitLabel: string;
  fields: ComposeField[];
  choices?: ComposeChoice[];
  busy?: boolean;
  /**
   * Why the last submit failed. Shown above the button, and the reason the
   * sheet does not clear itself on submit — see `submit` below.
   */
  error?: string | null;
  /**
   * Prefill — editing an existing comment. Pass a NEW object each time the
   * sheet should be reseeded; the same object is ignored, so a re-render does
   * not wipe what the user has typed since.
   */
  initialValues?: Record<string, string>;
  onSubmit: (
    values: Record<string, string>,
    choices: Record<string, string | number>,
  ) => void;
  /** After the sheet closes and has reset its fields. */
  onDismiss?: () => void;
}

/**
 * A bottom sheet holding a short form — "add a checklist item", "write a
 * comment", "log 2.5 hours". One to three fields; anything longer belongs on a
 * screen, where the keyboard does not eat half the form.
 *
 * Its fields are the design system's Input, which turns into @gorhom's
 * BottomSheetTextInput inside a Sheet (sheetContext): a plain RN TextInput in
 * a bottom sheet loses focus and sits under the keyboard.
 */
export const ComposeSheet = forwardRef<SheetRef, ComposeSheetProps>(
  function ComposeSheet(
    { title, subtitle, badge, submitLabel, fields, choices = [], busy = false, error, initialValues, onSubmit, onDismiss },
    ref,
  ) {
    const [values, setValues] = useState<Record<string, string>>(initialValues ?? {});
    // Reseed during render when the caller hands over a new prefill (React's
    // "adjusting state when a prop changes" pattern — no effect, no flash).
    const [seed, setSeed] = useState(initialValues);
    if (seed !== initialValues) {
      setSeed(initialValues);
      setValues(initialValues ?? {});
    }
    const [picked, setPicked] = useState<Record<string, string | number>>({});

    const set = (key: string, value: string) =>
      setValues((prev) => ({ ...prev, [key]: value }));

    const reset = () => {
      setValues(initialValues ?? {});
      setPicked({});
    };

    const isRequired = (f: (typeof fields)[number]) =>
      typeof f.required === "function" ? f.required(picked) : !!f.required;

    const complete =
      fields.every((f) => !isRequired(f) || (values[f.key] ?? "").trim()) &&
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
      // A password is sent as typed: its spaces are part of it.
      for (const field of fields) trimmed[field.key] = field.secure ? (values[field.key] ?? "") : (values[field.key] ?? "").trim();
      onSubmit(trimmed, picked);
    };

    return (
      <Sheet
        ref={ref}
        title={title}
        subtitle={subtitle}
        badge={badge}
        keyboardAware
        padded
        onDismiss={() => {
          reset();
          onDismiss?.();
        }}
      >
        <View style={styles.body}>
          {/* Choices first: they are the shape of the record, and picking one
              should not mean scrolling back past a keyboard-covered field. */}
          {choices.map((choice) => (
            <View key={choice.key}>
              {choice.label ? <FieldLabel label={choice.label} required={choice.required} /> : null}
              <FilterPills
                tone="inSheet"
                wrap
                label={choice.label}
                value={picked[choice.key] ?? null}
                options={choice.options}
                onChange={(value) =>
                  setPicked((prev) => ({ ...prev, [choice.key]: value }))
                }
              />
            </View>
          ))}

          {fields.map((field, i) => (
            <View key={field.key}>
              <Input
                testID={`compose-${field.key}`}
                label={field.label}
                required={isRequired(field)}
                accessibilityLabel={field.label ?? field.placeholder}
                value={values[field.key] ?? ""}
                onChangeText={(text) => set(field.key, text)}
                placeholder={field.placeholder}
                password={field.secure}
                autoCapitalize={field.secure ? "none" : undefined}
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

          {error ? <Text variant="label" color="dangerText">{error}</Text> : null}

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
  body: { gap: metrics.fieldGap + 2 },
});

export default ComposeSheet;
