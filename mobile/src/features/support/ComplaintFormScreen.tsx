import { useDeferredValue, useMemo, useState } from "react";
import { Image, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, Lock, Paperclip, Search, UserPlus, X } from "lucide-react-native";
import * as DocumentPicker from "expo-document-picker";
import type { StackNavigationProp, StackScreenProps } from "@react-navigation/stack";

import { uploadAttachment, type PickedFile } from "../../api/attachmentQueries";
import { fetchCustomFields } from "../../api/configQueries";
import { fetchCustomers, saveCustomer } from "../../api/customerQueries";
import { fetchProducts } from "../../api/productQueries";
import { fetchTicketDetail, saveTicket } from "../../api/ticketQueries";
import { fetchBranches } from "../../api/userQueries";
import { apiErrorMessage } from "../../api/errors";
import { useAccess } from "../auth/useAccess";
import { fileMeta, humanSize, PICKER_TYPES, screenPicked } from "../attachments/attachmentHelpers";
import useAuthStore from "../../stores/useAuthStore";
import type { RootStackParamList } from "../../navigation/RootNavigator";
import type { Customer, CustomFieldDef, Ticket, TicketDetail } from "../../types/api";
import { colors, elevation, metrics, priorityChip, radius, spacing } from "../../theme";
import { normalizeMobile } from "../../utils/mobile";
import {
  Band,
  BandSheet,
  Button,
  Card,
  DynamicField,
  EmptyState,
  ErrorCard,
  FieldLabel,
  FieldRow,
  GroupHeader,
  Input,
  ListGroup,
  ListRow,
  MobileInput,
  Screen,
  Select,
  SkeletonRows,
  StatusBadge,
  Text,
  useLayout,
  useToast,
} from "../../ui";
import {
  asOptions,
  blankDraft,
  draftFromValues,
  dueWhen,
  missingRequired,
  serialiseCustomFields,
  tatLabel,
} from "./ticketHelpers";
import { useTicketRefData } from "./useTicketRefData";

type Props = StackScreenProps<RootStackParamList, "ComplaintForm">;
type Nav = StackNavigationProp<RootStackParamList, "ComplaintForm">;

/**
 * What the form needs to know about the chosen customer — and all it CAN know
 * about a just-created one, where the client holds the fields it typed plus
 * the returned Id and nothing else.
 */
type PickedCustomer = Pick<Customer, "Id" | "Name" | "ContactPerson" | "Mobile" | "Email">;

/** A file picked before the complaint exists, with what the chip shows. */
type Staged = PickedFile & { size?: number | null };

/** A mobile number as typed: digits, a leading +, and the separators people use. */
const LOOKS_LIKE_A_NUMBER = /^[0-9+\s-]+$/;

/** The web's check (CustomerFormModal): something@something.tld, no spaces. */
const LOOKS_LIKE_AN_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const contactLine = (c: { ContactPerson?: string | null; Mobile?: string | null; Email?: string | null }) =>
  [c.ContactPerson, c.Mobile || c.Email].filter(Boolean).join(" · ") || "No contact details";

/**
 * Log or edit a complaint (E 12).
 *
 * The outer component only waits for the row; the fields live in a child that
 * seeds its state from props, so no effect copies server data into local state
 * and a background refetch cannot overwrite what someone is typing.
 */
export default function ComplaintFormScreen({ route, navigation }: Props) {
  const ticketId = route.params?.ticketId;
  const editing = ticketId != null;

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["ticket", ticketId],
    queryFn: () => fetchTicketDetail({ TicketId: ticketId! }),
    enabled: editing,
  });

  if (editing && (isLoading || isError || !data?.ticket)) {
    return (
      <Screen band>
        <Band variant="record" titleVariant="h2" title="Edit complaint" onBack={navigation.goBack} backIcon="close" />
        <BandSheet center={!isLoading && !isError}>
          {isLoading ? (
            <SkeletonRows rows={4} />
          ) : isError ? (
            <ErrorCard onRetry={() => void refetch()} />
          ) : (
            <EmptyState
              module="complaints"
              icon={Lock}
              title="Complaint not available"
              message="It may have been deleted, or it belongs to an office you cannot see."
            />
          )}
        </BandSheet>
      </Screen>
    );
  }

  return <ComplaintForm navigation={navigation} ticket={data?.ticket ?? null} detail={data ?? null} />;
}

interface ComplaintFormProps {
  navigation: Nav;
  ticket: Ticket | null;
  detail: TicketDetail | null;
}

function ComplaintForm({ navigation, ticket, detail }: ComplaintFormProps) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const layout = useLayout();
  const editing = ticket != null;

  // --- the customer -------------------------------------------------------
  // On edit this is seeded from the ticket row (RS1 carries the customer's
  // own columns), so the field opens on the right customer without a request.
  const [customer, setCustomer] = useState<PickedCustomer | null>(() =>
    ticket
      ? {
          Id: ticket.CustomerId,
          Name: ticket.CustomerName ?? "",
          ContactPerson: ticket.CustomerContactPerson ?? null,
          Mobile: ticket.CustomerMobile ?? null,
          Email: ticket.CustomerEmail ?? null,
        }
      : null,
  );
  const [search, setSearch] = useState("");
  const [creatingCustomer, setCreatingCustomer] = useState(false);
  const [newCustomer, setNewCustomer] = useState({ Name: "", ContactPerson: "", Mobile: "", Email: "", Address: "", City: "" });

  // A new customer's office. Only Company reach (admins included) gets a
  // choice: fetchBranches lists every office with no reach filter, so an
  // Office/OfficeTree reach would be offered offices the server 403s.
  const wideCustomers = useAccess("customers").reach === "Company";
  const homeOffice = useAuthStore((s) => s.BranchId);
  const [office, setOffice] = useState<number | null>(homeOffice);
  // Also names the office in the band (G24), so it is always asked (cached).
  const { data: branchRows } = useQuery({ queryKey: ["branches"], queryFn: fetchBranches });
  const officeOptions = useMemo(
    () => (branchRows ?? []).filter((b) => b.IsActive !== false).map((b) => ({ value: b.Id, label: b.BranchName })),
    [branchRows],
  );
  const showOffice = wideCustomers && creatingCustomer && officeOptions.length > 1;
  const officeName = ticket?.BranchName ?? branchRows?.find((b) => b.Id === homeOffice)?.BranchName;

  // Files picked before the complaint exists. They upload after the save,
  // against the returned Id — create only; on edit the record has Files.
  const [files, setFiles] = useState<Staged[]>([]);

  // --- the complaint ------------------------------------------------------
  const [subject, setSubject] = useState(ticket?.Subject ?? "");
  const [contactPerson, setContactPerson] = useState(ticket?.ContactPerson ?? "");
  const [contact, setContact] = useState(ticket?.Contact ?? "");
  const [channel, setChannel] = useState<number | null>(ticket?.ChannelId ?? null);
  const [category, setCategory] = useState<number | null>(ticket?.CategoryId ?? null);
  const [priority, setPriority] = useState<number | null>(ticket?.Priority ?? null);
  const [product, setProduct] = useState<number | null>(ticket?.ProductId ?? null);
  // Create-only: sp_SaveTicket does not touch AssignedTo on update, and
  // reassigning is transferTicket's job.
  const [assignee, setAssignee] = useState<number | null>(null);
  const [description, setDescription] = useState(ticket?.Description ?? "");
  const [draft, setDraft] = useState<Record<number, string | boolean>>(() =>
    detail?.fields.length ? draftFromValues(detail.fields) : {},
  );
  const [error, setError] = useState<string | null>(null);

  // Pickers. No statuses: a complaint's status is never set from this form.
  const { categories, priorities, channels, users } = useTicketRefData();

  const { data: defs } = useQuery({ queryKey: ["custom-fields", "ticket"], queryFn: () => fetchCustomFields({ Entity: "ticket" }) });
  const { data: products } = useQuery({ queryKey: ["products"], queryFn: fetchProducts });

  // Deferred rather than debounced: React keeps the previous results on screen
  // while the next request resolves. Two characters minimum.
  const term = useDeferredValue(search.trim());
  const matches = useQuery({
    queryKey: ["customers", term],
    queryFn: () => fetchCustomers({ SearchTerm: term, PageSize: 8 }),
    enabled: !customer && !creatingCustomer && term.length >= 2,
  });
  const rows = matches.data ?? [];

  const fieldDefs: CustomFieldDef[] = useMemo(() => defs ?? [], [defs]);
  // A definition the ticket has no stored value for still needs a controlled entry.
  const values = useMemo(() => ({ ...blankDraft(fieldDefs), ...draft }), [fieldDefs, draft]);
  const setField = (fieldId: number, value: string | boolean) => setDraft((prev) => ({ ...prev, [fieldId]: value }));
  const setNewField = (key: keyof typeof newCustomer, value: string) => setNewCustomer((prev) => ({ ...prev, [key]: value }));

  // The value is a chip with the flag (E 12); the TAT is what the pick sets.
  const priorityOptions = useMemo(
    () =>
      priorities.map((p) => {
        const tat = tatLabel(p.TatHours);
        return { value: p.Id, label: p.Value, sublabel: tat ? `Due in ${tat}` : "No due time", chip: priorityChip(p.Value) };
      }),
    [priorities],
  );

  // What the pick does to DueAt (web: TicketCreateModal). The phone cannot know
  // the assignee's shift, so on create it says "working hours"; on edit
  // sp_SaveTicket re-anchors a new priority from when it was raised.
  const pickedTat = tatLabel(priorities.find((p) => p.Id === priority)?.TatHours);
  const dueHint = !priority
    ? "The priority sets the due time."
    : !pickedTat
      ? "This priority has no due time."
      : !editing
        ? `Due ${pickedTat} from when it is logged.`
        : priority === ticket?.Priority
          ? `Due ${dueWhen(ticket?.DueAt) ?? "—"}.`
          : `Due time re-stamped to ${pickedTat} from when it was raised.`;

  const productOptions = useMemo(
    () => (products ?? []).map((p) => ({ value: p.Id, label: p.Name, sublabel: p.Code ?? undefined })),
    [products],
  );
  const assigneeOptions = useMemo(
    () =>
      users.map((u) => ({
        value: u.Id,
        label: u.FullName,
        sublabel: [u.JobTitle, u.BranchName].filter(Boolean).join(" · ") || undefined,
        avatar: { name: u.FullName, userId: u.Id },
      })),
    [users],
  );

  /**
   * Choosing a customer also answers "reported by" — prefilled, never
   * overwritten: whatever has already been typed is the agent's.
   */
  const pick = (row: PickedCustomer) => {
    setCustomer(row);
    setSearch("");
    setCreatingCustomer(false);
    setContactPerson((prev) => prev.trim() || row.ContactPerson || row.Name);
    setContact((prev) => prev.trim() || row.Mobile || row.Email || "");
  };

  const changeCustomer = () => {
    setCustomer(null);
    setSearch("");
    setCreatingCustomer(false);
  };

  /** Carry the typed search into the create form: digits go to Mobile, words to Name. */
  const startNewCustomer = () => {
    const typed = search.trim();
    const isNumber = LOOKS_LIKE_A_NUMBER.test(typed);
    const digits = typed.replace(/\D/g, "");
    setNewCustomer((prev) => ({
      ...prev,
      Name: prev.Name || (isNumber ? "" : typed),
      Mobile: prev.Mobile || (isNumber ? (normalizeMobile(digits) ?? digits) : ""),
    }));
    setCreatingCustomer(true);
  };

  const createCustomer = useMutation({ mutationFn: saveCustomer });

  /** One at a time, after the complaint is saved. A failure never undoes the complaint. */
  const uploadStaged = async (ticketId: number) => {
    let failed = 0;
    for (const { size: _size, ...file } of files) {
      try {
        await uploadAttachment({ Entity: "ticket", EntityId: ticketId, file });
      } catch {
        failed += 1;
      }
    }
    if (failed) toast.error(`${failed} file(s) failed to upload — add them from the complaint`);
  };

  const save = useMutation({
    mutationFn: saveTicket,
    onSuccess: async (response) => {
      if (!response.success) {
        setError(response.message || "Could not save this complaint.");
        return;
      }
      const newId = response.data?.Id;
      if (!ticket && files.length) {
        if (newId) await uploadStaged(newId);
        else toast.error(`${files.length} file(s) failed to upload — add them from the complaint`);
      }
      void queryClient.invalidateQueries({ queryKey: ["tickets"] });
      if (ticket) void queryClient.invalidateQueries({ queryKey: ["ticket", ticket.Id] });
      navigation.goBack();
    },
    onError: (err) => setError(apiErrorMessage(err, "Could not save this complaint. Check your connection.")),
  });

  /**
   * Saves the typed-in customer and returns it, or null after saying why. Not
   * rolled back if the ticket then fails: tblCustomer is a real record, and
   * `pick` collapses the block onto it, so a retry sends the ticket alone. The
   * SP's 409 "Another customer already has this mobile number" is the answer.
   */
  const createTypedCustomer = async (): Promise<PickedCustomer | null> => {
    const fields = {
      Name: newCustomer.Name.trim(),
      ContactPerson: newCustomer.ContactPerson.trim() || null,
      Mobile: newCustomer.Mobile.trim() || null,
      Email: newCustomer.Email.trim() || null,
      Address: newCustomer.Address.trim() || null,
      City: newCustomer.City.trim() || null,
    };
    try {
      const response = await createCustomer.mutateAsync({ ...fields, BranchId: showOffice ? office : null });
      const id = response.data?.Id;
      if (!response.success || !id) {
        setError(response.message || "Could not save that customer.");
        return null;
      }
      const row: PickedCustomer = { Id: id, ...fields };
      pick(row);
      void queryClient.invalidateQueries({ queryKey: ["customers"] });
      return row;
    } catch (err) {
      setError(apiErrorMessage(err, "Could not save that customer."));
      return null;
    }
  };

  const pickFiles = async () => {
    const picked = await DocumentPicker.getDocumentAsync({
      // Copy into the app's cache: the original may live behind a provider URI.
      copyToCacheDirectory: true,
      multiple: true,
      type: PICKER_TYPES,
    });
    if (picked.canceled || !picked.assets) return;
    // The attachments list's gate: type, then size; named so upload.js takes it.
    const { files: ok, refused } = screenPicked(picked.assets);
    if (refused.length) setError(refused.join("\n"));
    setFiles((prev) => [...prev, ...ok.map((f) => ({ ...f, size: picked.assets!.find((a) => a.uri === f.uri)?.size }))]);
  };

  const submit = async () => {
    const subjectText = subject.trim();
    const descriptionText = description.trim();

    if (!customer && !creatingCustomer) return setError("Pick the customer, or add a new one.");
    if (!customer && creatingCustomer) {
      if (!newCustomer.Name.trim()) return setError("The new customer needs a name.");
      if (!newCustomer.Mobile.trim() && !newCustomer.Email.trim()) {
        return setError("A mobile number or an email is required for a new customer.");
      }
      const email = newCustomer.Email.trim();
      if (email && !LOOKS_LIKE_AN_EMAIL.test(email)) return setError("That email does not look right.");
      // The mobile is checked by sp_SaveCustomer's 400, word for word as the web.
    }
    // Customer + subject are all the SP needs (web: TicketCreateModal).
    if (!subjectText) return setError("What is the complaint about?");

    const missing = missingRequired(fieldDefs, values);
    if (missing.length) return setError(`${missing[0]!.Label} is required.`);

    setError(null);

    // Customer first — a ticket needs a row to point at.
    const chosen = customer ?? (await createTypedCustomer());
    if (!chosen) return;

    save.mutate({
      Id: ticket?.Id ?? 0,
      CustomerId: chosen.Id,
      Subject: subjectText,
      // Read off `chosen`, not state: on the create path the prefill `pick`
      // just queued has not rendered yet.
      ContactPerson: contactPerson.trim() || chosen.ContactPerson || chosen.Name || null,
      Contact: contact.trim() || chosen.Mobile || chosen.Email || null,
      ChannelId: channel,
      CategoryId: category,
      Priority: priority,
      ProductId: product,
      AssignedTo: assignee,
      Description: descriptionText || null,
      CustomJSON: serialiseCustomFields(fieldDefs, values),
      // LinkedLeadId stays out: the SP keeps it with ISNULL(@LinkedLeadId, …).
    });
  };

  const busy = save.isPending || createCustomer.isPending;

  // ------------------------------------------------------------ customer --
  // Three states, one at a time: picked, creating, or searching (E 12's
  // dropdown, its last row "Add new customer").
  const customerBlock = customer ? (
    <ListGroup>
      <ListRow
        noSeparator
        badge={{ tone: "peach", icon: Building2, size: 36 }}
        title={customer.Name || "Unnamed customer"}
        meta={contactLine(customer)}
        trailing={
          <Pressable onPress={changeCustomer} hitSlop={spacing[2]} accessibilityRole="button" accessibilityLabel="Change customer">
            <X size={18} color={colors.textMuted} />
          </Pressable>
        }
      />
    </ListGroup>
  ) : creatingCustomer ? (
    <View style={styles.stack}>
      <Input label="Name" required value={newCustomer.Name} onChangeText={(v) => setNewField("Name", v)} placeholder="Shop, company or person" autoFocus />
      <Input label="Contact person" value={newCustomer.ContactPerson} onChangeText={(v) => setNewField("ContactPerson", v)} placeholder="Who to ask for" />
      <MobileInput label="Mobile" value={newCustomer.Mobile} onChangeText={(v) => setNewField("Mobile", v)} hint="A mobile number or an email is required." />
      <Input
        label="Email"
        value={newCustomer.Email}
        onChangeText={(v) => setNewField("Email", v)}
        placeholder="name@company.com"
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
      />
      <Input label="Address" value={newCustomer.Address} onChangeText={(v) => setNewField("Address", v)} placeholder="Area, street" />
      <Input label="City" value={newCustomer.City} onChangeText={(v) => setNewField("City", v)} placeholder="Town or city" />
      {showOffice ? (
        <Select
          label="Office"
          value={office}
          options={officeOptions}
          onChange={(v) => setOffice(v as number)}
          placeholder="Your office"
          sheetTitle="Which office is the customer with?"
        />
      ) : null}
      <Button title="Search instead" variant="ghost" size="sm" icon={Search} onPress={() => setCreatingCustomer(false)} style={styles.link} />
    </View>
  ) : (
    <View>
      <Input
        value={search}
        onChangeText={setSearch}
        placeholder="Search customer (mobile or name)"
        leftIcon={Search}
        // E 12: a muted X inside the field clears the term.
        right={
          search ? (
            <Pressable onPress={() => setSearch("")} hitSlop={spacing[3]} accessibilityRole="button" accessibilityLabel="Clear search">
              <X size={18} color={colors.textMuted} />
            </Pressable>
          ) : null
        }
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
        autoFocus={!editing}
      />
      <ListGroup style={styles.dropdown} testID="customer-matches">
        {rows.map((row, i) => (
          <ListRow
            key={row.Id}
            noSeparator={i === 0}
            badge={{ tone: "peach", icon: Building2, size: 36 }}
            title={row.Name}
            meta={[contactLine(row), row.BranchName, row.OpenTickets ? `${row.OpenTickets} open` : null].filter(Boolean).join(" · ")}
            onPress={() => pick(row)}
          />
        ))}
        {term.length >= 2 && !matches.isFetching && !rows.length ? (
          <Text variant="meta" style={styles.noMatch}>{`Nobody matches “${term}”.`}</Text>
        ) : null}
        <Pressable
          onPress={startNewCustomer}
          accessibilityRole="button"
          style={({ pressed }) => [styles.addRow, pressed && styles.pressed]}
        >
          <StatusBadge size={36} tone="indigo" icon={UserPlus} />
          <Text variant="rowTitle" color="primary" numberOfLines={1} style={styles.flex}>
            {term ? `Add new customer "${term}"` : "Add new customer"}
          </Text>
        </Pressable>
      </ListGroup>
    </View>
  );

  // --------------------------------------------------------- attachments --
  const attachments = editing ? null : (
    <View style={styles.field}>
      <FieldLabel label={`Attachments · ${files.length}`} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.files}>
        {files.map((f, i) => {
          const remove = () => setFiles((prev) => prev.filter((_, j) => j !== i));
          if (f.type?.startsWith("image/")) {
            return (
              <View key={`${f.uri}-${i}`} style={styles.thumb}>
                <Image source={{ uri: f.uri }} style={styles.thumbImage} accessibilityLabel={f.name} />
                <Pressable onPress={remove} hitSlop={spacing[2]} accessibilityRole="button" accessibilityLabel={`Remove ${f.name}`} style={styles.thumbX}>
                  <X size={12} strokeWidth={2.5} color={colors.textOnBrand} />
                </Pressable>
              </View>
            );
          }
          const m = fileMeta(f.name, f.type ?? null);
          return (
            <Card key={`${f.uri}-${i}`} padded={false} gap={0} style={styles.fileCard}>
              <StatusBadge tone={m.tone} icon={m.Icon} />
              <View style={styles.fileText}>
                <Text variant="metaStrong" color="text" numberOfLines={1}>{f.name}</Text>
                <Text variant="label">{[m.kind, humanSize(f.size)].filter(Boolean).join(" · ")}</Text>
              </View>
              <Pressable onPress={remove} hitSlop={spacing[2]} accessibilityRole="button" accessibilityLabel={`Remove ${f.name}`}>
                <X size={16} color={colors.textMuted} />
              </Pressable>
            </Card>
          );
        })}
        <Pressable onPress={() => void pickFiles()} accessibilityRole="button" accessibilityLabel="Attach files" style={styles.addTile}>
          <Paperclip size={20} color={colors.primary} />
        </Pressable>
      </ScrollView>
    </View>
  );

  return (
    <Screen band>
      <Band
        variant="record"
        titleVariant="h2"
        title={editing ? "Edit complaint" : "New complaint"}
        subtitle={ticket?.TicketNo}
        backIcon="close"
        onBack={navigation.goBack}
        actions={officeName ? <Text variant="meta" color="onBandMuted" numberOfLines={1}>{officeName}</Text> : null}
      />

      <BandSheet padded={false}>
        <ScrollView
          contentContainerStyle={[styles.content, { paddingHorizontal: layout.gutter }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={[styles.column, { maxWidth: layout.contentMaxWidth }]}>
            <View style={styles.field}>
              <FieldLabel label="Customer" required />
              {customerBlock}
            </View>

            <View style={styles.field}>
              <Input label="Subject" required value={subject} onChangeText={setSubject} placeholder="One line — what is wrong" />
            </View>

            <View style={styles.field}>
              <Input
                label="Description"
                value={description}
                onChangeText={setDescription}
                placeholder="The complaint in the customer's words"
                multiline
                numberOfLines={3}
              />
            </View>

            <View style={styles.field}>
              <FieldRow>
                <View style={styles.flex}>
                  <Select
                    label="Category"
                    value={category}
                    options={asOptions(categories)}
                    onChange={(v) => setCategory(v as number)}
                    placeholder="Not set"
                    sheetTitle="What kind of complaint?"
                  />
                </View>
                <View style={styles.flex}>
                  <Select
                    label="Priority"
                    value={priority}
                    options={priorityOptions}
                    onChange={(v) => setPriority(v as number)}
                    placeholder="Not set"
                    sheetTitle="How urgent is it?"
                  />
                </View>
              </FieldRow>
              <Text variant="small" style={styles.hint}>{dueHint}</Text>
            </View>

            {attachments}

            <GroupHeader title="More details" />
            <View style={styles.stack}>
              {/* Optional: the channel list is company data and can be empty. */}
              <Select
                label="Channel"
                value={channel}
                options={asOptions(channels)}
                onChange={(v) => setChannel(v as number)}
                placeholder="Not recorded"
                sheetTitle="How did it come in?"
              />
              <Select label="Product" value={product} options={productOptions} onChange={(v) => setProduct(v as number)} placeholder="None" sheetTitle="Which product?" />
              <Input label="Reported by" value={contactPerson} onChangeText={setContactPerson} placeholder="Who called or wrote in" />
              <Input
                label="Phone or email"
                value={contact}
                onChangeText={setContact}
                placeholder="How to reach them back"
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
              />
              {/* Create only: on update the SP ignores AssignedTo — handing it
                  on is Transfer's job, on the record. */}
              {editing ? null : (
                <Select
                  label="Assign to"
                  value={assignee}
                  options={assigneeOptions}
                  onChange={(v) => setAssignee(v as number)}
                  placeholder="Nobody yet"
                  sheetTitle="Who picks this up?"
                />
              )}
              {fieldDefs.map((def) => (
                <DynamicField key={def.Id} field={def} value={values[def.Id] ?? ""} onChange={(next) => setField(def.Id, next)} />
              ))}
            </View>

            {error ? <Text variant="label" color="dangerText" style={styles.error}>{error}</Text> : null}
          </View>
        </ScrollView>
      </BandSheet>

      {/* E 12: the one pill at the foot; no bottom bar on a form. */}
      <View style={[styles.footer, elevation.footer, { paddingBottom: insets.bottom + 10 }]}>
        <View style={[styles.column, { maxWidth: layout.contentMaxWidth }]}>
          <Button
            title={editing ? "Save changes" : "Submit complaint"}
            // `submit` may create the customer first and handles its own failures.
            onPress={() => void submit()}
            loading={busy}
            fullWidth
          />
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingTop: metrics.sheetPadTop, paddingBottom: spacing[8] },
  column: { width: "100%", alignSelf: "center" },
  field: { marginBottom: metrics.fieldGap + 2 },
  stack: { gap: metrics.fieldGap + 2 },
  flex: { flex: 1, minWidth: 0 },
  hint: { marginTop: metrics.inlineGap },
  link: { alignSelf: "flex-start" },
  dropdown: { marginTop: metrics.inlineGap, ...elevation.popover },
  noMatch: { paddingVertical: 9, paddingHorizontal: spacing[3] },
  addRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: metrics.rowGap,
    paddingVertical: 9,
    paddingHorizontal: spacing[3],
    backgroundColor: colors.fieldTint,
  },
  pressed: { backgroundColor: colors.primarySoft },
  files: { gap: spacing[2], height: 60 },
  thumb: { width: 60, height: 60 },
  thumbImage: { width: 60, height: 60, borderRadius: radius.badgeLg, backgroundColor: colors.surfaceSunken },
  thumbX: {
    position: "absolute",
    right: spacing[1],
    top: spacing[1],
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.text,
    alignItems: "center",
    justifyContent: "center",
  },
  fileCard: { width: 220, flexDirection: "row", alignItems: "center", gap: 10, padding: 10 },
  fileText: { flex: 1, minWidth: 0 },
  addTile: {
    width: 52,
    height: 60,
    borderRadius: radius.badgeLg,
    backgroundColor: colors.primarySoft,
    alignItems: "center",
    justifyContent: "center",
  },
  error: { marginTop: spacing[3] },
  footer: { backgroundColor: colors.surface, paddingTop: 10, paddingHorizontal: spacing[4] },
});
