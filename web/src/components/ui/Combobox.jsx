import { forwardRef, useId } from "react";
import { useTheme } from "@mui/material/styles";
import Autocomplete from "@mui/material/Autocomplete";
import TextFieldMui from "@mui/material/TextField";
import Chip from "@mui/material/Chip";
import { ChevronDown } from "lucide-react";

import { zIndex as zIndexTokens } from "../../styles/tokens";

const HEIGHT = { sm: 32, md: 40, lg: 48 };

/**
 * Searchable Combobox. Thin wrapper over MUI Autocomplete using our
 * theme tokens. External label + hint rendered above the input so layout
 * matches TextInput/TextArea exactly.
 *
 * options: array of { value, label, icon?, group? } OR primitives.
 */

const Combobox = forwardRef(function Combobox(
  {
    value,
    onChange,
    options = [],
    label,
    placeholder,
    hint,
    error,
    required = false,
    disabled = false,
    loading = false,
    multiple = false,
    creatable = false,
    size = "md",
    fullWidth = true,
    getOptionLabel = (o) => (typeof o === "string" ? o : (o?.label ?? "")),
    isOptionEqualToValue = (o, v) => {
      if (o == null || v == null) return o === v;
      if (typeof o === "string") return o === v;
      return o.value === v?.value;
    },
    renderOption,
    groupBy,
    noOptionsText = "Nothing found",
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
  const inputFontSize = size === "sm" ? 13 : size === "lg" ? 15 : 14;

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
      <Autocomplete
        id={id}
        ref={ref}
        value={value}
        onChange={(_, v) => onChange?.(v)}
        options={options}
        multiple={multiple}
        freeSolo={creatable}
        disabled={disabled}
        loading={loading}
        fullWidth={fullWidth}
        size="small"
        getOptionLabel={getOptionLabel}
        isOptionEqualToValue={isOptionEqualToValue}
        renderOption={renderOption}
        groupBy={groupBy}
        noOptionsText={noOptionsText}
        popupIcon={<ChevronDown size={16} />}
        data-testid={testId}
        renderValue={
          multiple
            ? (selected, getItemProps) =>
                selected.map((opt, index) => (
                  <Chip
                    {...getItemProps({ index })}
                    key={typeof opt === "string" ? opt : opt?.value ?? index}
                    label={getOptionLabel(opt)}
                    size="small"
                    sx={{
                      borderRadius: theme.radii.full,
                      backgroundColor: p.primary.subtle,
                      color: p.primary.main,
                      fontWeight: 600,
                    }}
                  />
                ))
            : undefined
        }
        renderInput={(params) => (
          <TextFieldMui
            {...params}
            name={name}
            placeholder={placeholder}
            aria-invalid={hasError || undefined}
            aria-describedby={helperId}
            slotProps={{
              ...params.slotProps,
              htmlInput: {
                ...params.slotProps?.htmlInput,
                "data-testid": testId ? `${testId}-input` : undefined,
              },
              input: {
                ...params.slotProps?.input,
                sx: {
                  borderRadius: `${theme.radii.md}px`,
                  backgroundColor: p.surface.card,
                  // Fixed height (not just minHeight) so a single-value
                  // Autocomplete matches TextInput/DateField exactly instead of
                  // growing taller from the inputRoot's default vertical padding.
                  minHeight: inputHeight,
                  height: inputHeight,
                  paddingTop: 0,
                  paddingBottom: 0,
                  alignItems: "center",
                  flexWrap: "nowrap",
                  "& .MuiAutocomplete-input": {
                    paddingTop: "0 !important",
                    paddingBottom: "0 !important",
                    height: inputHeight - 2,
                    boxSizing: "border-box",
                    fontSize: multiple ? 14 : inputFontSize,
                    fontWeight: 500,
                  },
                  "& fieldset": { borderColor: p.border.default },
                  "&:hover fieldset": { borderColor: p.border.strong },
                  "&.Mui-focused fieldset": {
                    borderColor: hasError ? p.error.main : p.border.focus,
                    borderWidth: 1.5,
                  },
                  transition: "box-shadow 240ms cubic-bezier(0.4,0,0.2,1)",
                  "&.Mui-focused": {
                    boxShadow: hasError
                      ? `0 0 0 3px ${p.error.subtle}`
                      : `0 0 0 3px ${p.primary.subtle}`,
                  },
                },
              },
            }}
          />
        )}
        slotProps={{
          popper: {
            sx: { zIndex: zIndexTokens.popover },
          },
          paper: {
            sx: {
              borderRadius: `${theme.radii.md}px`,
              border: `1px solid ${p.border.default}`,
              boxShadow: p.shadow.lg,
              marginTop: "6px",
              backgroundColor: p.surface.card,
              color: p.text.primary,
            },
          },
        }}
        {...rest}
      />
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

export default Combobox;
