import { forwardRef, useId } from "react";
import { DatePicker } from "@mui/x-date-pickers/DatePicker";
import { LocalizationProvider } from "@mui/x-date-pickers/LocalizationProvider";
import { AdapterDayjs } from "@mui/x-date-pickers/AdapterDayjs";
import { useTheme } from "@mui/material/styles";
import dayjs from "dayjs";
import { Calendar } from "lucide-react";

import { zIndex as zIndexTokens } from "../../styles/tokens";

const HEIGHT = { sm: 32, md: 40, lg: 48 };

// MUI injects `ownerState` into slot components; lucide icons forward unknown
// props onto the <svg>, which React warns about. Swallow it here.
const CalendarIcon = ({ ownerState, ...props }) => <Calendar size={16} {...props} />;

/**
 * Themed date field. Value is ISO string (YYYY-MM-DD). External label
 * rendered above the input so layout matches TextInput/Combobox.
 */
const DateField = forwardRef(function DateField(
  {
    value,
    onChange,
    label,
    hint,
    error,
    required = false,
    disabled = false,
    minDate,
    maxDate,
    fullWidth = true,
    size = "md",
    placeholder = "DD-MM-YYYY",
    id: idProp,
    name,
    "data-testid": testId,
    ...rest
  },
  ref,
) {
  const theme = useTheme();
  const p = theme.tokens;
  const autoId = useId();
  const id = idProp || autoId;
  const hasError = Boolean(error);
  const helperId = hint || error ? `${id}-help` : undefined;
  const inputHeight = HEIGHT[size] ?? HEIGHT.md;
  // Must match Combobox/TextInput exactly. This was a hardcoded 14, so a date
  // sitting in a row of `sm` dropdowns rendered a point larger than every
  // control beside it — same box, different text.
  const inputFontSize = size === "sm" ? 13 : size === "lg" ? 15 : 14;

  const toDayjs = (v) => (v ? dayjs(v) : null);
  const fromDayjs = (d) => (d && d.isValid() ? d.format("YYYY-MM-DD") : "");

  return (
    <div
      style={{
        display: "inline-flex",
        flexDirection: "column",
        width: fullWidth ? "100%" : "auto",
        gap: 6,
        fontFamily: p.fontFamilies.sans,
      }}
    >
      {label && (
        <label
          htmlFor={id}
          style={{
            fontSize: 13,
            fontWeight: 500,
            color: p.text.secondary,
            letterSpacing: "0.01em",
          }}
        >
          {label}
          {required && (
            <span style={{ color: p.error.main, marginLeft: 4 }}>*</span>
          )}
        </label>
      )}

      <LocalizationProvider dateAdapter={AdapterDayjs}>
        <DatePicker
          ref={ref}
          value={toDayjs(value)}
          onChange={(d) => onChange?.(fromDayjs(d))}
          disabled={disabled}
          minDate={toDayjs(minDate)}
          maxDate={toDayjs(maxDate)}
          format="DD-MM-YYYY"
          slots={{ openPickerIcon: CalendarIcon }}
          slotProps={{
            textField: {
              id,
              name,
              fullWidth,
              size: "small",
              placeholder,
              error: hasError,
              "aria-describedby": helperId,
              "data-testid": testId,
              // x-date-pickers v9 does NOT render an OutlinedInput. The field is
              // a `MuiPickersInputBase-root` wrapping contenteditable <span>
              // sections — there is no `.MuiOutlinedInput-root` and no
              // `.MuiOutlinedInput-input` in this tree. Styling those classes,
              // which is what this file did, silently matched nothing: every
              // date field in the app rendered at MUI's default height and type
              // size while sitting next to Combobox and TextInput controls that
              // honour the tokens. Keep these selectors on the Pickers classes.
              sx: {
                // Class doubled deliberately. MUI ships its own font-size on
                // `.MuiPickersInputBase-root` (0.9333rem, from the theme's
                // htmlFontSize of 15), which has identical specificity to a
                // single-class sx rule — so which one wins came down to
                // stylesheet order, and at size="md" theirs did. Doubling the
                // selector settles it instead of hoping.
                "& .MuiPickersInputBase-root.MuiPickersInputBase-root": {
                  borderRadius: `${theme.radii.md}px`,
                  backgroundColor: p.surface.card,
                  minHeight: inputHeight,
                  height: inputHeight,
                  // Set on the root so the section spans inherit it — they carry
                  // the visible text, and each one is its own element.
                  //
                  // !important because MUI puts its own font-size on a sibling
                  // class on this very element (`MuiPickersInputBase-inputSizeSmall`,
                  // 0.9333rem — 14/15 of the browser root, not of ours). Whose
                  // rule lands then depends on stylesheet order, which is not
                  // something a design-system primitive should be gambling on.
                  fontSize: `${inputFontSize}px !important`,
                  fontWeight: 500,
                },
                "& .MuiPickersInputBase-sectionsContainer": {
                  paddingTop: 0,
                  paddingBottom: 0,
                  height: inputHeight - 2,
                  boxSizing: "border-box",
                  display: "flex",
                  alignItems: "center",
                },
                "& fieldset": { borderColor: p.border.default },
                "& .MuiPickersInputBase-root:hover fieldset": { borderColor: p.border.strong },
                "& .MuiPickersInputBase-root.Mui-focused fieldset": {
                  borderColor: hasError ? p.error.main : p.border.focus,
                  borderWidth: 1.5,
                },
              },
            },
            popper: {
              sx: {
                zIndex: zIndexTokens.popover,
                "& .MuiPaper-root": {
                  borderRadius: `${theme.radii.lg}px`,
                  border: `1px solid ${p.border.default}`,
                  boxShadow: p.shadow.xl,
                },
                "& .MuiPickersDay-root.Mui-selected": {
                  backgroundColor: p.primary.main,
                  "&:hover": { backgroundColor: p.primary.hover },
                },
                "& .MuiPickersDay-today": {
                  borderColor: p.accent.main,
                },
              },
            },
          }}
          {...rest}
        />
      </LocalizationProvider>

      {(hint || error) && (
        <span
          id={helperId}
          style={{
            fontSize: 12,
            fontWeight: 500,
            color: hasError ? p.error.main : p.text.tertiary,
            lineHeight: 1.4,
          }}
        >
          {error || hint}
        </span>
      )}
    </div>
  );
});

export default DateField;
