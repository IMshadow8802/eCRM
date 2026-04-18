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
        renderTags={(selected, getTagProps) =>
          selected.map((opt, index) => (
            <Chip
              {...getTagProps({ index })}
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
        }
        renderInput={(params) => (
          <TextFieldMui
            {...params}
            name={name}
            placeholder={placeholder}
            aria-invalid={hasError || undefined}
            aria-describedby={helperId}
            InputProps={{
              ...params.InputProps,
              inputProps: {
                ...params.inputProps,
                "data-testid": testId ? `${testId}-input` : undefined,
              },
              sx: {
                borderRadius: `${theme.radii.md}px`,
                backgroundColor: p.surface.card,
                minHeight: inputHeight,
                paddingY: 0,
                "& .MuiAutocomplete-input": {
                  paddingY: "0 !important",
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
                transition: "box-shadow 240ms cubic-bezier(0.4,0,0.2,1)",
                "&.Mui-focused": {
                  boxShadow: hasError
                    ? `0 0 0 3px ${p.error.subtle}`
                    : `0 0 0 3px ${p.primary.subtle}`,
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
