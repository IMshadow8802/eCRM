import { useMemo } from "react";
import {
  Box,
  Card,
  CardActionArea,
  Chip,
  IconButton,
  InputAdornment,
  Skeleton,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import {
  AddRounded,
  DeleteRounded,
  EditRounded,
  SearchRounded,
  InboxRounded,
} from "@mui/icons-material";

/**
 * Grid of tiles for single-attribute master data (Lead Sources, Statuses, etc).
 * Replaces single-column MRT tables which look sparse.
 *
 * Props:
 *   items           - array of row objects
 *   nameKey         - property on row used as display label
 *   idKey           - property on row used as unique id
 *   isLoading       - show skeleton tiles
 *   search, onSearchChange - controlled search input
 *   onCreate        - click handler for the "+" button
 *   onEdit(item)    - edit handler per tile
 *   onDelete(item)  - delete handler per tile
 *   createLabel     - button label (e.g. "New Source")
 *   emptyLabel      - shown when items is empty
 *   color           - accent color for the tile avatar (defaults to primary.main)
 */
const TILE_COLORS = [
  "#3f4faf",
  "#f9629f",
  "#10b981",
  "#f59e0b",
  "#3b82f6",
  "#8b5cf6",
  "#ec4899",
  "#14b8a6",
];

const pickColor = (seed) => {
  let h = 0;
  const s = String(seed || "");
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return TILE_COLORS[h % TILE_COLORS.length];
};

const MasterChipGrid = ({
  items = [],
  nameKey,
  idKey,
  isLoading = false,
  search = "",
  onSearchChange,
  onCreate,
  onEdit,
  onDelete,
  createLabel = "New",
  emptyLabel = "No items yet",
  totalCount,
}) => {
  const count = typeof totalCount === "number" ? totalCount : items.length;

  const skeletonTiles = useMemo(
    () =>
      Array.from({ length: 8 }).map((_, i) => (
        <Skeleton
          key={i}
          variant="rounded"
          height={72}
          sx={{ borderRadius: 2 }}
        />
      )),
    []
  );

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
      {/* Toolbar */}
      <Stack
        direction={{ xs: "column", sm: "row" }}
        spacing={1.5}
        alignItems={{ xs: "stretch", sm: "center" }}
        justifyContent="space-between"
        sx={{
          p: 1.5,
          borderRadius: 2,
          backgroundColor: "background.paper",
          border: "1px solid",
          borderColor: "divider",
        }}
      >
        <Stack direction="row" spacing={1.5} alignItems="center">
          <TextField
            size="small"
            placeholder="Search…"
            value={search}
            onChange={(e) => onSearchChange?.(e.target.value)}
            data-testid="master-grid-search"
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchRounded fontSize="small" />
                </InputAdornment>
              ),
            }}
            sx={{ minWidth: 260 }}
          />
          <Chip
            size="small"
            label={`${count} ${count === 1 ? "item" : "items"}`}
            sx={{ fontWeight: 600 }}
            data-testid="master-grid-count"
          />
        </Stack>
        <Tooltip title={createLabel}>
          <IconButton
            onClick={onCreate}
            data-testid="master-grid-create"
            sx={{
              background: (t) =>
                `linear-gradient(135deg, ${t.palette.primary.main} 0%, ${t.palette.primary.dark} 100%)`,
              color: "common.white",
              borderRadius: 2,
              px: 1.5,
              py: 1,
              gap: 0.75,
              fontSize: "0.8667rem",
              fontWeight: 600,
              "&:hover": {
                background: (t) =>
                  `linear-gradient(135deg, ${t.palette.primary.light} 0%, ${t.palette.primary.main} 100%)`,
              },
            }}
          >
            <AddRounded fontSize="small" />
            <Box component="span" sx={{ fontSize: "0.8667rem" }}>
              {createLabel}
            </Box>
          </IconButton>
        </Tooltip>
      </Stack>

      {/* Grid */}
      {isLoading ? (
        <Box
          sx={{
            display: "grid",
            gap: 1.5,
            gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
          }}
          data-testid="master-grid-loading"
        >
          {skeletonTiles}
        </Box>
      ) : items.length === 0 ? (
        <Box
          sx={{
            p: 5,
            textAlign: "center",
            color: "text.secondary",
            border: "1px dashed",
            borderColor: "divider",
            borderRadius: 2,
            backgroundColor: "background.paper",
          }}
          data-testid="master-grid-empty"
        >
          <InboxRounded sx={{ fontSize: 40, opacity: 0.5, mb: 1 }} />
          <Typography variant="body1">{emptyLabel}</Typography>
        </Box>
      ) : (
        <Box
          sx={{
            display: "grid",
            gap: 1.5,
            gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
          }}
          data-testid="master-grid-items"
        >
          {items.map((item) => {
            const id = item[idKey];
            const name = item[nameKey] || "—";
            const color = pickColor(name);
            const initial = name.trim().charAt(0).toUpperCase() || "?";
            return (
              <Card
                key={id}
                elevation={0}
                data-testid={`master-grid-tile-${id}`}
                sx={{
                  position: "relative",
                  borderRadius: 2,
                  border: "1px solid",
                  borderColor: "divider",
                  backgroundColor: "background.paper",
                  transition: "all 180ms",
                  "&:hover": {
                    borderColor: "primary.main",
                    boxShadow: "0 6px 16px rgba(63, 79, 175, 0.12)",
                    "& .master-tile-actions": { opacity: 1 },
                  },
                }}
              >
                <CardActionArea
                  onClick={() => onEdit?.(item)}
                  sx={{ p: 1.5, borderRadius: 2 }}
                >
                  <Stack direction="row" spacing={1.25} alignItems="center">
                    <Box
                      sx={{
                        width: 40,
                        height: 40,
                        borderRadius: 1.5,
                        background: `linear-gradient(135deg, ${color}, ${color}cc)`,
                        color: "common.white",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontWeight: 700,
                        fontSize: "1.067rem",
                        flexShrink: 0,
                      }}
                    >
                      {initial}
                    </Box>
                    <Box sx={{ minWidth: 0, flex: 1 }}>
                      <Typography
                        sx={{
                          fontWeight: 600,
                          fontSize: "0.9333rem",
                          color: "text.primary",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {name}
                      </Typography>
                      <Typography
                        sx={{
                          fontSize: "0.75rem",
                          color: "text.secondary",
                        }}
                      >
                        #{id}
                      </Typography>
                    </Box>
                  </Stack>
                </CardActionArea>
                <Box
                  className="master-tile-actions"
                  sx={{
                    position: "absolute",
                    top: 6,
                    right: 6,
                    display: "flex",
                    gap: 0.25,
                    opacity: { xs: 1, md: 0 },
                    transition: "opacity 150ms",
                  }}
                >
                  <Tooltip title="Edit">
                    <IconButton
                      size="small"
                      onClick={(e) => {
                        e.stopPropagation();
                        onEdit?.(item);
                      }}
                      data-testid={`master-grid-edit-${id}`}
                      sx={{ color: "success.main" }}
                    >
                      <EditRounded fontSize="small" />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title="Delete">
                    <IconButton
                      size="small"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDelete?.(item);
                      }}
                      data-testid={`master-grid-delete-${id}`}
                      sx={{ color: "error.main" }}
                    >
                      <DeleteRounded fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </Box>
              </Card>
            );
          })}
        </Box>
      )}
    </Box>
  );
};

export default MasterChipGrid;
