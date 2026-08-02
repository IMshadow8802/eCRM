// src/api/kanbanQueries.ts
// Columns belong to a WORKSPACE, not a project. The old mobile app sent
// ProjectId here and got a hard 400 from kanbanController.save — that single
// mismatch is why its board never loaded after the workspace rewrite.
import { post, postData } from "./client";
import type { ApiEnvelope, KanbanColumn } from "../types/api";

export const KANBAN_ENDPOINTS = {
  fetchKanbanColumns: "/api/kanban/fetchKanbanColumns",
  saveKanbanColumn: "/api/kanban/saveKanbanColumn",
  deleteKanbanColumn: "/api/kanban/deleteKanbanColumn",
} as const;

export const fetchKanbanColumns = (
  params: {
    Id?: number;
    WorkspaceId?: number | null;
    PageNumber?: number;
    PageSize?: number;
    SearchTerm?: string | null;
  } = {},
): Promise<KanbanColumn[]> =>
  postData<KanbanColumn>(
    KANBAN_ENDPOINTS.fetchKanbanColumns,
    {
      Id: 0,
      WorkspaceId: null,
      PageNumber: 1,
      PageSize: 200,
      SearchTerm: null,
      ...params,
    },
    "columns",
  );

/** WorkspaceId is required — the controller 400s without it. */
export const saveKanbanColumn = (params: {
  Id?: number;
  WorkspaceId: number;
  Title: string;
  Color?: string | null;
  SortOrder?: number;
  MaxTasks?: number | null;
  IsActive?: boolean;
}): Promise<ApiEnvelope<{ columnId: number }>> =>
  post(KANBAN_ENDPOINTS.saveKanbanColumn, {
    Id: 0,
    Color: null,
    SortOrder: 0,
    MaxTasks: null,
    IsActive: true,
    ...params,
  });

/** ReassignToColumnId moves the column's tasks instead of orphaning them. */
export const deleteKanbanColumn = (params: {
  Id: number;
  ReassignToColumnId?: number | null;
  WorkspaceId?: number | null;
}): Promise<ApiEnvelope<unknown>> =>
  post(KANBAN_ENDPOINTS.deleteKanbanColumn, {
    ReassignToColumnId: null,
    WorkspaceId: null,
    ...params,
  });
