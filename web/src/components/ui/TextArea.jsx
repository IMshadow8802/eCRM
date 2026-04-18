import { forwardRef, useId, useRef, useEffect } from "react";
import { useTheme } from "@mui/material/styles";

import { motion as motionTokens } from "../../styles/tokens";

const TextArea = forwardRef(function TextArea(
  {
    label,
    hint,
    error,
    required = false,
    disabled = false,
    placeholder,
    value,
    defaultValue,
    onChange,
    onBlur,
    onFocus,
    id: idProp,
    name,
    autoGrow = false,
    rows = 4,
    maxLength,
    fullWidth = true,
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
  const innerRef = useRef(null);

  // Merge external ref with internal ref
  const setRef = (node) => {
    innerRef.current = node;
    if (typeof ref === "function") ref(node);
    else if (ref) ref.current = node;
  };

  useEffect(() => {
    if (!autoGrow || !innerRef.current) return;
    const el = innerRef.current;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value, autoGrow]);

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
          }}
        >
          {label}
          {required && (
            <span style={{ color: p.error.main, marginLeft: 4 }}>*</span>
          )}
        </label>
      )}

      <textarea
        ref={setRef}
        id={id}
        name={name}
        value={value}
        defaultValue={defaultValue}
        onChange={onChange}
        onBlur={onBlur}
        onFocus={onFocus}
        disabled={disabled}
        required={required}
        placeholder={placeholder}
        rows={rows}
        maxLength={maxLength}
        aria-invalid={hasError || undefined}
        aria-describedby={helperId}
        data-testid={testId}
        style={{
          width: "100%",
          padding: "10px 12px",
          fontSize: 14,
          fontWeight: 500,
          fontFamily: "inherit",
          lineHeight: 1.5,
          color: p.text.primary,
          backgroundColor: disabled ? p.surface.subtle : p.surface.card,
          border: `1px solid ${hasError ? p.error.main : p.border.default}`,
          borderRadius: theme.radii.md,
          outline: "none",
          resize: autoGrow ? "none" : "vertical",
          minHeight: rows * 20,
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

export default TextArea;
