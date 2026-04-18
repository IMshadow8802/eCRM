import { forwardRef, useId } from "react";
import { useTheme } from "@mui/material/styles";

import { motion as motionTokens } from "../../styles/tokens";

/**
 * TextInput — clean wrapper around a native <input>. Themed via MUI
 * theme tokens so light/dark switching is automatic.
 *
 * Props match the usual form-control shape so react-hook-form can drive
 * it directly. Supports label, hint, error, leftAdornment, rightAdornment.
 */
const SIZE = {
  sm: { height: 32, font: 13, px: 10, labelFont: 12 },
  md: { height: 40, font: 14, px: 12, labelFont: 13 },
  lg: { height: 48, font: 15, px: 14, labelFont: 14 },
};

const TextInput = forwardRef(function TextInput(
  {
    label,
    hint,
    error,
    required = false,
    disabled = false,
    type = "text",
    size = "md",
    fullWidth = true,
    leftAdornment,
    rightAdornment,
    placeholder,
    value,
    defaultValue,
    onChange,
    onBlur,
    onFocus,
    id: idProp,
    name,
    autoComplete,
    inputMode,
    min,
    max,
    step,
    maxLength,
    "data-testid": testId,
    ...rest
  },
  ref,
) {
  const theme = useTheme();
  const p = theme.tokens;
  const sz = SIZE[size] ?? SIZE.md;
  const autoId = useId();
  const id = idProp || autoId;
  const hasError = Boolean(error);
  const helperId = hint || error ? `${id}-help` : undefined;

  return (
    <div
      style={{
        display: "inline-flex",
        flexDirection: "column",
        width: fullWidth ? "100%" : "auto",
        gap: 6,
        fontFamily: p.fontFamilies.sans,
      }}
      data-testid={testId ? `${testId}-wrapper` : undefined}
    >
      {label && (
        <label
          htmlFor={id}
          style={{
            fontSize: sz.labelFont,
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

      <div
        style={{
          display: "flex",
          alignItems: "center",
          height: sz.height,
          paddingInline: sz.px,
          backgroundColor: disabled
            ? p.surface.subtle
            : p.surface.card,
          border: `1px solid ${
            hasError ? p.error.main : p.border.default
          }`,
          borderRadius: theme.radii.md,
          transition: `border-color ${motionTokens.duration.base}ms ${motionTokens.easing.standard}, box-shadow ${motionTokens.duration.base}ms ${motionTokens.easing.standard}`,
        }}
        onFocusCapture={(e) => {
          if (disabled) return;
          e.currentTarget.style.borderColor = hasError
            ? p.error.main
            : p.border.focus;
          e.currentTarget.style.boxShadow = hasError
            ? `0 0 0 3px ${p.error.subtle}`
            : `0 0 0 3px ${p.primary.subtle}`;
        }}
        onBlurCapture={(e) => {
          e.currentTarget.style.borderColor = hasError
            ? p.error.main
            : p.border.default;
          e.currentTarget.style.boxShadow = "none";
        }}
      >
        {leftAdornment && (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              color: p.text.tertiary,
              marginRight: 8,
            }}
          >
            {leftAdornment}
          </span>
        )}
        <input
          ref={ref}
          id={id}
          name={name}
          type={type}
          value={value}
          defaultValue={defaultValue}
          onChange={onChange}
          onBlur={onBlur}
          onFocus={onFocus}
          disabled={disabled}
          required={required}
          placeholder={placeholder}
          autoComplete={autoComplete}
          inputMode={inputMode}
          min={min}
          max={max}
          step={step}
          maxLength={maxLength}
          aria-invalid={hasError || undefined}
          aria-describedby={helperId}
          data-testid={testId}
          style={{
            flex: 1,
            minWidth: 0,
            width: "100%",
            alignSelf: "stretch",
            display: "block",
            border: "none",
            outline: "none",
            background: "transparent",
            color: p.text.primary,
            fontSize: sz.font,
            fontWeight: 500,
            fontFamily: "inherit",
            lineHeight: `${sz.height - 2}px`,
            padding: 0,
            margin: 0,
            boxSizing: "border-box",
            caretColor: p.primary.main,
          }}
          {...rest}
        />
        {rightAdornment && (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              color: p.text.tertiary,
              marginLeft: 8,
            }}
          >
            {rightAdornment}
          </span>
        )}
      </div>

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

export default TextInput;
