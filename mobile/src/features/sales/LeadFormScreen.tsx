import { useMemo, useState, type ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { StackScreenProps } from "@react-navigation/stack";
import { Calendar, Lock } from "lucide-react-native";

import { fetchCustomFields } from "../../api/configQueries";
import { createLead, fetchLeadDetail, updateLead, type LeadBaseFields } from "../../api/leadQueries";
import { apiErrorMessage } from "../../api/errors";
import { useAccess } from "../auth/useAccess";
import type { RootStackParamList } from "../../navigation/RootNavigator";
import useAuthStore from "../../stores/useAuthStore";
import type { ApiEnvelope, CustomFieldDef, Lead } from "../../types/api";
import { metrics, spacing } from "../../theme";
import {
  Band,
  BandSheet,
  Button,
  Card,
  DateField,
  DynamicField,
  EmptyState,
  ErrorCard,
  FieldHelp,
  FieldLabel,
  FieldRow,
  GroupHeader,
  HeaderButton,
  Input,
  MobileInput,
  Screen,
  SegmentedTabs,
  Select,
  SkeletonRows,
  Text,
  useLayout,
  useToast,
} from "../../ui";
import { asOptions, blankDraft, missingRequired, serialiseCustomFields } from "../support/ticketHelpers";
import {
  addDays,
  defaultStatus,
  FIRST_FOLLOWUPS,
  leadStatusBadge,
  localDay,
  parseDate,
  shortDay,
  type FirstFollowUp,
} from "./leadHelpers";
import { useLeadRefData } from "./useLeadRefData";

type Props = StackScreenProps<RootStackParamList, "LeadForm">;

/** The typed text of every base field; numbers stay strings until submit. */
type Draft = Record<
  "Name" | "MobileNo" | "AltMobile" | "Email" | "Company" | "Address" | "City" | "State" | "Pincode" | "EstValue" | "Remarks",
  string
>;

const EMPTY: Draft = {
  Name: "", MobileNo: "", AltMobile: "", Email: "", Company: "", Address: "", City: "", State: "", Pincode: "", EstValue: "", Remarks: "",
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

/** A validation message per field key ("Name", "MobileNo", "EstValue", "pick", "c{customFieldId}"). */
type FieldErrors = Partial<Record<string, string>>;

/** The day a first-follow-up choice books, or null (None, or Pick with no date yet). */
const firstDay = (choice: FirstFollowUp, picked: string | null, now = new Date()): string | null =>
  choice === "tomorrow" ? localDay(addDays(now, 1)) : choice === "3days" ? localDay(addDays(now, 3)) : choice === "pick" ? picked : null;

/** The form's frame (E 16 / T4): the band holds Save; at the rail the fields sit in a centred 640 card. */
function Frame({
  title, onClose, onSave, saving, disabled, children,
}: {
  title: string;
  onClose: () => void;
  onSave?: () => void;
  saving?: boolean;
  disabled?: boolean;
  children: ReactNode;
}) {
  const layout = useLayout();
  const wide = layout.nav === "rail";
  const save = onSave ? (
    <HeaderButton label={saving ? "Saving…" : wide ? "Save lead" : "Save"} onPress={onSave} disabled={disabled || saving} />
  ) : null;
  return (
    <Screen band>
      <Band
        variant="record"
        title={title}
        titleVariant={wide ? "h1" : "h2"}
        onBack={onClose}
        backIcon="close"
        actions={
          <View style={styles.bandActions}>
            {wide ? <HeaderButton label="Cancel" variant="ghost" onPress={onClose} /> : null}
            {save}
          </View>
        }
      />
      <BandSheet scroll padded={!wide} style={wide ? styles.sheetWide : undefined} contentBottom={spacing[10]}>
        {wide ? (
          <View style={[styles.column, { maxWidth: layout.contentMaxWidth }]}>
            <Card padded={false} gap={0} style={styles.card}>{children}</Card>
          </View>
        ) : (
          children
        )}
      </BandSheet>
    </Screen>
  );
}

/**
 * Add or edit a lead (E 16; T4 at the rail). Status, owner, the first
 * follow-up and the custom fields are create-only: afterwards they move
 * through the status sheet, Transfer and the follow-up sheets, which keep
 * history (the edit sends CustomJSON null so stored values survive).
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
  const title = editing ? "Edit lead" : "New lead";

  // Courtesy only — the server refuses anyway; this just spares a form that cannot be saved.
  if (!allowed) {
    return (
      <Frame title={title} onClose={navigation.goBack}>
        <EmptyState
          module="leads"
          icon={Lock}
          title={editing ? "You can't edit leads" : "You can't add leads"}
          message="Your role does not allow it. Ask an admin if you need it."
        />
      </Frame>
    );
  }

  if (editing && !lead) {
    return (
      <Frame title={title} onClose={navigation.goBack}>
        {detailQuery.isError ? <ErrorCard onRetry={() => void detailQuery.refetch()} /> : <SkeletonRows rows={5} />}
      </Frame>
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
  const wide = useLayout().nav === "rail";

  const [draft, setDraft] = useState<Draft>(() => (lead ? draftOf(lead) : EMPTY));
  const [sourceId, setSourceId] = useState<number | null>(lead?.SourceId ?? null);
  const [productId, setProductId] = useState<number | null>(lead?.ProductId ?? null);
  // Create-only picks. `undefined` = not touched yet, so the default (first
  // open status; me as owner when I am assignable) is derived, not copied in.
  const [statusPick, setStatusPick] = useState<number | undefined>(undefined);
  const [ownerPick, setOwnerPick] = useState<number | null | undefined>(undefined);
  const [first, setFirst] = useState<FirstFollowUp>("tomorrow");
  const [pickedDay, setPickedDay] = useState<string | null>(null);
  const [custom, setCustom] = useState<Record<number, string | boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const toast = useToast();

  const { statuses, sources, users, products, choicesState, retryChoices } = useLeadRefData();
  // Create sends a status and an owner picked from these lists; edit sends neither.
  const choicesReady = editing || choicesState === "ready";

  const { data: fieldDefs = [] } = useQuery({
    queryKey: ["custom-fields", "lead"],
    queryFn: () => fetchCustomFields({ Entity: "lead" }),
    enabled: !editing,
  });

  // Won is never a starting status — convert writes it, with a value.
  const startable = useMemo(() => statuses.filter((s) => s.Code !== "converted"), [statuses]);
  const statusId = statusPick ?? defaultStatus(startable);
  const ownerId = ownerPick !== undefined ? ownerPick : users.some((u) => u.Id === userId) ? userId : null;
  const customDraft = { ...blankDraft(fieldDefs), ...custom };
  const followUpDay = firstDay(first, pickedDay);

  const set = (key: keyof Draft) => (text: string) => setDraft((d) => ({ ...d, [key]: text }));

  const userOptions = useMemo(
    () =>
      users.map((u) => ({
        value: u.Id,
        label: u.Id === userId ? `${u.FullName} (you)` : u.FullName,
        avatar: { name: u.FullName, uri: u.Avatar, userId: u.Id },
      })),
    [users, userId],
  );
  const productOptions = useMemo(() => products.map((p) => ({ value: p.Id, label: p.Name })), [products]);
  const statusOptions = useMemo(
    () =>
      startable.map((s) => {
        const badge = leadStatusBadge(statuses, s.Code, s.Id);
        return { value: s.Id, label: s.Value, badge: { tone: badge.tone, icon: badge.icon }, chip: { tone: badge.chip ?? ("slate" as const), icon: badge.icon } };
      }),
    [startable, statuses],
  );

  const save = useMutation({
    mutationFn: (base: LeadBaseFields): Promise<ApiEnvelope<{ Id: number }>> =>
      editing
        ? updateLead({ ...base, Id: leadId as number })
        : createLead({
            ...base,
            StatusId: statusId,
            OwnerId: ownerId,
            FirstFollowupAt: followUpDay,
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
    onError: (err) => setError(apiErrorMessage(err, "Could not save this lead. Check your connection.")),
  });

  const submit = () => {
    // Every failing field says so beside itself; a toast names the first, so a
    // Save tapped in the band never looks like nothing happened when the field
    // is scrolled out of view.
    const value = draft.EstValue.trim() ? Number(draft.EstValue.replace(/,/g, "")) : null;
    const errors: FieldErrors = {
      ...(!draft.Name.trim() && { Name: "The lead needs a name." }),
      ...(!draft.MobileNo.trim() && { MobileNo: "A mobile number is required." }),
      ...(value != null && (!Number.isFinite(value) || value < 0) && { EstValue: "Estimated value must be a number." }),
      ...(!editing && first === "pick" && !pickedDay && { pick: "Pick the day of the first follow-up." }),
      ...(!editing && Object.fromEntries(missingRequired(fieldDefs, customDraft).map((d) => [`c${d.Id}`, `${d.Label} is required.`]))),
    };
    setFieldErrors(errors);
    const firstError = Object.values(errors)[0];
    if (firstError) {
      toast.error(`Check the form — ${firstError}`);
      return;
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

  // T4: the custom field beside Owner carries an xs "Custom" chip on its label.
  const customField = (def: CustomFieldDef, tag?: string) => (
    <DynamicField
      key={def.Id}
      tag={tag}
      field={def}
      value={customDraft[def.Id] ?? ""}
      error={fieldErrors[`c${def.Id}`]}
      onChange={(next) => setCustom((c) => ({ ...c, [def.Id]: next }))}
    />
  );
  // T4 pairs Owner with the first custom field; the rest go under More details.
  const [pairedField, ...moreFields] = !editing && wide ? fieldDefs : [undefined, ...(!editing ? fieldDefs : [])];
  const day = parseDate(followUpDay);

  const owner = (
    <Select
      label="Owner"
      value={ownerId}
      options={userOptions}
      onChange={(v) => setOwnerPick(v as number)}
      placeholder="Nobody yet"
      sheetTitle="Who works this lead?"
    />
  );

  return (
    <Frame title={editing ? "Edit lead" : "New lead"} onClose={navigation.goBack} onSave={submit} saving={save.isPending} disabled={!choicesReady}>
      {error ? <Text variant="label" color="dangerText" style={styles.error}>{error}</Text> : null}
      {!editing && choicesState === "failed" ? (
        <View style={[styles.field, styles.retry]}>
          <Text variant="label" color="dangerText" style={styles.flex}>Could not load the statuses or the team.</Text>
          <Button title="Try again" size="sm" variant="secondary" onPress={retryChoices} />
        </View>
      ) : null}

      <Field>
        <Input label="Name" required value={draft.Name} onChangeText={set("Name")} placeholder="Who is it" error={fieldErrors.Name} />
      </Field>
      <Pair
        left={<MobileInput label="Mobile" required value={draft.MobileNo} onChangeText={set("MobileNo")} placeholder="10-digit mobile number" error={fieldErrors.MobileNo} />}
        right={<MobileInput label="Alternate mobile" value={draft.AltMobile} onChangeText={set("AltMobile")} placeholder="Optional" />}
      />
      <Field>
        <Input label="Company" value={draft.Company} onChangeText={set("Company")} placeholder="Optional" />
      </Field>
      <Pair
        left={
          <Select label="Source" value={sourceId} options={asOptions(sources)} onChange={(v) => setSourceId(v as number)} placeholder="Not recorded" sheetTitle="Where did it come from?" />
        }
        right={
          <Select label="Product" value={productId} options={productOptions} onChange={(v) => setProductId(v as number)} placeholder="Not chosen" sheetTitle="Which product?" />
        }
      />
      <Pair
        left={
          <Input label="Estimated value" prefix="₹" tabular value={draft.EstValue} onChangeText={set("EstValue")} placeholder="Amount in rupees" keyboardType="number-pad" error={fieldErrors.EstValue} />
        }
        right={
          editing ? null : (
            <Select label="Status" value={statusId} options={statusOptions} onChange={(v) => setStatusPick(v as number)} sheetTitle="Where does it stand?" />
          )
        }
      />
      {editing ? null : (
        <>
          {pairedField ? <Pair left={owner} right={customField(pairedField, "Custom")} /> : <Field>{owner}</Field>}
          <Field>
            <FieldLabel label="First follow-up" />
            <SegmentedTabs
              compact
              tone={wide ? "inSheet" : "card"}
              tall={wide}
              value={first}
              onChange={setFirst}
              options={FIRST_FOLLOWUPS.map((c) => ({ value: c.value, label: c.label, icon: c.value === "pick" ? Calendar : undefined }))}
            />
            {first === "pick" ? (
              <View style={styles.pick}>
                <DateField value={pickedDay} onChange={setPickedDay} placeholder="Choose a day" minimumDate={new Date()} error={fieldErrors.pick} />
              </View>
            ) : null}
            {day ? (
              <FieldHelp hint={`Call on ${shortDay(day)}${wide ? " · reminder in your Follow-ups queue" : ""}`} />
            ) : null}
          </Field>
          {moreFields.length ? (
            <>
              <GroupHeader label="More details" rightChip={{ label: "Custom field", tone: "slate" }} />
              {moreFields.map((def) => def && <Field key={def.Id}>{customField(def)}</Field>)}
            </>
          ) : null}
        </>
      )}

      <Field>
        <Input label="Email" value={draft.Email} onChangeText={set("Email")} placeholder="Optional" keyboardType="email-address" autoCapitalize="none" autoCorrect={false} />
      </Field>
      <Pair
        left={<Input label="City" value={draft.City} onChangeText={set("City")} placeholder="Optional" />}
        right={<Input label="State" value={draft.State} onChangeText={set("State")} placeholder="Optional" />}
      />
      <Field>
        <Input label="Pincode" value={draft.Pincode} onChangeText={set("Pincode")} placeholder="Optional" keyboardType="number-pad" />
      </Field>
      <Field>
        <Input label="Address" value={draft.Address} onChangeText={set("Address")} placeholder="Optional" multiline />
      </Field>
      <Field>
        <Input label="Remarks" value={draft.Remarks} onChangeText={set("Remarks")} placeholder="Anything worth knowing" multiline numberOfLines={3} />
      </Field>
    </Frame>
  );
}

function Field({ children }: { children: ReactNode }) {
  return <View style={styles.field}>{children}</View>;
}

/** Two fields on one row (E `.two`); a missing right one leaves its half empty. */
function Pair({ left, right }: { left: ReactNode; right: ReactNode }) {
  return (
    <View style={styles.field}>
      <FieldRow>
        <View style={styles.flex}>{left}</View>
        <View style={styles.flex}>{right}</View>
      </FieldRow>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  field: { marginBottom: metrics.fieldGap },
  bandActions: { flexDirection: "row", alignItems: "center", gap: spacing[2] },
  sheetWide: { paddingTop: spacing[6] },
  column: { width: "100%", alignSelf: "center" },
  card: { paddingTop: spacing[5], paddingHorizontal: spacing[5], paddingBottom: spacing[2] },
  error: { marginBottom: spacing[3] },
  retry: { flexDirection: "row", alignItems: "center", gap: spacing[3] },
  pick: { marginTop: spacing[2] },
});
