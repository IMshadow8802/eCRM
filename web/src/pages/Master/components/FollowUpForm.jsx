import React, { useState, useEffect, useMemo } from "react";
import { z } from "zod";
import { useSnackbar } from "notistack";
import { useQueryClient } from "@tanstack/react-query";
import useAuthStore from "../../../stores/useAuthStore";
import useApi from "../../../hooks/useApi";
import { useApiQuery } from "../../../hooks/useApiQuery";
import {
  FormModal,
  FormContainer,
  FormRow,
  FormInput,
  FormSelect,
  FormButtons,
} from "../../../components/Design/FormComponents";
import dayjs from "dayjs";

const followUpSchema = z.object({
  LeadId: z.coerce.number().min(1, "Lead ID is required"),
  NextFollowupDate: z.string().optional(),
  FollowupType: z.string().optional(),
  Remarks: z.string().min(1, "Remarks is required"),
  Status: z.string().optional(),
});

const FollowUpForm = ({
  open,
  onClose,
  editingFollowUp = null,
  onFollowUpSaved,
}) => {
  const { enqueueSnackbar } = useSnackbar();
  const apiClient = useApi();
  const queryClient = useQueryClient();
  const { CompId, BranchId } = useAuthStore();

  const [formData, setFormData] = useState({
    LeadId: "",
    NextFollowupDate: dayjs().format("YYYY-MM-DD"),
    FollowupType: "",
    Remarks: "",
    Status: "",
  });

  const [errors, setErrors] = useState({});
  const [isLoading, setIsLoading] = useState(false);

  // Fetch leads for dropdown
  const { data: leadsData } = useApiQuery({
    queryKey: ["leads"],
    endpoint: "/api/leads/fetchLeads",
    params: {
      Id: 0,
      PageNumber: 1,
      PageSize: 9999,
      SearchTerm: null,
    },
    enabled: true,
  });

  // Transform leads to dropdown options
  const leadOptions = useMemo(() => {
    const leads = leadsData?.leads || [];
    return leads.map((lead) => ({
      value: lead.Id,
      label: lead.CustomerName,
    }));
  }, [leadsData]);

  useEffect(() => {
    if (editingFollowUp) {
      setFormData({
        LeadId: editingFollowUp.LeadId || "",
        NextFollowupDate: editingFollowUp.NextFollowupDate
          ? dayjs(editingFollowUp.NextFollowupDate).format("YYYY-MM-DD")
          : "",
        FollowupType: editingFollowUp.FollowupType || "",
        Remarks: editingFollowUp.Remarks || "",
        Status: editingFollowUp.Status || "",
      });
    } else {
      setFormData({
        LeadId: "",
        NextFollowupDate: dayjs().format("YYYY-MM-DD"),
        FollowupType: "",
        Remarks: "",
        Status: "",
      });
    }
    setErrors({});
  }, [editingFollowUp, open]);

  const validateForm = () => {
    try {
      followUpSchema.parse(formData);
      setErrors({});
      return true;
    } catch (error) {
      if (error instanceof z.ZodError) {
        const newErrors = {};
        error.errors.forEach((err) => {
          newErrors[err.path[0]] = err.message;
        });
        setErrors(newErrors);
      }
      return false;
    }
  };

  const handleSubmit = async () => {
    if (!validateForm()) return;

    setIsLoading(true);
    try {
      const payload = {
        Id: editingFollowUp?.Id || 0,
        LeadId: parseInt(formData.LeadId),
        NextFollowupDate: formData.NextFollowupDate || null,
        FollowupType: formData.FollowupType.trim() || null,
        Remarks: formData.Remarks.trim(),
        Status: formData.Status || null,
      };

      const response = await apiClient.post(
        "/api/followups/saveFollowup",
        payload
      );

      if (response.data.success) {
        enqueueSnackbar(
          `Follow-up ${editingFollowUp ? "updated" : "created"} successfully!`,
          { variant: "success" }
        );

        queryClient.invalidateQueries({ queryKey: ["followups"] });

        handleClose();
        if (onFollowUpSaved) {
          onFollowUpSaved();
        }
      } else {
        enqueueSnackbar(
          `Failed to ${editingFollowUp ? "update" : "create"} follow-up: ${
            response.data.message
          }`,
          { variant: "error" }
        );
      }
    } catch (error) {
      console.error("Error saving follow-up:", error);
      enqueueSnackbar(
        `Error ${editingFollowUp ? "updating" : "creating"} follow-up: ${
          error.message
        }`,
        { variant: "error" }
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleClose = () => {
    setFormData({
      LeadId: "",
      NextFollowupDate: dayjs().format("YYYY-MM-DD"),
      FollowupType: "",
      Remarks: "",
      Status: "",
    });
    setErrors({});
    onClose();
  };

  const handleInputChange = (field, value) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    if (errors[field]) {
      setErrors((prev) => ({ ...prev, [field]: "" }));
    }
  };

  const followupTypeOptions = [
    { value: "Phone Call", label: "Phone Call" },
    { value: "Email", label: "Email" },
    { value: "Meeting", label: "Meeting" },
    { value: "WhatsApp", label: "WhatsApp" },
    { value: "Site Visit", label: "Site Visit" },
  ];

  const statusOptions = [
    { value: "Scheduled", label: "Scheduled" },
    { value: "Completed", label: "Completed" },
    { value: "Cancelled", label: "Cancelled" },
    { value: "Pending", label: "Pending" },
  ];

  return (
    <FormModal
      open={open}
      title={editingFollowUp ? "Edit Follow-Up" : "Create Follow-Up"}
      maxWidth="max-w-3xl"
    >
      <div className="p-6">
        <FormContainer spacing="space-y-4">
          <FormRow columns={2}>
            <FormSelect
              label="Leads"
              value={formData.LeadId}
              onChange={(e) => handleInputChange("LeadId", e.target.value)}
              options={leadOptions}
              placeholder="Select lead"
              error={errors.LeadId}
              required
            />
            <FormInput
              label="Next Followup Date"
              type="date"
              value={formData.NextFollowupDate}
              onChange={(e) =>
                handleInputChange("NextFollowupDate", e.target.value)
              }
              error={errors.NextFollowupDate}
            />
          </FormRow>

          <FormRow columns={2}>
            <FormSelect
              label="Followup Type"
              value={formData.FollowupType}
              onChange={(e) =>
                handleInputChange("FollowupType", e.target.value)
              }
              options={followupTypeOptions}
              placeholder="Select followup type"
              error={errors.FollowupType}
            />
            <FormSelect
              label="Status"
              value={formData.Status}
              onChange={(e) => handleInputChange("Status", e.target.value)}
              options={statusOptions}
              placeholder="Select status"
              error={errors.Status}
            />
          </FormRow>

          <FormRow columns={1}>
            <FormInput
              label="Remarks"
              value={formData.Remarks}
              onChange={(e) => handleInputChange("Remarks", e.target.value)}
              placeholder="Enter remarks"
              error={errors.Remarks}
              required
              maxLength={500}
            />
          </FormRow>
        </FormContainer>
      </div>

      <FormButtons
        onCancel={handleClose}
        onSubmit={handleSubmit}
        submitText={editingFollowUp ? "Update Follow-Up" : "Create Follow-Up"}
        isLoading={isLoading}
      />
    </FormModal>
  );
};

export default FollowUpForm;
