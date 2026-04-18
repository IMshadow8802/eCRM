import { EditRounded, DeleteRounded, VisibilityRounded } from "@mui/icons-material";
import { Box, IconButton, Tooltip } from "@mui/material";

/**
 * Standardized Edit/Delete/View row action buttons for MRT tables.
 * Pass into useAppTable as: renderRowActions: ({ row }) => renderStandardRowActions({ row, onEdit, onDelete })
 */
export function renderStandardRowActions({ row, onEdit, onDelete, onView }) {
  return (
    <Box sx={{ display: "flex", gap: 0.5 }}>
      {onView && (
        <Tooltip title="View">
          <IconButton
            size="small"
            onClick={() => onView(row)}
            sx={{ color: "info.main", padding: "4px" }}
          >
            <VisibilityRounded fontSize="small" />
          </IconButton>
        </Tooltip>
      )}
      {onEdit && (
        <Tooltip title="Edit">
          <IconButton
            size="small"
            onClick={() => onEdit(row)}
            sx={{ color: "success.main", padding: "4px" }}
          >
            <EditRounded fontSize="small" />
          </IconButton>
        </Tooltip>
      )}
      {onDelete && (
        <Tooltip title="Delete">
          <IconButton
            size="small"
            onClick={() => onDelete(row)}
            sx={{ color: "error.main", padding: "4px" }}
          >
            <DeleteRounded fontSize="small" />
          </IconButton>
        </Tooltip>
      )}
    </Box>
  );
}
