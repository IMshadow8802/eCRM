// src/pages/Master/components/LeadsForm.jsx
import React, { useState, useEffect } from "react";
import { z } from "zod";
import { useSnackbar } from "notistack";
import { useQueryClient } from "@tanstack/react-query";
import dayjs from "dayjs";
import useAuthStore from "../../../stores/useAuthStore";
import useApi from "../../../hooks/useApi";
import { useApiQuery } from "../../../hooks/useApiQuery";
import {
  FormModal,
  FormContainer,
  FormInput,
  FormSelect,
  FormDateInput,
  FormTextarea,
  FormPhoneInput,
  FormEmailInput,
  FormNumberInput,
  FormButtons,
} from "../../../components/Design/FormComponents";
import { toUserOptions } from "../../../utils/userShape";

// Zod validation schema
const leadSchema = z.object({
  CustomerName: z
    .string()
    .min(3, "Customer name must be at least 3 characters")
    .max(100, "Customer name must not exceed 100 characters")
    .nonempty("Customer name is required"),
  MobileNo: z
    .string()
    .min(10, "Mobile number must be at least 10 digits")
    .nonempty("Mobile number is required"),
  AlternateMobile: z.string().optional(),
  Email: z
    .string()
    .email("Invalid email address")
    .optional()
    .or(z.literal("")),
  Address: z.string().optional(),
  LeadSource: z.string().nonempty("Lead source is required"),
  ProductCategory: z.string().optional(),
  ProductBrand: z.string().optional(),
  ProductModel: z.string().optional(),
  Budget: z.number().positive("Budget must be a positive number").optional().or(z.literal(0)),
  LeadStatus: z.string().nonempty("Lead status is required"),
  FollowupDate: z.string().optional(),
  Remarks: z.string().optional(),
  AssignTo: z.string().optional(),
  AssignedDate: z.string().optional(),
  InvoiceDate: z.string().optional(),
  InvoiceNo: z.string().optional(),
});

const LeadsForm = ({
  open,
  onClose,
  editingLead = null,
  onLeadSaved,
}) => {
  const { enqueueSnackbar } = useSnackbar();
  const apiClient = useApi();
  const queryClient = useQueryClient();
  const { user } = useAuthStore();

  // Fetch dropdown data
  const { data: sourcesData } = useApiQuery({
    queryKey: ["sources"],
    endpoint: "/api/sources/fetchSources",
    params: { SourceId: 0 },
    enabled: open,
  });

  const { data: statusData } = useApiQuery({
    queryKey: ["statuses"],
    endpoint: "/api/status/fetchStatus",
    params: { StatusId: 0 },
    enabled: open,
  });

  const { data: usersData } = useApiQuery({
    queryKey: ["users"],
    endpoint: "/api/users/fetchUsers",
    params: { Id: 0 },
    enabled: open,
  });

  // Extract dropdown data
  const sources = sourcesData?.sources || [];
  const statuses = statusData?.statuses || [];
  const users = usersData?.users || [];

  // Format dropdown options
  const sourceOptions = sources.map((source) => ({
    value: source.SourceName,
    label: source.SourceName,
  }));

  const statusOptions = statuses.map((status) => ({
    value: status.StatusName,
    label: status.StatusName,
  }));

  const userOptions = toUserOptions(users, { withJobTitle: true });

  const [formData, setFormData] = useState({
    LeadDate: dayjs().format("YYYY-MM-DD"),
    CustomerName: "",
    MobileNo: "",
    AlternateMobile: "",
    Email: "",
    Address: "",
    LeadSource: "",
    ProductCategory: "",
    ProductBrand: "",
    ProductModel: "",
    Budget: "",
    LeadStatus: "",
    FollowupDate: "",
    Remarks: "",
    AssignTo: "",
    AssignedDate: "",
    InvoiceDate: "",
    InvoiceNo: "",
  });

  const [errors, setErrors] = useState({});
  const [isLoading, setIsLoading] = useState(false);

  // Set form data when editing lead changes
  useEffect(() => {
    if (editingLead) {
      setFormData({
        LeadDate: editingLead.LeadDate
          ? dayjs(editingLead.LeadDate).format("YYYY-MM-DD")
          : dayjs().format("YYYY-MM-DD"),
        CustomerName: editingLead.CustomerName || "",
        MobileNo: editingLead.MobileNo || "",
        AlternateMobile: editingLead.AlternateMobile || "",
        Email: editingLead.Email || "",
        Address: editingLead.Address || "",
        LeadSource: editingLead.LeadSource || "",
        ProductCategory: editingLead.ProductCategory || "",
        ProductBrand: editingLead.ProductBrand || "",
        ProductModel: editingLead.ProductModel || "",
        Budget: editingLead.Budget || "",
        LeadStatus: editingLead.LeadStatus || "",
        FollowupDate: editingLead.FollowupDate
          ? dayjs(editingLead.FollowupDate).format("YYYY-MM-DD")
          : "",
        Remarks: editingLead.Remarks || "",
        AssignTo: editingLead.AssignTo?.toString() || "",
        AssignedDate: editingLead.AssignedDate
          ? dayjs(editingLead.AssignedDate).format("YYYY-MM-DD")
          : "",
        InvoiceDate: editingLead.InvoiceDate
          ? dayjs(editingLead.InvoiceDate).format("YYYY-MM-DD")
          : "",
        InvoiceNo: editingLead.InvoiceNo || "",
      });
    } else {
      // Reset form for new lead
      setFormData({
        LeadDate: dayjs().format("YYYY-MM-DD"),
        CustomerName: "",
        MobileNo: "",
        AlternateMobile: "",
        Email: "",
        Address: "",
        LeadSource: "",
        ProductCategory: "",
        ProductBrand: "",
        ProductModel: "",
        Budget: "",
        LeadStatus: "",
        FollowupDate: "",
        Remarks: "",
        AssignTo: "",
        AssignedDate: dayjs().format("YYYY-MM-DD"),
        InvoiceDate: "",
        InvoiceNo: "",
      });
    }
  }, [editingLead, open]);

  const validateForm = () => {
    try {
      const validationData = {
        ...formData,
        Budget: formData.Budget ? parseFloat(formData.Budget) : 0,
      };
      leadSchema.parse(validationData);
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
      const leadData = {
        Id: editingLead?.Id || 0,
        LeadDate: formData.LeadDate
          ? dayjs(formData.LeadDate).toISOString()
          : dayjs().toISOString(),
        CustomerName: formData.CustomerName.trim(),
        MobileNo: formData.MobileNo.trim(),
        AlternateMobile: formData.AlternateMobile.trim() || null,
        Email: formData.Email.trim() || null,
        Address: formData.Address.trim() || null,
        LeadSource: formData.LeadSource,
        ProductCategory: formData.ProductCategory.trim() || null,
        ProductBrand: formData.ProductBrand.trim() || null,
        ProductModel: formData.ProductModel.trim() || null,
        Budget: formData.Budget ? parseFloat(formData.Budget) : 0,
        LeadStatus: formData.LeadStatus,
        FollowupDate: formData.FollowupDate
          ? dayjs(formData.FollowupDate).toISOString()
          : null,
        Remarks: formData.Remarks.trim() || null,
        AssignTo: formData.AssignTo ? parseInt(formData.AssignTo) : null,
        AssignedDate: formData.AssignedDate
          ? dayjs(formData.AssignedDate).toISOString()
          : dayjs().toISOString(),
        InvoiceDate: formData.InvoiceDate
          ? dayjs(formData.InvoiceDate).toISOString()
          : null,
        InvoiceNo: formData.InvoiceNo.trim() || null,
      };

      const response = await apiClient.post(
        "/api/leads/saveLeads",
        leadData
      );

      if (response.data.success) {
        enqueueSnackbar(
          `Lead ${editingLead ? "updated" : "created"} successfully!`,
          { variant: "success" }
        );

        // Invalidate related caches
        queryClient.invalidateQueries({ queryKey: ["leads"] });

        handleClose();
        if (onLeadSaved) {
          onLeadSaved();
        }
      } else {
        enqueueSnackbar(
          `Failed to ${editingLead ? "update" : "create"} lead: ${
            response.data.message
          }`,
          { variant: "error" }
        );
      }
    } catch (error) {
      console.error("Error saving lead:", error);
      enqueueSnackbar(
        `Error ${editingLead ? "updating" : "creating"} lead: ${
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
      LeadDate: dayjs().format("YYYY-MM-DD"),
      CustomerName: "",
      MobileNo: "",
      AlternateMobile: "",
      Email: "",
      Address: "",
      LeadSource: "",
      ProductCategory: "",
      ProductBrand: "",
      ProductModel: "",
      Budget: "",
      LeadStatus: "",
      FollowupDate: "",
      Remarks: "",
      AssignTo: "",
      AssignedDate: "",
      InvoiceDate: "",
      InvoiceNo: "",
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

  return (
    <FormModal
      open={open}
      title={editingLead ? "Edit Lead" : "Create Lead"}
      maxWidth="max-w-4xl"
    >
      {/* Content */}
      <div className="p-6">
        <FormContainer spacing="space-y-4">
          {/* Lead Date */}
          <div className="grid grid-cols-1 gap-4">
            <FormDateInput
              label="Lead Date"
              value={formData.LeadDate}
              onChange={(e) => handleInputChange("LeadDate", e.target.value)}
              error={errors.LeadDate}
              required
            />
          </div>

          {/* Customer Information Section Header */}
          <div className="border-t pt-4">
            <h3 className="text-sm font-semibold text-gray-700 mb-3">
              Customer Information
            </h3>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <FormInput
              label="Customer Name"
              value={formData.CustomerName}
              onChange={(e) =>
                handleInputChange("CustomerName", e.target.value)
              }
              placeholder="Enter customer name"
              error={errors.CustomerName}
              required
              maxLength={100}
            />
            <FormPhoneInput
              label="Mobile Number"
              value={formData.MobileNo}
              onChange={(e) => handleInputChange("MobileNo", e.target.value)}
              placeholder="10-digit mobile number"
              error={errors.MobileNo}
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <FormPhoneInput
              label="Alternate Mobile"
              value={formData.AlternateMobile}
              onChange={(e) =>
                handleInputChange("AlternateMobile", e.target.value)
              }
              placeholder="Alternate contact number"
              error={errors.AlternateMobile}
            />
            <FormEmailInput
              label="Email"
              value={formData.Email}
              onChange={(e) => handleInputChange("Email", e.target.value)}
              placeholder="customer@example.com"
              error={errors.Email}
            />
          </div>

          <div className="grid grid-cols-1 gap-4">
            <FormTextarea
              label="Address"
              value={formData.Address}
              onChange={(e) => handleInputChange("Address", e.target.value)}
              placeholder="Full address"
              error={errors.Address}
              rows={2}
            />
          </div>

          {/* Product Information Section Header */}
          <div className="border-t pt-4">
            <h3 className="text-sm font-semibold text-gray-700 mb-3">
              Product Information
            </h3>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <FormSelect
              label="Lead Source"
              value={formData.LeadSource}
              onChange={(e) =>
                handleInputChange("LeadSource", e.target.value)
              }
              options={sourceOptions}
              placeholder="Select lead source"
              error={errors.LeadSource}
              required
            />
            <FormInput
              label="Product Category"
              value={formData.ProductCategory}
              onChange={(e) =>
                handleInputChange("ProductCategory", e.target.value)
              }
              placeholder="e.g., Electronics, Appliances"
              error={errors.ProductCategory}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <FormInput
              label="Product Brand"
              value={formData.ProductBrand}
              onChange={(e) =>
                handleInputChange("ProductBrand", e.target.value)
              }
              placeholder="e.g., Samsung, LG"
              error={errors.ProductBrand}
            />
            <FormInput
              label="Product Model"
              value={formData.ProductModel}
              onChange={(e) =>
                handleInputChange("ProductModel", e.target.value)
              }
              placeholder="Specific model"
              error={errors.ProductModel}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <FormNumberInput
              label="Budget"
              value={formData.Budget}
              onChange={(e) => handleInputChange("Budget", e.target.value)}
              placeholder="0.00"
              error={errors.Budget}
            />
            <FormSelect
              label="Lead Status"
              value={formData.LeadStatus}
              onChange={(e) =>
                handleInputChange("LeadStatus", e.target.value)
              }
              options={statusOptions}
              placeholder="Select lead status"
              error={errors.LeadStatus}
              required
            />
          </div>

          {/* Follow-up & Assignment Section Header */}
          <div className="border-t pt-4">
            <h3 className="text-sm font-semibold text-gray-700 mb-3">
              Follow-up & Assignment
            </h3>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <FormDateInput
              label="Follow-up Date"
              value={formData.FollowupDate}
              onChange={(e) =>
                handleInputChange("FollowupDate", e.target.value)
              }
              error={errors.FollowupDate}
            />
            <FormSelect
              label="Assign To"
              value={formData.AssignTo}
              onChange={(e) => handleInputChange("AssignTo", e.target.value)}
              options={userOptions}
              placeholder="Select user"
              error={errors.AssignTo}
            />
          </div>

          <div className="grid grid-cols-1 gap-4">
            <FormTextarea
              label="Remarks"
              value={formData.Remarks}
              onChange={(e) => handleInputChange("Remarks", e.target.value)}
              placeholder="Additional notes"
              error={errors.Remarks}
              rows={3}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <FormDateInput
              label="Assigned Date"
              value={formData.AssignedDate}
              onChange={(e) =>
                handleInputChange("AssignedDate", e.target.value)
              }
              error={errors.AssignedDate}
            />
            <FormInput
              label="Invoice Number"
              value={formData.InvoiceNo}
              onChange={(e) => handleInputChange("InvoiceNo", e.target.value)}
              placeholder="For converted leads"
              error={errors.InvoiceNo}
            />
          </div>

          <div className="grid grid-cols-1 gap-4">
            <FormDateInput
              label="Invoice Date"
              value={formData.InvoiceDate}
              onChange={(e) =>
                handleInputChange("InvoiceDate", e.target.value)
              }
              error={errors.InvoiceDate}
            />
          </div>
        </FormContainer>
      </div>

      {/* Footer */}
      <FormButtons
        onCancel={handleClose}
        onSubmit={handleSubmit}
        submitText={editingLead ? "Update Lead" : "Create Lead"}
        isLoading={isLoading}
      />
    </FormModal>
  );
};

export default LeadsForm;
