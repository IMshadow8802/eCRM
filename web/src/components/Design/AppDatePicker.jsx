import { DatePicker } from "@mui/x-date-pickers";
import dayjs from "dayjs";

/**
 * Brand-themed date picker built on @mui/x-date-pickers.
 * Uses the app's primary (#3f4faf) and accent (#f9629f) palette for
 * selected day, today ring, hover, and header strip.
 *
 * Value/onChange use ISO date strings (YYYY-MM-DD) so the component is
 * drop-in compatible with the existing FormDateInput contract.
 */
const AppDatePicker = ({
  label,
  value,
  onChange,
  onBlur,
  error,
  required = false,
  disabled = false,
  helperText,
  minDate,
  maxDate,
  size = "small",
  className = "",
  ...props
}) => {
  const dayjsValue = value ? dayjs(value) : null;

  const handleChange = (newValue) => {
    const iso = newValue && dayjs(newValue).isValid() ? dayjs(newValue).format("YYYY-MM-DD") : "";
    if (typeof onChange === "function") {
      onChange({ target: { value: iso } });
    }
  };

  return (
    <DatePicker
      label={label}
      value={dayjsValue}
      onChange={handleChange}
      disabled={disabled}
      minDate={minDate ? dayjs(minDate) : undefined}
      maxDate={maxDate ? dayjs(maxDate) : undefined}
      format="DD-MM-YYYY"
      slotProps={{
        textField: {
          fullWidth: true,
          required,
          size,
          error: !!error,
          helperText: error || helperText,
          onBlur,
          className,
          variant: "outlined",
          InputLabelProps: { shrink: true },
          sx: {
            "& .MuiOutlinedInput-root": {
              borderRadius: "8px",
              backgroundColor: disabled ? "#f5f5f5" : "white",
              fontWeight: 500,
              "& fieldset": { borderColor: error ? "#ef4444" : "#d1d5db" },
              "&:hover fieldset": { borderColor: error ? "#ef4444" : "#3f4faf" },
              "&.Mui-focused fieldset": { borderColor: error ? "#ef4444" : "#3f4faf" },
            },
            "& .MuiInputLabel-root": {
              fontSize: "0.9333rem",
              fontWeight: 500,
              "&.Mui-required::after": { color: "#ef4444" },
            },
          },
        },
        desktopPaper: {
          sx: {
            borderRadius: 2,
            border: "1px solid",
            borderColor: "divider",
            boxShadow: 4,
            fontFamily: "Poppins, sans-serif",
            "& .MuiPickersCalendarHeader-root": {
              backgroundColor: "primary.50",
              borderRadius: "8px 8px 0 0",
              mt: 0,
              pt: 1,
            },
            "& .MuiPickersCalendarHeader-label": {
              fontWeight: 600,
              color: "primary.dark",
            },
            "& .MuiPickersArrowSwitcher-root .MuiIconButton-root": {
              color: "primary.main",
            },
            "& .MuiDayCalendar-weekDayLabel": {
              fontWeight: 600,
              color: "text.secondary",
              fontSize: "0.75rem",
            },
            "& .MuiPickersDay-root": {
              fontWeight: 500,
              fontSize: "0.8667rem",
              "&:hover": { backgroundColor: "primary.50" },
              "&.Mui-selected": {
                backgroundColor: "primary.main",
                color: "common.white",
                fontWeight: 600,
                "&:hover": { backgroundColor: "primary.dark" },
                "&:focus": { backgroundColor: "primary.main" },
              },
              "&.MuiPickersDay-today": {
                borderColor: "secondary.main",
                borderWidth: 1.5,
              },
            },
          },
        },
        mobilePaper: {
          sx: {
            borderRadius: 2,
          },
        },
      }}
      {...props}
    />
  );
};

export default AppDatePicker;
