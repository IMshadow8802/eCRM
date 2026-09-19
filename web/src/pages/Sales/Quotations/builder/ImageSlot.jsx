import { useRef } from "react";
import { useTheme } from "@mui/material/styles";
import { ImagePlus, RotateCcw, Trash2 } from "lucide-react";
import { Button, Chip } from "../../../../components/ui";

/**
 * One replaceable picture on the letterhead (logo, banner). Three states:
 * showing theirs · showing OUR sample (flagged — Finalise is blocked until it
 * is replaced or removed) · removed outright.
 */
export default function ImageSlot({ label, src, isSample = false, hidden = false, disabled = false, busy = false, wide = false, onUpload, onRemove, onRestore, "data-testid": testId }) {
  const theme = useTheme();
  const p = theme.tokens;
  const input = useRef(null);

  return (
    <div data-testid={testId} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 500, color: p.text.secondary }}>{label}</span>
        {isSample && !hidden && <Chip label="Sample — replace or remove" size="sm" tone="warning" />}
      </div>
      {!hidden && (
        <div style={{ height: wide ? 72 : 88, width: wide ? "100%" : 88, borderRadius: theme.radii.md, border: `1px dashed ${p.border.strong}`, background: p.surface.subtle, overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center" }}>
          {src && <img src={src} alt={label} style={{ width: "100%", height: "100%", objectFit: wide ? "cover" : "contain" }} />}
        </div>
      )}
      {!disabled && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {hidden ? (
            <Button size="sm" variant="ghost" leftIcon={<RotateCcw size={13} />} onClick={onRestore}>Show {label.toLowerCase()}</Button>
          ) : (
            <>
              <Button size="sm" variant="tonal" leftIcon={<ImagePlus size={13} />} loading={busy} onClick={() => input.current?.click()}>Replace</Button>
              <Button size="sm" variant="ghost" leftIcon={<Trash2 size={13} />} onClick={onRemove}>Remove</Button>
            </>
          )}
          <input ref={input} type="file" accept="image/png,image/jpeg" hidden data-testid={`${testId}-file`}
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) onUpload?.(f); }} />
        </div>
      )}
    </div>
  );
}
