import { useState } from "react";

import { TASK_ENDPOINTS } from "../../../../api/taskQueries";
import { useApiQuery } from "../../../../hooks/useApiQuery";
import { useApiMutation } from "../../../../hooks/useApiMutation";

// Comments concern: the thread, the composer, the reply target, and the
// in-flight locks that keep a double-tap from firing a second write.
export default function useTaskComments(taskId, task, open) {
  const [newComment, setNewComment] = useState("");
  const [replyTo, setReplyTo] = useState(null);
  // Comment ids with a delete in flight (lockout) + the comment being edited.
  const [pendingComments, setPendingComments] = useState(() => new Set());
  const [editingComment, setEditingComment] = useState(null); // { Id, text }

  const { data: commentsPayload, refetch: refetchComments } = useApiQuery({
    queryKey: ["task", taskId, "comments"],
    endpoint: TASK_ENDPOINTS.comments.getTaskComments,
    params: { TaskId: taskId, PageNumber: 1, PageSize: 100 },
    enabled: Boolean(taskId && open),
    showErrorMessage: false,
  });
  const comments = commentsPayload?.comments ?? [];

  const addCommentMutation = useApiMutation({
    endpoint: TASK_ENDPOINTS.comments.addTaskComment,
    showSuccessMessage: false,
  });
  const deleteCommentMutation = useApiMutation({
    endpoint: TASK_ENDPOINTS.comments.deleteTaskComment,
    showSuccessMessage: false,
  });
  const pinCommentMutation = useApiMutation({
    endpoint: TASK_ENDPOINTS.comments.pinTaskComment,
    showSuccessMessage: false,
  });

  const submitComment = async () => {
    const text = newComment.trim();
    if (!text) return;
    try {
      await addCommentMutation.mutateAsync({
        TaskId: taskId,
        Comment: text,
        ParentCommentId: replyTo || null,
        WorkspaceId: task?.WorkspaceId, // realtime emit-routing hint
      });
      setNewComment("");
      setReplyTo(null);
      refetchComments();
    } catch {}
  };

  // Edit reuses addTaskComment with Id>0 (sp_SaveTaskComment updates on Id>0,
  // guarded by edit_own_comment). No separate endpoint needed.
  const submitEditComment = async () => {
    const text = editingComment?.text?.trim();
    if (!text || !editingComment) return;
    try {
      await addCommentMutation.mutateAsync({
        Id: editingComment.Id,
        TaskId: taskId,
        Comment: text,
        WorkspaceId: task?.WorkspaceId,
      });
      setEditingComment(null);
      refetchComments();
    } catch {}
  };

  const deleteCommentById = async (c) => {
    if (pendingComments.has(c.Id)) return; // in flight — ignore double-tap
    setPendingComments((s) => new Set(s).add(c.Id));
    try {
      await deleteCommentMutation.mutateAsync({
        Id: c.Id,
        TaskId: task.Id, // authorize + history log + emit routing
        WorkspaceId: task.WorkspaceId,
      });
      refetchComments();
    } catch {
    } finally {
      setPendingComments((s) => {
        const n = new Set(s);
        n.delete(c.Id);
        return n;
      });
    }
  };

  const togglePinComment = (c) =>
    pinCommentMutation
      .mutateAsync({
        CommentId: c.Id,
        IsPinned: !c.IsPinned,
        TaskId: task.Id, // realtime emit-routing hints
        WorkspaceId: task.WorkspaceId,
      })
      .then(refetchComments);

  return {
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
  };
}
