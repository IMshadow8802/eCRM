import { useEffect, useRef, useState, forwardRef } from "react";
import { Search, X } from "lucide-react";
import { useTheme } from "@mui/material/styles";

import TextInput from "./TextInput";
import IconButton from "./IconButton";

/**
 * SearchInput — debounced search with clear button + optional keyboard hint.
 *
 * Emits onChange on every debounced update. `value` is controlled; internal
 * state drives the visible input while debouncing.
 */
const SearchInput = forwardRef(function SearchInput(
  {
    value = "",
    onChange,
    debounceMs = 240,
    placeholder = "Search…",
    shortcutHint,
    size = "md",
    fullWidth = true,
    "data-testid": testId,
    ...rest
  },
  ref,
) {
  const theme = useTheme();
  const p = theme.tokens;
  const [local, setLocal] = useState(value);
  const timerRef = useRef();

  useEffect(() => {
    setLocal(value);
  }, [value]);

  const push = (v) => {
    setLocal(v);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      onChange?.(v);
    }, debounceMs);
  };

  return (
    <TextInput
      ref={ref}
      value={local}
      onChange={(e) => push(e.target.value)}
      placeholder={placeholder}
      size={size}
      fullWidth={fullWidth}
      data-testid={testId}
      leftAdornment={<Search size={16} />}
      rightAdornment={
        local ? (
          <IconButton
            size="sm"
            variant="ghost"
            aria-label="Clear search"
            onClick={() => {
              setLocal("");
              onChange?.("");
            }}
            data-testid={testId ? `${testId}-clear` : undefined}
          >
            <X size={12} />
          </IconButton>
        ) : shortcutHint ? (
          <span
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: p.text.tertiary,
              padding: "2px 6px",
              border: `1px solid ${p.border.default}`,
              borderRadius: theme.radii.sm,
            }}
          >
            {shortcutHint}
          </span>
        ) : null
      }
      {...rest}
    />
  );
});

export default SearchInput;
