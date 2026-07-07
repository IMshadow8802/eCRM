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
              sx: {
                "& .MuiOutlinedInput-root": {
                  borderRadius: `${theme.radii.md}px`,
                  backgroundColor: p.surface.card,
                  minHeight: inputHeight,
                  height: inputHeight,
                },
                "& .MuiOutlinedInput-input": {
                  paddingY: 0,
                  height: inputHeight - 2,
                  boxSizing: "border-box",
                  fontSize: 14,
                  fontWeight: 500,
                },
                "& fieldset": { borderColor: p.border.default },
                "&:hover fieldset": { borderColor: p.border.strong },
                "&.Mui-focused fieldset": {
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
