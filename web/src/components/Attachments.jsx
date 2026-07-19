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
  Play,
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

import { Button, IconButton, EmptyState, Modal, Skeleton } from "./ui";
import ConfirmationDialog from "./ConfirmationDialog";
import { useConfirmation } from "../hooks";
import {
  fetchAttachments,
  uploadAttachment,
  downloadAttachment,
  deleteAttachment,
  fetchAttachmentBlob,
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

// Preview class from the MimeType field (server rows) / File.type (staged).
const mimeClass = (m) => {
  const mime = m || "";
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  return "doc";
};

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
  const [media, setMedia] = useState({}); // key -> { url } | { error: true }
  const [preview, setPreview] = useState(null); // item open in the lightbox
  const createdUrls = useRef([]); // every object URL we made, for revocation
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

  // Build object URLs for previewable files. Staged files preview locally via
  // URL.createObjectURL; live images fetch their blob when the list renders
  // (records hold a handful of files — no caching layer). Live videos fetch
  // lazily on open (see openPreview). Cleanup revokes everything.
  useEffect(() => {
    let cancelled = false;
    if (live) {
      rows.forEach((r) => {
        if (mimeClass(r.MimeType) !== "image") return;
        fetchAttachmentBlob({ Id: r.Id })
          .then(({ url }) => {
            if (cancelled) return URL.revokeObjectURL(url);
            createdUrls.current.push(url);
            setMedia((m) => ({ ...m, [r.Id]: { url } }));
          })
          .catch(() => {
            if (!cancelled) setMedia((m) => ({ ...m, [r.Id]: { error: true } }));
          });
      });
    } else {
      const next = {};
      staged.forEach((f, i) => {
        if (mimeClass(f.type) === "doc") return;
        const url = URL.createObjectURL(f);
        createdUrls.current.push(url);
        next[`staged-${i}`] = { url };
      });
      setMedia(next);
    }
    return () => {
      cancelled = true;
      createdUrls.current.forEach((u) => URL.revokeObjectURL(u));
      createdUrls.current = [];
      setMedia({});
      setPreview(null);
    };
  }, [live, rows, staged]);

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

  // Open the lightbox/player. Live video blobs are fetched on demand here;
  // image blobs are already loading via the list effect.
  const openPreview = useCallback(
    async (it) => {
      setPreview(it);
      if (it.kind === "video" && live && !media[it.key]?.url) {
        try {
          const { url } = await fetchAttachmentBlob({ Id: it.row.Id });
          createdUrls.current.push(url);
          setMedia((m) => ({ ...m, [it.key]: { url } }));
        } catch {
          enqueueSnackbar("Preview failed", { variant: "error" });
          setPreview(null);
        }
      }
    },
    [live, media],
  );

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
    ? rows.map((r) => ({ key: r.Id, name: r.FileName, size: r.FileSize, row: r, kind: mimeClass(r.MimeType) }))
    : staged.map((f, i) => ({ key: `staged-${i}`, name: f.name, size: f.size, file: f, idx: i, kind: mimeClass(f.type) }));

  // A media item whose blob fetch failed falls back to the plain doc row.
  const kindOf = (it) => (media[it.key]?.error ? "doc" : it.kind);
  const mediaItems = items.filter((it) => kindOf(it) !== "doc");
  const docItems = items.filter((it) => kindOf(it) === "doc");
  const previewUrl = preview ? media[preview.key]?.url : null;

  const removeItem = (it) =>
    it.row ? handleRemove(it.row) : setStaged((prev) => prev.filter((_, i) => i !== it.idx));

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
          <>
            {mediaItems.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: docItems.length ? 10 : 0 }}>
                {mediaItems.map((it) => {
                  const url = media[it.key]?.url;
                  return (
                    <div key={it.key} data-testid="attachment-tile" style={{ position: "relative", width: 84 }}>
                      <button
                        type="button"
                        aria-label={`Preview ${it.name}`}
                        onClick={() => openPreview(it)}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          width: 84,
                          height: 84,
                          padding: 0,
                          border: `1px solid ${p.border.default}`,
                          borderRadius: theme.radii.md,
                          overflow: "hidden",
                          cursor: "pointer",
                          background: p.surface.subtle ?? "transparent",
                          color: p.text.secondary,
                        }}
                      >
                        {it.kind === "image" ? (
                          url ? (
                            <img src={url} alt={it.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                          ) : (
                            <Skeleton width={84} height={84} data-testid="attachment-thumb-skeleton" />
                          )
                        ) : (
                          <Play size={28} />
                        )}
                      </button>
                      <span style={{ position: "absolute", top: 2, right: 2 }}>
                        <IconButton
                          size="sm"
                          variant="destructive"
                          tooltip="Remove"
                          aria-label={`Remove ${it.name}`}
                          disabled={disabled}
                          onClick={() => removeItem(it)}
                        >
                          {it.row ? <Trash2 size={14} /> : <X size={14} />}
                        </IconButton>
                      </span>
                      <div
                        title={it.name}
                        style={{ width: 84, marginTop: 2, fontSize: 11, color: p.text.secondary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                      >
                        {it.name}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 6 }}>
            {docItems.map((it) => (
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
          </>
        )}
      </div>

      <Modal
        open={Boolean(preview)}
        onClose={() => setPreview(null)}
        size="lg"
        data-testid="attachment-preview"
        aria-label={preview ? `Preview ${preview.name}` : "Preview"}
      >
        <Modal.Header title={preview?.name} onClose={() => setPreview(null)} />
        <Modal.Body>
          {preview &&
            (previewUrl ? (
              preview.kind === "video" ? (
                <video
                  src={previewUrl}
                  controls
                  data-testid="attachment-video"
                  style={{ display: "block", width: "100%", maxHeight: "70vh", borderRadius: theme.radii.md }}
                />
              ) : (
                <img
                  src={previewUrl}
                  alt={preview.name}
                  style={{ display: "block", width: "100%", maxHeight: "70vh", objectFit: "contain", borderRadius: theme.radii.md }}
                />
              )
            ) : (
              <Skeleton width="100%" height={240} data-testid="attachment-preview-skeleton" />
            ))}
        </Modal.Body>
        {preview?.row && (
          <Modal.Footer>
            <Button
              variant="tonal"
              size="sm"
              leftIcon={<Download size={16} />}
              onClick={() => handleDownload(preview.row)}
            >
              Download
            </Button>
          </Modal.Footer>
        )}
      </Modal>

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
