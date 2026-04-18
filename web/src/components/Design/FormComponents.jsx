// src/components/Design/FormComponents.jsx
//
// Legacy form API preserved (FormInput, FormSelect, FormModal, ...) — now
// implemented on top of the design-system primitives in components/ui so
// every Master page + form picks up modern styling, dark-mode, blur backdrop,
// and z-index fixes without call-site changes.

import React from "react";

import TextInput from "../ui/TextInput";
import TextArea from "../ui/TextArea";
import NumberInputPrimitive from "../ui/NumberInput";
import Combobox from "../ui/Combobox";
import CheckboxPrimitive from "../ui/Checkbox";
import DateField from "../ui/DateField";
import Modal from "../ui/Modal";
import Button from "../ui/Button";

// ---------------- Layout helpers ----------------

export const FormLabel = ({ children, required = false, className = "" }) => (
  <label className={`block text-sm font-medium mb-1 text-[color:var(--text-secondary,#475569)] ${className}`}>
    {children}
    {required && <span className="ml-1 text-rose-500">*</span>}
  </label>
);

export const FormError = ({ error, className = "" }) => {
  if (!error) return null;
  return <p className={`mt-1 text-xs font-medium text-rose-500 ${className}`}>{error}</p>;
};

export const FormRow = ({ children, columns = 2, gap = "4", className = "" }) => {
  const gapClass =
    { 1: "gap-1", 2: "gap-2", 3: "gap-3", 4: "gap-4", 6: "gap-6", 8: "gap-8" }[gap] || "gap-4";
  const colsClass =
    columns === 1
      ? "grid-cols-1"
      : columns === 2
        ? "grid-cols-1 md:grid-cols-2"
        : columns === 3
          ? "grid-cols-1 md:grid-cols-3"
          : columns === 4
            ? "grid-cols-1 md:grid-cols-4"
            : columns === 5
              ? "grid-cols-1 md:grid-cols-5"
              : columns === 6
                ? "grid-cols-1 md:grid-cols-6"
                : "grid-cols-1";
  return <div className={`grid ${gapClass} ${colsClass} ${className}`}>{children}</div>;
};

export const FormContainer = ({ children, spacing = "space-y-4", className = "" }) => (
  <div className={`${spacing} ${className}`}>{children}</div>
);

export const FormFieldGroup = ({ children, spacing = "space-y-1", className = "" }) => (
  <div className={`${spacing} ${className}`}>{children}</div>
);

// ---------------- Input primitives ----------------

/**
 * Text input. Legacy contract: onChange receives native event; value is string.
 */
export const FormInput = ({
  label,
  placeholder,
  value,
  onChange,
  onBlur,
  error,
  type = "text",
  required = false,
  disabled = false,
  helperText,
  className: _className,
  ...rest
}) => (
  <TextInput
    label={label}
    placeholder={placeholder}
    value={value ?? ""}
    onChange={onChange}
    onBlur={onBlur}
    error={error}
    hint={helperText}
    type={type}
    required={required}
    disabled={disabled}
    {...rest}
  />
);

/**
 * Numeric input. maxLength enforced by clamping string length; value passed
 * through as string via native event.
 */
export const FormNumberInput = ({
  label,
  placeholder,
  value,
  onChange,
  onBlur,
  error,
  required = false,
  disabled = false,
  helperText,
  min,
  max,
  step,
  maxLength,
  className: _className,
  ...rest
}) => {
  const handleChange = (e) => {
    let v = String(e.target.value ?? "").replace(/[^0-9.-]/g, "");
    if (maxLength && v.length > maxLength) v = v.slice(0, maxLength);
    onChange?.({ target: { value: v }, currentTarget: { value: v } });
  };

  // NumberInput primitive wraps TextInput with +/- steppers. For forms where
  // min/max are meaningful we use it; otherwise plain TextInput with numeric
  // filter keeps the legacy look (no steppers on phone/hourly rate fields).
  if (min != null || max != null) {
    return (
      <NumberInputPrimitive
        label={label}
        placeholder={placeholder}
        value={value ?? ""}
        onChange={handleChange}
        onBlur={onBlur}
        error={error}
        hint={helperText}
        required={required}
        disabled={disabled}
        min={min}
        max={max}
        step={step ?? 1}
        {...rest}
      />
    );
  }

  return (
    <TextInput
      label={label}
      placeholder={placeholder}
      value={value ?? ""}
      onChange={handleChange}
      onBlur={onBlur}
      error={error}
      hint={helperText}
      type="text"
      inputMode="numeric"
      required={required}
      disabled={disabled}
      maxLength={maxLength}
      {...rest}
    />
  );
};

/**
 * Select. options=[{value,label}]. value is primitive. onChange returns
 * synthetic `{target:{value}}` so react-hook-form bindings unchanged.
 */
export const FormSelect = ({
  label,
  value,
  onChange,
  onBlur,
  error,
  options = [],
  placeholder = "Select an option",
  required = false,
  disabled = false,
  helperText,
  className: _className,
  ...rest
}) => {
  const selected = options.find((o) => o.value === value) ?? null;
  return (
    <Combobox
      label={label}
      placeholder={placeholder}
      value={selected}
      onChange={(opt) =>
        onChange?.({ target: { value: opt ? opt.value : "" } })
      }
      onBlur={onBlur}
      options={options}
      error={error}
      hint={helperText}
      required={required}
      disabled={disabled}
      {...rest}
    />
  );
};

/**
 * Multi-select. value is array of primitives. onChange(arr).
 */
export const FormMultiSelect = ({
  label,
  value = [],
  onChange,
  options = [],
  placeholder = "Select options",
  error,
  required = false,
  disabled = false,
  helperText,
  className: _className,
  ...rest
}) => {
  const selected = value
    .map((v) => options.find((o) => o.value == v))
    .filter(Boolean);
  return (
    <Combobox
      label={label}
      placeholder={placeholder}
      value={selected}
      onChange={(arr) => onChange?.((arr || []).map((o) => o.value))}
      options={options}
      multiple
      error={error}
      hint={helperText}
      required={required}
      disabled={disabled}
      {...rest}
    />
  );
};

export const FormTextarea = ({
  label,
  placeholder,
  value,
  onChange,
  onBlur,
  error,
  rows = 3,
  required = false,
  disabled = false,
  helperText,
  className: _className,
  ...rest
}) => (
  <TextArea
    label={label}
    placeholder={placeholder}
    value={value ?? ""}
    onChange={onChange}
    onBlur={onBlur}
    error={error}
    hint={helperText}
    rows={rows}
    required={required}
    disabled={disabled}
    {...rest}
  />
);

/**
 * Date field. ISO (YYYY-MM-DD) in/out. Legacy callers pass an event-shaped
 * onChange — adapt here.
 */
export const FormDateInput = ({
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
  className: _className,
  ...rest
}) => (
  <DateField
    label={label}
    value={value || ""}
    onChange={(iso) => onChange?.({ target: { value: iso || "" } })}
    onBlur={onBlur}
    error={error}
    hint={helperText}
    required={required}
    disabled={disabled}
    minDate={minDate}
    maxDate={maxDate}
    {...rest}
  />
);

export const FormEmailInput = ({
  label,
  placeholder = "Enter email address",
  ...rest
}) => <FormInput type="email" label={label} placeholder={placeholder} {...rest} />;

export const FormPhoneInput = ({
  label,
  placeholder = "Enter 10-digit phone number",
  ...rest
}) => (
  <FormNumberInput
    label={label}
    placeholder={placeholder}
    maxLength={10}
    {...rest}
  />
);

export const FormCheckbox = ({
  label,
  checked,
  onChange,
  error,
  disabled = false,
  ...rest
}) => (
  <CheckboxPrimitive
    label={label}
    checked={Boolean(checked)}
    onChange={onChange}
    error={error}
    disabled={disabled}
    {...rest}
  />
);

// ---------------- Buttons ----------------

export const FormButtons = ({
  onCancel,
  onSubmit,
  cancelText = "Cancel",
  submitText = "Submit",
  isLoading = false,
  disabled = false,
  className = "",
}) => (
  <div
    className={`flex items-center justify-end gap-2 border-t px-5 py-3 ${className}`}
    style={{ borderColor: "rgba(148,163,184,0.2)" }}
  >
    <Button variant="ghost" onClick={onCancel} type="button">
      {cancelText}
    </Button>
    <Button
      variant="primary"
      onClick={onSubmit}
      disabled={disabled}
      loading={isLoading}
      type="submit"
    >
      {submitText}
    </Button>
  </div>
);

// ---------------- Modal ----------------

const MAX_WIDTH_TO_SIZE = {
  "max-w-sm": "sm",
  "max-w-md": "sm",
  "max-w-lg": "md",
  "max-w-xl": "md",
  "max-w-2xl": "md",
  "max-w-3xl": "lg",
  "max-w-4xl": "lg",
  "max-w-5xl": "xl",
  "max-w-6xl": "xl",
};

/**
 * Legacy FormModal proxied onto ui/Modal. Blur backdrop, card surface,
 * design-system header. `maxWidth` (Tailwind class) maps to Modal size.
 */
export const FormModal = ({
  open,
  title,
  subtitle,
  icon,
  children,
  maxWidth = "max-w-4xl",
  className: _className,
  onClose,
  "data-testid": testId,
}) => {
  const size = MAX_WIDTH_TO_SIZE[maxWidth] ?? "lg";
  return (
    <Modal open={open} onClose={onClose} size={size} data-testid={testId}>
      {title && (
        <Modal.Header
          title={title}
          subtitle={subtitle}
          icon={icon}
          onClose={onClose}
        />
      )}
      <Modal.Body padded={false}>{children}</Modal.Body>
    </Modal>
  );
};
