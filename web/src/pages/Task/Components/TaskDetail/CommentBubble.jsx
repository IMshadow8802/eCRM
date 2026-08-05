import dayjs from "dayjs";
import {
  Pin,
  PinOff,
  Trash2,
  Reply,
  Pencil,
  Save as SaveIcon,
  X as XIcon,
} from "lucide-react";

import {
  Button,
  IconButton,
  TextArea,
  Tooltip,
} from "../../../../components/ui";
import UserAvatar from "../../../../components/ui/UserAvatar";

export default function CommentBubble({
  comment: c,
  currentUserId,
  pending,
  isEditing,
  editingText,
  onEditText,
  onStartEdit,
  onSaveEdit,
  onCancelEdit,
  onReply,
  onDelete,
  onTogglePin,
}) {
  const mine = c.UserId === currentUserId;
  const canModify = mine && !c.IsDeleted;
  return (
    <div
      data-testid={`comment-${c.Id}`}
      style={{
        display: "flex",
        gap: 12,
        padding: "6px 0",
        marginLeft: c.ParentCommentId ? 28 : 0,
      }}
    >
      <UserAvatar userId={c.UserId} name={c.UserName} size="sm" />
      {/* Feed layout: avatar rail + content. Pinned comments keep a subtle
          tint instead of every comment sitting in its own heavy box. */}
      <div
        style={{
          flex: 1,
          minWidth: 0,
          ...(c.IsPinned
            ? {
                background: "var(--color-warning-50)",
                border: "1px solid var(--color-warning-500)",
                borderRadius: 10,
                padding: "8px 10px",
              }
            : {}),
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginBottom: 6,
          }}
        >
        <span
          style={{
            fontSize: 14,
            fontWeight: 700,
            color: "var(--color-surface-900)",
          }}
        >
          {c.UserName}
        </span>
        {c.IsEdited ? (
          <span style={{ fontSize: 11, color: "var(--color-surface-400)" }}>
            edited
          </span>
        ) : null}
        <span
          style={{
            fontSize: 11,
            color: "var(--color-surface-400)",
            marginLeft: "auto",
          }}
        >
          {dayjs(c.CreatedDate).format("DD/MM/YYYY, hh:mm A")}
        </span>
        <Tooltip title={c.IsPinned ? "Unpin" : "Pin"}>
          <IconButton
            size="sm"
            variant="ghost"
            onClick={onTogglePin}
            data-testid={`pin-${c.Id}`}
            aria-label={c.IsPinned ? "Unpin comment" : "Pin comment"}
          >
            {c.IsPinned ? <Pin size={14} /> : <PinOff size={14} />}
          </IconButton>
        </Tooltip>
        <Tooltip title="Reply">
          <IconButton
            size="sm"
            variant="ghost"
            onClick={onReply}
            aria-label="Reply"
          >
            <Reply size={14} />
          </IconButton>
        </Tooltip>
        {canModify && !isEditing && (
          <Tooltip title="Edit">
            <IconButton
              size="sm"
              variant="ghost"
              onClick={onStartEdit}
              data-testid={`edit-${c.Id}`}
              aria-label="Edit comment"
            >
              <Pencil size={14} />
            </IconButton>
          </Tooltip>
        )}
        {canModify && (
          <Tooltip title="Delete">
            <IconButton
              size="sm"
              variant="destructive"
              onClick={onDelete}
              disabled={pending}
              data-testid={`delete-${c.Id}`}
              aria-label="Delete comment"
            >
              <Trash2 size={14} />
            </IconButton>
          </Tooltip>
        )}
      </div>
      {isEditing ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <TextArea
            value={editingText}
            onChange={(e) => onEditText(e.target.value)}
            rows={3}
            autoGrow
            data-testid={`edit-input-${c.Id}`}
          />
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <Button
              variant="text"
              size="sm"
              leftIcon={<XIcon size={14} />}
              onClick={onCancelEdit}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              leftIcon={<SaveIcon size={14} />}
              onClick={onSaveEdit}
              disabled={!editingText.trim()}
              data-testid={`edit-save-${c.Id}`}
            >
              Save
            </Button>
          </div>
        </div>
      ) : (
        <div
          style={{
            fontSize: 14,
            fontWeight: 400,
            lineHeight: 1.5,
            color: c.IsDeleted
              ? "var(--color-surface-400)"
              : "var(--color-surface-700)",
            fontStyle: c.IsDeleted ? "italic" : "normal",
          }}
        >
          {c.Comment}
        </div>
      )}
      {c.ReadByUserIds && (
        <div
          style={{
            fontSize: 11,
            color: "var(--color-surface-400)",
            marginTop: 6,
          }}
        >
          Seen by {c.ReadByUserIds.split(",").length}
        </div>
      )}
      </div>
    </div>
  );
}
