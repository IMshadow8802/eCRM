// src/components/Attachments.jsx
// Reusable attachments panel shared by task/ticket/lead.
//
// Two modes, switched on `entityId`:
//   LIVE   (entityId truthy) — fetches + renders server rows; add/drop uploads
//                              immediately then refetches; download + remove.
//   STAGED (entityId null/0) — used inside create modals before the entity
//                              exists. Holds File objects locally, uploads
//                              nothing. Parent calls the imperative
//                              `uploadStaged(newId)` after it saves the entity.
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { useTheme } from "@mui/material/styles";
import { enqueueSnackbar } from "notistack";
import {
  Paperclip,
  Plus,
  Download,
  Trash2,
  X,
  File as FileIcon,
  FileImage,
  FileVideo,
  FileText,
  FileSpreadsheet,
} from "lucide-react";

import { Button, IconButton, EmptyState } from "./ui";
import ConfirmationDialog from "./ConfirmationDialog";
import { useConfirmation } from "../hooks";
import {
  fetchAttachments,
  uploadAttachment,
  downloadAttachment,
  deleteAttachment,
} from "../api/attachmentQueries";

const MAX_BYTES = 50 * 1024 * 1024; // 50MB

// extension → {icon, group}. Whitelist doubles as the validation allow-list.
const TYPES = {
  png: "image", jpg: "image", jpeg: "image", gif: "image", webp: "image",
  mp4: "video", webm: "video", mov: "video",
  pdf: "pdf",
  xls: "excel", xlsx: "excel",
  doc: "word", docx: "word",
};

const ICONS = {
  image: FileImage,
  video: FileVideo,
  pdf: FileText,
  excel: FileSpreadsheet,
  word: FileText,
};

const extOf = (name = "") => name.split(".").pop().toLowerCase();

function humanSize(bytes) {
  if (bytes == null || Number.isNaN(bytes)) return "";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let val = bytes / 1024;
  let i = 0;
  while (val >= 1024 && i < units.length - 1) {
    val /= 1024;
    i += 1;
  }
  return `${val.toFixed(val < 10 ? 1 : 0)} ${units[i]}`;
}

// Returns an error string if the file is rejected, else null.
function validate(file) {
  const ext = extOf(file.name);
  if (!TYPES[ext]) return `"${file.name}" — file type .${ext} is not allowed`;
  if (file.size > MAX_BYTES) return `"${file.name}" exceeds the 50MB limit`;
  return null;
}

function TypeIcon({ name }) {
  const Icon = ICONS[TYPES[extOf(name)]] ?? FileIcon;
  return <Icon size={18} />;
}

const Attachments = forwardRef(function Attachments(
  { entity, entityId, disabled = false },
  ref,
) {
  const theme = useTheme();
  const p = theme.tokens;
  const live = Boolean(entityId);

  const [rows, setRows] = useState([]); // LIVE: server rows
  const [staged, setStaged] = useState([]); // STAGED: File objects
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false); // upload in flight
  const inputRef = useRef(null);
  const confirmation = useConfirmation();

  const load = useCallback(async () => {
    if (!live) return;
    setLoading(true);
    try {
      const res = await fetchAttachments({ Entity: entity, EntityId: entityId });
      setRows(res?.data?.data?.attachments ?? []);
    } catch {
      enqueueSnackbar("Failed to load attachments", { variant: "error" });
    } finally {
      setLoading(false);
    }
  }, [live, entity, entityId]);

  useEffect(() => {
    load();
  }, [load]);

  // Split incoming files into valid ones + surface rejections.
  const accept = useCallback((fileList) => {
    const files = Array.from(fileList || []);
    const ok = [];
    files.forEach((f) => {
      const err = validate(f);
      if (err) enqueueSnackbar(err, { variant: "error" });
      else ok.push(f);
    });
    return ok;
  }, []);

  const onFiles = useCallback(
    async (fileList) => {
      if (disabled) return;
      const ok = accept(fileList);
      if (!ok.length) return;

      if (!live) {
        setStaged((prev) => [...prev, ...ok]);
        return;
      }

      setBusy(true);
      let failed = 0;
      for (const file of ok) {
        try {
          await uploadAttachment({ Entity: entity, EntityId: entityId, file });
        } catch {
          failed += 1;
        }
      }
      setBusy(false);
      if (failed) enqueueSnackbar(`${failed} file(s) failed to upload`, { variant: "error" });
      await load();
    },
    [disabled, accept, live, entity, entityId, load],
  );

  const handleDrop = useCallback(
    (e) => {
      e.preventDefault();
      onFiles(e.dataTransfer.files);
    },
    [onFiles],
  );

  const handleRemove = useCallback(
    (row) => {
      confirmation.confirmDelete({
        title: "Remove attachment",
        message: `Remove "${row.FileName}"? This cannot be undone.`,
        confirmText: "Remove",
        onConfirm: async () => {
          await deleteAttachment({ Id: row.Id });
          await load();
        },
      });
    },
    [confirmation, load],
  );

  const handleDownload = useCallback(async (row) => {
    try {
      await downloadAttachment({ Id: row.Id, FileName: row.FileName });
    } catch {
      enqueueSnackbar("Download failed", { variant: "error" });
    }
  }, []);

  // Imperative API for create-modal callers (STAGED mode).
  useImperativeHandle(
    ref,
    () => ({
      stagedCount: staged.length,
      // Upload every staged file to the freshly-created entity id.
      // Returns { uploaded, failed } so the caller can toast partial success.
      async uploadStaged(newEntityId) {
        let uploaded = 0;
        let failed = 0;
        for (const file of staged) {
          try {
            await uploadAttachment({ Entity: entity, EntityId: newEntityId, file });
            uploaded += 1;
          } catch {
            failed += 1;
          }
        }
        setStaged([]);
        return { uploaded, failed };
      },
    }),
    [staged, entity],
  );

  const items = live
    ? rows.map((r) => ({ key: r.Id, name: r.FileName, size: r.FileSize, row: r }))
    : staged.map((f, i) => ({ key: `staged-${i}`, name: f.name, size: f.size, file: f, idx: i }));

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        multiple
        hidden
        data-testid="attachment-input"
        onChange={(e) => {
          onFiles(e.target.files);
          e.target.value = ""; // allow re-selecting the same file
        }}
      />

      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDrop}
        style={{
          border: `1px dashed ${p.border.default}`,
          borderRadius: theme.radii.md,
          padding: 16,
          textAlign: "center",
          background: p.surface.subtle ?? "transparent",
        }}
      >
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 8, color: p.text.secondary }}>
          <Paperclip size={18} />
        </div>
        <div style={{ fontSize: 13, color: p.text.secondary, marginBottom: 10 }}>
          Drag &amp; drop files here, or
        </div>
        <Button
          variant="tonal"
          size="sm"
          leftIcon={<Plus size={16} />}
          disabled={disabled || busy}
          loading={busy}
          onClick={() => inputRef.current?.click()}
          data-testid="attachment-add"
        >
          Add files
        </Button>
      </div>

      <div style={{ marginTop: 12 }}>
        {loading ? (
          <div style={{ fontSize: 13, color: p.text.secondary, padding: 8 }}>Loading…</div>
        ) : items.length === 0 ? (
          <EmptyState
            size="sm"
            icon={<Paperclip size={20} />}
            title="No attachments"
            description="Files you add appear here."
          />
        ) : (
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 6 }}>
            {items.map((it) => (
              <li
                key={it.key}
                data-testid="attachment-row"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "8px 10px",
                  border: `1px solid ${p.border.default}`,
                  borderRadius: theme.radii.md,
                }}
              >
                <span style={{ color: p.text.secondary, display: "inline-flex" }}>
                  <TypeIcon name={it.name} />
                </span>
                <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 13, color: p.text.primary }}>
                  {it.name}
                </span>
                <span style={{ fontSize: 12, color: p.text.secondary, flexShrink: 0 }}>
                  {humanSize(it.size)}
                </span>
                {live ? (
                  <>
                    <IconButton
                      size="sm"
                      tooltip="Download"
                      aria-label={`Download ${it.name}`}
                      onClick={() => handleDownload(it.row)}
                    >
                      <Download size={16} />
                    </IconButton>
                    <IconButton
                      size="sm"
                      variant="destructive"
                      tooltip="Remove"
                      aria-label={`Remove ${it.name}`}
                      disabled={disabled}
                      onClick={() => handleRemove(it.row)}
                    >
                      <Trash2 size={16} />
                    </IconButton>
                  </>
                ) : (
                  <IconButton
                    size="sm"
                    variant="destructive"
                    tooltip="Remove"
                    aria-label={`Remove ${it.name}`}
                    disabled={disabled}
                    onClick={() => setStaged((prev) => prev.filter((_, i) => i !== it.idx))}
                  >
                    <X size={16} />
                  </IconButton>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <ConfirmationDialog
        open={confirmation.confirmationState.open}
        onClose={confirmation.hideConfirmation}
        onConfirm={confirmation.handleConfirm}
        title={confirmation.confirmationState.title}
        message={confirmation.confirmationState.message}
        confirmText={confirmation.confirmationState.confirmText}
        cancelText={confirmation.confirmationState.cancelText}
        type={confirmation.confirmationState.type}
        isLoading={confirmation.confirmationState.isLoading}
      />
    </div>
  );
});

export default Attachments;
