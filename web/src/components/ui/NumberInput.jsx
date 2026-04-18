import { forwardRef } from "react";
import { Minus, Plus } from "lucide-react";

import TextInput from "./TextInput";
import IconButton from "./IconButton";

const clamp = (v, min, max) => {
  if (Number.isNaN(v)) return min ?? 0;
  if (min != null && v < min) return min;
  if (max != null && v > max) return max;
  return v;
};

const NumberInput = forwardRef(function NumberInput(
  {
    value,
    onChange,
    min,
    max,
    step = 1,
    disabled = false,
    size = "md",
    "data-testid": testId,
    ...rest
  },
  ref,
) {
  const numeric = value === "" || value == null ? "" : Number(value);

  const bump = (delta) => {
    const base = numeric === "" ? 0 : numeric;
    const next = clamp(base + delta, min, max);
    onChange?.({
      target: { value: String(next) },
      currentTarget: { value: String(next) },
    });
  };

  const handleChange = (e) => {
    const v = e.target.value;
    if (v === "" || v === "-") {
      onChange?.(e);
      return;
    }
    const n = Number(v);
    if (Number.isNaN(n)) return;
    const clamped = clamp(n, min, max);
    if (clamped !== n) {
      onChange?.({
        target: { value: String(clamped) },
        currentTarget: { value: String(clamped) },
      });
    } else {
      onChange?.(e);
    }
  };

  return (
    <TextInput
      ref={ref}
      type="number"
      inputMode="numeric"
      value={value}
      onChange={handleChange}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      size={size}
      data-testid={testId}
      leftAdornment={
        <IconButton
          size="sm"
          variant="ghost"
          onClick={() => bump(-step)}
          disabled={disabled || (min != null && numeric <= min)}
          aria-label="Decrement"
          data-testid={testId ? `${testId}-dec` : undefined}
        >
          <Minus size={14} />
        </IconButton>
      }
      rightAdornment={
        <IconButton
          size="sm"
          variant="ghost"
          onClick={() => bump(step)}
          disabled={disabled || (max != null && numeric >= max)}
          aria-label="Increment"
          data-testid={testId ? `${testId}-inc` : undefined}
        >
          <Plus size={14} />
        </IconButton>
      }
      {...rest}
    />
  );
});

export default NumberInput;
