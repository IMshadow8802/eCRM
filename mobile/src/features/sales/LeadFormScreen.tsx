import { useMemo, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { StackScreenProps } from "@react-navigation/stack";
import { Lock } from "lucide-react-native";

import { fetchCustomFields } from "../../api/configQueries";
import {
  createLead,
  fetchLeadDetail,
  updateLead,
  type LeadBaseFields,
} from "../../api/leadQueries";
import { apiErrorMessage } from "../../api/errors";
import { useAccess } from "../auth/useAccess";
import type { RootStackParamList } from "../../navigation/RootNavigator";
import useAuthStore from "../../stores/useAuthStore";
import type { ApiEnvelope, Lead } from "../../types/api";
import { spacing, SCREEN_PADDING } from "../../theme";
import {
  Button,
  DynamicField,
  EmptyState,
  Input,
  MobileInput,
  Screen,
  ScreenHeader,
  ScreenLoader,
  Select,
  Text,
} from "../../ui";
import {
  asOptions,
  blankDraft,
  missingRequired,
  serialiseCustomFields,
} from "../support/ticketHelpers";
import { defaultStatus, dueFromChoice, WHEN_CHOICES, type WhenChoice } from "./leadHelpers";
import { useLeadRefData } from "./useLeadRefData";

type Props = StackScreenProps<RootStackParamList, "LeadForm">;

/** The typed text of every base field; numbers stay strings until submit. */
type Draft = Record<
  "Name" | "MobileNo" | "AltMobile" | "Email" | "Company" | "Address" | "City" | "State" | "Pincode" | "EstValue" | "Remarks",
  string
>;

const EMPTY: Draft = {
  Name: "",
  MobileNo: "",
  AltMobile: "",
  Email: "",
  Company: "",
  Address: "",
  City: "",
  State: "",
  Pincode: "",
  EstValue: "",
  Remarks: "",
};

const draftOf = (lead: Lead): Draft => ({
  Name: lead.Name ?? "",
  MobileNo: lead.MobileNo ?? "",
  AltMobile: lead.AltMobile ?? "",
  Email: lead.Email ?? "",
  Company: lead.Company ?? "",
  Address: lead.Address ?? "",
  City: lead.City ?? "",
  State: lead.State ?? "",
  Pincode: lead.Pincode ?? "",
  EstValue: lead.EstValue == null ? "" : String(lead.EstValue),
  Remarks: lead.Remarks ?? "",
});

const orNull = (s: string) => s.trim() || null;

/**
 * Add or edit a lead. Status, owner and the first follow-up are create-only:
 * afterwards they move through the detail screen's status sheet, Transfer and
 * the follow-up sheets, which keep history. Custom fields are filled on
 * create; editing them stays on the web (the edit sends CustomJSON null so
 * stored values survive).
 */
export default function LeadFormScreen({ route, navigation }: Props) {
  const leadId = route.params?.leadId;
  const editing = leadId != null;
  const rights = useAccess("leads");
  const allowed = editing ? rights.edit : rights.add;

  const detailQuery = useQuery({
    queryKey: ["lead", leadId],
    queryFn: () => fetchLeadDetail({ LeadId: leadId as number }),
    enabled: editing && allowed,
  });
  const lead = detailQuery.data?.lead ?? null;

  // Courtesy only — the server refuses anyway; this just spares a form that cannot be saved.
  if (!allowed) {
    return (
      <Screen>
        <ScreenHeader title={editing ? "Edit lead" : "Add a lead"} onBack={navigation.goBack} />
        <EmptyState
          icon={Lock}
          title={editing ? "You can't edit leads" : "You can't add leads"}
          message="Your role does not allow it. Ask an admin if you need it."
        />
      </Screen>
    );
  }

  if (editing && !lead) {
    return (
      <Screen>
        <ScreenHeader title="Edit lead" onBack={navigation.goBack} />
        <ScreenLoader failed={detailQuery.isError} onRetry={detailQuery.refetch} />
      </Screen>
    );
  }

  // Keyed by record so the form seeds once from what was loaded — a refetch
  // underneath must not overwrite what is being typed.
  return <LeadForm key={lead?.Id ?? "new"} lead={lead} navigation={navigation} />;
}

function LeadForm({ lead, navigation }: { lead: Lead | null; navigation: Props["navigation"] }) {
  const editing = lead != null;
  const leadId = lead?.Id;
  const queryClient = useQueryClient();
  const userId = useAuthStore((s) => s.UserId);

  const [draft, setDraft] = useState<Draft>(() => (lead ? draftOf(lead) : EMPTY));
  const [sourceId, setSourceId] = useState<number | null>(lead?.SourceId ?? null);
  const [productId, setProductId] = useState<number | null>(lead?.ProductId ?? null);
  // Create-only picks. `undefined` = not touched yet, so the default (first
  // open status; me as owner when I am assignable) is derived, not copied in.
  const [statusPick, setStatusPick] = useState<number | undefined>(undefined);
  const [ownerPick, setOwnerPick] = useState<number | null | undefined>(undefined);
  const [firstFollowUp, setFirstFollowUp] = useState<WhenChoice | "none">("tomorrow");
  const [custom, setCustom] = useState<Record<number, string | boolean>>({});
  const [error, setError] = useState<string | null>(null);

  const { statuses, sources, users, products } = useLeadRefData();

  const { data: fieldDefs = [] } = useQuery({
    queryKey: ["custom-fields", "lead"],
    queryFn: () => fetchCustomFields({ Entity: "lead" }),
    enabled: !editing,
  });

  const statusId = statusPick ?? defaultStatus(statuses);
  const ownerId =
    ownerPick !== undefined ? ownerPick : users.some((u) => u.Id === userId) ? userId : null;
  const customDraft = { ...blankDraft(fieldDefs), ...custom };

  const set = (key: keyof Draft) => (text: string) => setDraft((d) => ({ ...d, [key]: text }));

  const userOptions = useMemo(
    () => users.map((u) => ({ value: u.Id, label: u.FullName })),
    [users],
  );
  const productOptions = useMemo(
    () => products.map((p) => ({ value: p.Id, label: p.Name })),
    [products],
  );
  // Won is never a starting status — convert writes it, with a value.
  const statusOptions = useMemo(
    () => statuses.filter((s) => s.Code !== "converted").map((s) => ({ value: s.Id, label: s.Value })),
    [statuses],
  );

  const save = useMutation({
    mutationFn: (base: LeadBaseFields): Promise<ApiEnvelope<{ Id: number }>> =>
      editing
        ? updateLead({ ...base, Id: leadId as number })
        : createLead({
            ...base,
            StatusId: statusId,
            OwnerId: ownerId,
            FirstFollowupAt: firstFollowUp === "none" ? null : dueFromChoice(firstFollowUp),
            CustomJSON: serialiseCustomFields(fieldDefs, customDraft),
          }),
    onSuccess: (response) => {
      if (!response.success) {
        setError(response.message || "Could not save this lead.");
        return;
      }
      const id = editing ? leadId : response.data?.Id;
      queryClient.invalidateQueries({ queryKey: ["leads"] });
      queryClient.invalidateQueries({ queryKey: ["lead", id] });
      // A first follow-up booked on create lands in the queue.
      queryClient.invalidateQueries({ queryKey: ["followups"] });
      if (!editing && id) navigation.replace("LeadDetail", { leadId: id });
      else navigation.goBack();
    },
    onError: (err) =>
      setError(apiErrorMessage(err, "Could not save this lead. Check your connection.")),
  });

  const submit = () => {
    if (!draft.Name.trim()) return setError("The lead needs a name.");
    if (!draft.MobileNo.trim()) return setError("A mobile number is required.");
    const value = draft.EstValue.trim() ? Number(draft.EstValue.replace(/,/g, "")) : null;
    if (value != null && (!Number.isFinite(value) || value < 0)) {
      return setError("Estimated value must be a number.");
    }
    if (!editing) {
      const missing = missingRequired(fieldDefs, customDraft);
      if (missing.length) return setError(`${missing[0]!.Label} is required.`);
    }
    setError(null);
    save.mutate({
      Name: draft.Name.trim(),
      MobileNo: draft.MobileNo.trim(),
      AltMobile: orNull(draft.AltMobile),
      Email: orNull(draft.Email),
      Company: orNull(draft.Company),
      Address: orNull(draft.Address),
      City: orNull(draft.City),
      State: orNull(draft.State),
      Pincode: orNull(draft.Pincode),
      SourceId: sourceId,
      ProductId: productId,
      EstValue: value,
      Remarks: orNull(draft.Remarks),
    });
  };

  return (
    <Screen>
      <ScreenHeader
        title={editing ? "Edit lead" : "Add a lead"}
        subtitle={lead?.Name}
        tint="success"
        onBack={navigation.goBack}
      />

      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.block}>
          <Text variant="overline" color="textMuted">
            Contact
          </Text>
          <Input label="Name" required value={draft.Name} onChangeText={set("Name")} placeholder="Who is it" />
          <MobileInput
            label="Mobile"
            required
            value={draft.MobileNo}
            onChangeText={set("MobileNo")}
            placeholder="10-digit mobile number"
          />
          <MobileInput
            label="Alternate mobile"
            value={draft.AltMobile}
            onChangeText={set("AltMobile")}
            placeholder="Optional"
          />
          <Input
            label="Email"
            value={draft.Email}
            onChangeText={set("Email")}
            placeholder="Optional"
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
          />
          <Input label="Company" value={draft.Company} onChangeText={set("Company")} placeholder="Optional" />
        </View>

        <View style={styles.block}>
          <Text variant="overline" color="textMuted">
            Interest
          </Text>
          <Select
            label="Source"
            value={sourceId}
            options={asOptions(sources)}
            onChange={(v) => setSourceId(v as number)}
            placeholder="Not recorded"
            sheetTitle="Where did it come from?"
          />
          <Select
            label="Product"
            value={productId}
            options={productOptions}
            onChange={(v) => setProductId(v as number)}
            placeholder="Not chosen"
            sheetTitle="Which product?"
          />
          <Input
            label="Estimated value (₹)"
            value={draft.EstValue}
            onChangeText={set("EstValue")}
            placeholder="Amount in rupees"
            keyboardType="number-pad"
          />
          {editing ? null : (
            <>
              <Select
                label="Status"
                value={statusId}
                options={statusOptions}
                onChange={(v) => setStatusPick(v as number)}
                sheetTitle="Where does it stand?"
              />
              <Select
                label="Owner"
                value={ownerId}
                options={userOptions}
                onChange={(v) => setOwnerPick(v as number)}
                placeholder="Nobody yet"
                sheetTitle="Who works this lead?"
              />
              <Select
                label="First follow-up"
                value={firstFollowUp}
                options={[
                  ...WHEN_CHOICES.map((w) => ({ value: w.value, label: w.label })),
                  { value: "none", label: "None" },
                ]}
                onChange={(v) => setFirstFollowUp(v as WhenChoice | "none")}
                sheetTitle="When is the first call?"
              />
            </>
          )}
        </View>

        <View style={styles.block}>
          <Text variant="overline" color="textMuted">
            Address
          </Text>
          <Input label="City" value={draft.City} onChangeText={set("City")} placeholder="Optional" />
          <Input label="State" value={draft.State} onChangeText={set("State")} placeholder="Optional" />
          <Input
            label="Pincode"
            value={draft.Pincode}
            onChangeText={set("Pincode")}
            placeholder="Optional"
            keyboardType="number-pad"
          />
          <Input
            label="Address"
            value={draft.Address}
            onChangeText={set("Address")}
            placeholder="Optional"
            multiline
          />
          <Input
            label="Remarks"
            value={draft.Remarks}
            onChangeText={set("Remarks")}
            placeholder="Anything worth knowing"
            multiline
            numberOfLines={3}
          />
        </View>

        {!editing && fieldDefs.length ? (
          <View style={styles.block}>
            <Text variant="overline" color="textMuted">
              Extra details
            </Text>
            {fieldDefs.map((def) => (
              <DynamicField
                key={def.Id}
                field={def}
                value={customDraft[def.Id] ?? ""}
                onChange={(next) => setCustom((c) => ({ ...c, [def.Id]: next }))}
              />
            ))}
          </View>
        ) : null}

        {error ? (
          <Text variant="caption" color="danger">
            {error}
          </Text>
        ) : null}

        <Button
          title={editing ? "Save changes" : "Add lead"}
          onPress={submit}
          loading={save.isPending}
          fullWidth
        />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: SCREEN_PADDING, paddingBottom: spacing[20], gap: spacing[6] },
  block: { gap: spacing[4] },
});
