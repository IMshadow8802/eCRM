import { useRef, useState } from "react";
import { Box } from "@mui/material";
import { useTheme } from "@mui/material/styles";
import { ArrowDown, ArrowUp, ImagePlus, Images, Trash2, Type } from "lucide-react";
import { Button, IconButton, TextInput } from "../../../../components/ui";
import RichTextEditor from "../../../../components/ui/RichTextEditor";

let seq = 0;
const key = () => `sec${++seq}`;

/**
 * The user's own appended sections (spec decision 5: a fixed layout, plus
 * sections they add at the end). Two kinds: formatted text, or a grid of
 * captioned pictures. Nothing can be moved around the page — only ordered
 * among themselves.
 */
export default function SectionsEditor({ sections, images = {}, disabled = false, onChange, onUploadPicture }) {
  const theme = useTheme();
  const p = theme.tokens;
  const [busy, setBusy] = useState(null);
  const [errors, setErrors] = useState({});
  const inputs = useRef({}); // one hidden file input per picture section, by section key

  const patch = (i, next) => onChange(sections.map((s, j) => (j === i ? { ...s, ...next } : s)));
  const move = (i, d) => { const next = [...sections]; [next[i], next[i + d]] = [next[i + d], next[i]]; onChange(next); };

  const upload = async (i, file) => {
    setBusy(i); setErrors((e) => ({ ...e, [i]: null }));
    try {
      const { id } = await onUploadPicture(file);
      patch(i, { items: [...(sections[i].items ?? []), { attachmentId: id, caption: "" }] });
    } catch (err) {
      setErrors((e) => ({ ...e, [i]: err.message }));
    } finally { setBusy(null); }
  };

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
      {sections.map((s, i) => (
        <Box key={s.key} data-testid="quote-section" sx={{ border: `1px solid ${p.border.default}`, borderRadius: `${theme.radii.md}px`, p: 1.5, display: "flex", flexDirection: "column", gap: 1 }}>
          <Box sx={{ display: "flex", gap: 1, alignItems: "flex-end" }}>
            <Box sx={{ flex: 1 }}><TextInput size="sm" label="Section title" value={s.title ?? ""} disabled={disabled} onChange={(e) => patch(i, { title: e.target.value })} /></Box>
            {!disabled && (
              <Box sx={{ display: "flex" }}>
                <IconButton size="sm" aria-label="Move section up" disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp size={14} /></IconButton>
                <IconButton size="sm" aria-label="Move section down" disabled={i === sections.length - 1} onClick={() => move(i, 1)}><ArrowDown size={14} /></IconButton>
                <IconButton size="sm" variant="destructive" aria-label="Remove section" onClick={() => onChange(sections.filter((_, j) => j !== i))}><Trash2 size={14} /></IconButton>
              </Box>
            )}
          </Box>

          {s.type === "images" ? (
            <>
              <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 1 }}>
                {(s.items ?? []).map((im, k) => (
                  <Box key={`${im.attachmentId}-${k}`} sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
                    <Box sx={{ height: 90, borderRadius: `${theme.radii.sm}px`, overflow: "hidden", background: p.surface.subtle }}>
                      {images[im.attachmentId] && <img src={images[im.attachmentId]} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />}
                    </Box>
                    <TextInput size="sm" aria-label={`Caption ${k + 1}`} placeholder="Caption" value={im.caption ?? ""} disabled={disabled}
                      onChange={(e) => patch(i, { items: s.items.map((x, m) => (m === k ? { ...x, caption: e.target.value } : x)) })} />
                    {!disabled && <Button size="sm" variant="ghost" aria-label={`Remove picture ${k + 1}`} onClick={() => patch(i, { items: s.items.filter((_, m) => m !== k) })}>Remove</Button>}
                  </Box>
                ))}
              </Box>
              {!disabled && (
                <Box>
                  <input ref={(el) => { inputs.current[s.key] = el; }} type="file" accept="image/png,image/jpeg" hidden data-testid="section-file"
                    onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) upload(i, f); }} />
                  <Button size="sm" variant="tonal" leftIcon={<ImagePlus size={13} />} loading={busy === i}
                    onClick={() => inputs.current[s.key]?.click()}>Add picture</Button>
                </Box>
              )}
              {errors[i] && <Box role="alert" sx={{ fontSize: 12, color: p.error.main }}>{errors[i]}</Box>}
            </>
          ) : (
            <RichTextEditor label="Section text" value={s.body ?? ""} disabled={disabled} minHeight={90} onChange={(body) => patch(i, { body })} data-testid={`section-text-${i}`} />
          )}
        </Box>
      ))}
      {!disabled && (
        <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
          <Button size="sm" variant="tonal" leftIcon={<Type size={14} />} onClick={() => onChange([...sections, { key: key(), type: "text", title: "", body: "" }])}>Add text section</Button>
          <Button size="sm" variant="tonal" leftIcon={<Images size={14} />} onClick={() => onChange([...sections, { key: key(), type: "images", title: "", items: [] }])}>Add picture section</Button>
        </Box>
      )}
    </Box>
  );
}
