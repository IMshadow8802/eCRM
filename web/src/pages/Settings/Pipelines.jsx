// src/pages/Settings/Pipelines.jsx
//
// Company-admin page: list lead pipelines, drill into one to manage its
// stages. Same CRUD-master pattern as CustomFields.jsx.
//
// ponytail: salesQueries.js exposes no `fetchStages` endpoint — a
// pipeline's stages must come back embedded on its `fetchPipelines` row
// (`pipeline.Stages`, array or JSON string), mirroring the JSON
// member-list convention already used elsewhere (tblProjects.Members).
// Parsed defensively below; upgrade this if the backend ever ships a
// dedicated fetchStages endpoint.
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Helmet } from "react-helmet-async";
import { Box, Stack, Typography, IconButton } from "@mui/material";
import { ArrowBackRounded } from "@mui/icons-material";
import { useSnackbar } from "notistack";

import PageHeader from "../../components/PageHeader";
import MasterChipGrid from "../../components/MasterChipGrid";
import ConfirmationDialog from "../../components/ConfirmationDialog";
import {
  FormModal,
  FormContainer,
  FormRow,
  FormInput,
  FormSelect,
  FormNumberInput,
  FormButtons,
} from "../../components/Design/FormComponents";

import { useApiQuery } from "../../hooks/useApiQuery";
import { useConfirmation } from "../../hooks";
import {
  SALES_ENDPOINTS,
  savePipeline,
  saveStage,
  deleteStage,
} from "../../api/salesQueries";

const ENTITY = "lead";

const STAGE_TYPE_OPTIONS = [
  { value: "open", label: "Open" },
  { value: "won", label: "Won" },
  { value: "lost", label: "Lost" },
];

const parseStages = (stages) => {
  if (!stages) return [];
  let raw = stages;
  if (typeof stages === "string") {
    try {
      raw = JSON.parse(stages);
    } catch {
      return [];
    }
  }
  return Array.isArray(raw) ? raw : [];
};

const emptyPipelineForm = { Name: "" };
const emptyStageForm = { Name: "", SortOrder: "0", StageType: "open", Color: "#3B82F6" };

const Pipelines = () => {
  const { enqueueSnackbar } = useSnackbar();
  const confirmation = useConfirmation();

  const [view, setView] = useState("pipelines"); // 'pipelines' | 'stages'
  const [selectedPipelineId, setSelectedPipelineId] = useState(null);

  const [pipelineSearch, setPipelineSearch] = useState("");
  const [isPipelineModalOpen, setIsPipelineModalOpen] = useState(false);
  const [pipelineForm, setPipelineForm] = useState(emptyPipelineForm);
  const [pipelineErrors, setPipelineErrors] = useState({});
  const [isSavingPipeline, setIsSavingPipeline] = useState(false);

  const [stageSearch, setStageSearch] = useState("");
  const [isStageModalOpen, setIsStageModalOpen] = useState(false);
  const [editingStage, setEditingStage] = useState(null);
  const [stageForm, setStageForm] = useState(emptyStageForm);
  const [stageErrors, setStageErrors] = useState({});
  const [isSavingStage, setIsSavingStage] = useState(false);

  const query = useApiQuery({
    queryKey: ["pipelines", ENTITY],
    endpoint: SALES_ENDPOINTS.config.fetchPipelines,
    params: { Entity: ENTITY },
  });

  const pipelines = query.data?.pipelines || [];
  const pipelineItems = useMemo(() => {
    if (!pipelineSearch.trim()) return pipelines;
    const term = pipelineSearch.trim().toLowerCase();
    return pipelines.filter((p) => (p.Name || "").toLowerCase().includes(term));
  }, [pipelines, pipelineSearch]);

  const selectedPipeline = useMemo(
    () => pipelines.find((p) => p.Id === selectedPipelineId) || null,
    [pipelines, selectedPipelineId]
  );

  const stages = useMemo(() => parseStages(selectedPipeline?.Stages), [selectedPipeline]);
  const stageItems = useMemo(() => {
    if (!stageSearch.trim()) return stages;
    const term = stageSearch.trim().toLowerCase();
    return stages.filter((s) => (s.Name || "").toLowerCase().includes(term));
  }, [stages, stageSearch]);

  // Pipeline create form
  useEffect(() => {
    if (!isPipelineModalOpen) return;
    setPipelineForm(emptyPipelineForm);
    setPipelineErrors({});
  }, [isPipelineModalOpen]);

  const handleCreatePipeline = () => setIsPipelineModalOpen(true);
  const closePipelineModal = () => setIsPipelineModalOpen(false);

  const handlePipelineSubmit = async () => {
    if (!pipelineForm.Name.trim()) {
      setPipelineErrors({ Name: "Pipeline name is required" });
      return;
    }
    setIsSavingPipeline(true);
    try {
      const response = await savePipeline({ Id: 0, Entity: ENTITY, Name: pipelineForm.Name.trim() });
      if (response.data.success) {
        enqueueSnackbar("Pipeline created successfully!", { variant: "success" });
        closePipelineModal();
        query.refetch();
      } else {
        enqueueSnackbar(response.data.message || "Failed to create pipeline", { variant: "error" });
      }
    } catch (error) {
      console.error("Error saving pipeline:", error);
      enqueueSnackbar(error.response?.data?.message || "Failed to create pipeline", {
        variant: "error",
      });
    } finally {
      setIsSavingPipeline(false);
    }
  };

  // Selecting a pipeline drills into its stages.
  const handleSelectPipeline = (pipeline) => {
    setSelectedPipelineId(pipeline.Id);
    setStageSearch("");
    setView("stages");
  };

  const backToPipelines = () => {
    setView("pipelines");
    setSelectedPipelineId(null);
  };

  // Stage form
  useEffect(() => {
    if (!isStageModalOpen) return;
    if (editingStage) {
      setStageForm({
        Name: editingStage.Name || "",
        SortOrder: String(editingStage.SortOrder ?? 0),
        StageType: editingStage.StageType || "open",
        Color: editingStage.Color || "#3B82F6",
      });
    } else {
      setStageForm(emptyStageForm);
    }
    setStageErrors({});
  }, [editingStage, isStageModalOpen]);

  const handleCreateStage = () => {
    setEditingStage(null);
    setIsStageModalOpen(true);
  };

  const handleEditStage = (stage) => {
    setEditingStage(stage);
    setIsStageModalOpen(true);
  };

  const closeStageModal = () => {
    setIsStageModalOpen(false);
    setEditingStage(null);
  };

  const handleStageChange = (field, value) => {
    setStageForm((prev) => ({ ...prev, [field]: value }));
    if (stageErrors[field]) setStageErrors((prev) => ({ ...prev, [field]: "" }));
  };

  const handleStageSubmit = async () => {
    if (!stageForm.Name.trim()) {
      setStageErrors({ Name: "Stage name is required" });
      return;
    }
    setIsSavingStage(true);
    try {
      const payload = {
        Id: editingStage?.Id || 0,
        PipelineId: selectedPipelineId,
        Name: stageForm.Name.trim(),
        SortOrder: Number(stageForm.SortOrder) || 0,
        StageType: stageForm.StageType,
        Color: stageForm.Color || null,
      };
      const response = await saveStage(payload);
      if (response.data.success) {
        enqueueSnackbar(`Stage ${editingStage ? "updated" : "created"} successfully!`, {
          variant: "success",
        });
        closeStageModal();
        query.refetch();
      } else {
        enqueueSnackbar(response.data.message || "Failed to save stage", { variant: "error" });
      }
    } catch (error) {
      console.error("Error saving stage:", error);
      enqueueSnackbar(error.response?.data?.message || "Failed to save stage", {
        variant: "error",
      });
    } finally {
      setIsSavingStage(false);
    }
  };

  const handleDeleteStage = useCallback(
    (stage) => {
      confirmation.confirmDelete({
        title: "Delete Stage",
        message: `Are you sure you want to delete "${stage.Name}"? This action cannot be undone.`,
        confirmText: "Delete Stage",
        onConfirm: async () => {
          try {
            const response = await deleteStage({ Id: stage.Id });
            if (response.data.success) {
              enqueueSnackbar("Stage deleted successfully!", { variant: "success" });
              query.refetch();
            } else {
              enqueueSnackbar(response.data.message || "Failed to delete stage", {
                variant: "error",
              });
            }
          } catch (error) {
            console.error("Error deleting stage:", error);
            enqueueSnackbar("Failed to delete stage!", { variant: "error" });
            throw error;
          }
        },
      });
    },
    [confirmation, enqueueSnackbar, query]
  );

  return (
    <Box sx={{ display: "flex", flexDirection: "column", flexGrow: 1 }}>
      <PageHeader title="Pipelines" subtitle="Configure the pipelines and stages leads move through." />
      <Helmet>
        <title>PRD Infotech | Pipelines</title>
      </Helmet>

      {view === "pipelines" ? (
        <Box sx={{ mt: 1.5 }}>
          <MasterChipGrid
            items={pipelineItems}
            nameKey="Name"
            idKey="Id"
            isLoading={query.isLoading}
            search={pipelineSearch}
            onSearchChange={setPipelineSearch}
            onCreate={handleCreatePipeline}
            onEdit={handleSelectPipeline}
            createLabel="New Pipeline"
            emptyLabel="No pipelines yet — create the first one."
            totalCount={pipelineItems.length}
          />
        </Box>
      ) : (
        <Box sx={{ mt: 1.5, display: "flex", flexDirection: "column", gap: 1.5 }}>
          <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
            <IconButton
              size="small"
              onClick={backToPipelines}
              data-testid="pipelines-back-button"
              aria-label="Back to pipelines"
            >
              <ArrowBackRounded fontSize="small" />
            </IconButton>
            <Typography sx={{ fontWeight: 600 }}>
              Stages — {selectedPipeline?.Name || ""}
            </Typography>
          </Stack>
          <MasterChipGrid
            items={stageItems}
            nameKey="Name"
            idKey="Id"
            isLoading={query.isLoading}
            search={stageSearch}
            onSearchChange={setStageSearch}
            onCreate={handleCreateStage}
            onEdit={handleEditStage}
            onDelete={handleDeleteStage}
            createLabel="New Stage"
            emptyLabel="No stages yet — add the first one."
            totalCount={stageItems.length}
          />
        </Box>
      )}

      <FormModal
        open={isPipelineModalOpen}
        title="Create Pipeline"
        maxWidth="max-w-2xl"
        onClose={closePipelineModal}
      >
        <div className="p-6">
          <FormContainer spacing="space-y-4">
            <FormRow columns={1}>
              <FormInput
                label="Pipeline Name"
                value={pipelineForm.Name}
                onChange={(e) => setPipelineForm({ Name: e.target.value })}
                placeholder="e.g. Sales Pipeline"
                error={pipelineErrors.Name}
                required
              />
            </FormRow>
          </FormContainer>
        </div>
        <FormButtons
          onCancel={closePipelineModal}
          onSubmit={handlePipelineSubmit}
          submitText="Create Pipeline"
          isLoading={isSavingPipeline}
        />
      </FormModal>

      <FormModal
        open={isStageModalOpen}
        title={editingStage ? "Edit Stage" : "Create Stage"}
        maxWidth="max-w-2xl"
        onClose={closeStageModal}
      >
        <div className="p-6">
          <FormContainer spacing="space-y-4">
            <FormRow columns={1}>
              <FormInput
                label="Stage Name"
                value={stageForm.Name}
                onChange={(e) => handleStageChange("Name", e.target.value)}
                placeholder="e.g. Qualified"
                error={stageErrors.Name}
                required
              />
            </FormRow>
            <FormRow columns={2}>
              <FormSelect
                label="Stage Type"
                value={stageForm.StageType}
                onChange={(e) => handleStageChange("StageType", e.target.value)}
                options={STAGE_TYPE_OPTIONS}
                required
              />
              <FormNumberInput
                label="Sort Order"
                value={stageForm.SortOrder}
                onChange={(e) => handleStageChange("SortOrder", e.target.value)}
              />
            </FormRow>
            <FormRow columns={1}>
              <FormInput
                label="Color"
                value={stageForm.Color}
                onChange={(e) => handleStageChange("Color", e.target.value)}
                placeholder="#3B82F6"
              />
            </FormRow>
          </FormContainer>
        </div>
        <FormButtons
          onCancel={closeStageModal}
          onSubmit={handleStageSubmit}
          submitText={editingStage ? "Update Stage" : "Create Stage"}
          isLoading={isSavingStage}
        />
      </FormModal>

      <ConfirmationDialog
        open={confirmation.isOpen}
        onClose={confirmation.hideConfirmation}
        onConfirm={confirmation.handleConfirm}
        title={confirmation.confirmationState.title}
        message={confirmation.confirmationState.message}
        confirmText={confirmation.confirmationState.confirmText}
        cancelText={confirmation.confirmationState.cancelText}
        type={confirmation.confirmationState.type}
        icon={confirmation.confirmationState.icon}
        isLoading={confirmation.isLoading}
        maxWidth={confirmation.confirmationState.maxWidth}
      />
    </Box>
  );
};

export default Pipelines;
