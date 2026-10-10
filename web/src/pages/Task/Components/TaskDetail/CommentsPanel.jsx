import { CornerDownRight, Send } from "lucide-react";

import { Button, TextArea, EmptyState } from "../../../../components/ui";
import CommentBubble from "./CommentBubble";

export default function CommentsPanel({ comments: c, currentUserId }) {
  const {
    comments,
    newComment,
    setNewComment,
    replyTo,
    setReplyTo,
    pendingComments,
    editingComment,
    setEditingComment,
    submitComment,
    submitEditComment,
    deleteCommentById,
    togglePinComment,
  } = c;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "calc(12rem / 15)" }}>
      {comments.length === 0 ? (
        <EmptyState
          title="No comments yet"
          description="Kick off the thread. Ping the assignee, ask a question, share context."
          size="sm"
        />
      ) : (
        comments.map((comment) => (
          <CommentBubble
            key={comment.Id}
            comment={comment}
            currentUserId={currentUserId}
            pending={pendingComments.has(comment.Id)}
            isEditing={editingComment?.Id === comment.Id}
            editingText={editingComment?.text ?? ""}
            onEditText={(v) => setEditingComment((e) => ({ ...e, text: v }))}
            onStartEdit={() =>
              setEditingComment({ Id: comment.Id, text: comment.Comment })
            }
            onSaveEdit={submitEditComment}
            onCancelEdit={() => setEditingComment(null)}
            onReply={() => setReplyTo(comment.Id)}
            onDelete={() => deleteCommentById(comment)}
            onTogglePin={() => togglePinComment(comment)}
          />
        ))
      )}

      <div
        style={{
          borderTop: "1px solid var(--color-surface-200)",
          paddingTop: "calc(12rem / 15)",
        }}
      >
        {replyTo && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "calc(8rem / 15)",
              fontSize: "calc(12rem / 15)",
              color: "var(--color-surface-500)",
              marginBottom: "calc(8rem / 15)",
            }}
          >
            <CornerDownRight size={12} />
            Replying to comment #{replyTo}
            <Button variant="text" size="sm" onClick={() => setReplyTo(null)}>
              Cancel
            </Button>
          </div>
        )}
        <TextArea
          value={newComment}
          onChange={(e) => setNewComment(e.target.value)}
          placeholder={replyTo ? "Write a reply…" : "Write a comment…"}
          rows={3}
          autoGrow
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submitComment();
          }}
        />
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            marginTop: "calc(8rem / 15)",
          }}
        >
          <Button
            variant="primary"
            onClick={submitComment}
            disabled={!newComment.trim()}
            rightIcon={<Send size={14} />}
            data-testid="comment-submit"
          >
            Send
          </Button>
        </div>
      </div>
    </div>
  );
}
