import { useDeferredValue, useMemo, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, Lock, Search, UserPlus } from "lucide-react-native";
import type {
  StackNavigationProp,
  StackScreenProps,
} from "@react-navigation/stack";

import { fetchCustomFields } from "../../api/configQueries";
import { fetchCustomers, saveCustomer } from "../../api/customerQueries";
import { fetchProducts } from "../../api/productQueries";
import { fetchTicketDetail, saveTicket } from "../../api/ticketQueries";
import { apiErrorMessage } from "../../api/errors";
import type { RootStackParamList } from "../../navigation/RootNavigator";
import type {
  Customer,
  CustomFieldDef,
  Ticket,
  TicketDetail,
} from "../../types/api";
import { colors, spacing, SCREEN_PADDING } from "../../theme";
import {
  Button,
  Card,
  DynamicField,
  Input,
  Screen,
  ScreenHeader,
  ScreenLoader,
  Select,
  Text,
} from "../../ui";
import {
  asOptions,
  blankDraft,
  draftFromValues,
  missingRequired,
  serialiseCustomFields,
  tatLabel,
} from "./ticketHelpers";
import { useTicketRefData } from "./useTicketRefData";

type Props = StackScreenProps<RootStackParamList, "ComplaintForm">;
type Nav = StackNavigationProp<RootStackParamList, "ComplaintForm">;

/**
 * What the form needs to know about the chosen customer — and all it CAN know
 * about a just-created one, where the client holds the four fields it typed
 * plus the returned Id and nothing else. A full `Customer` here would be a
 * type that lies at exactly the moment the data is thinnest.
 */
type PickedCustomer = Pick<
  Customer,
  "Id" | "Name" | "ContactPerson" | "Mobile" | "Email"
>;

/** A mobile number as typed: digits, a leading +, and the separators people use. */
const LOOKS_LIKE_A_NUMBER = /^[0-9+\s-]+$/;

/**
 * Log or edit a complaint.
 *
 * The outer component only waits for the row; the fields live in a child that
 * seeds its state from props, so no effect copies server data into local state
 * and a background refetch cannot overwrite what someone is typing. Same shape
 * as TaskFormScreen.
 */
export default function ComplaintFormScreen({ route, navigation }: Props) {
  const ticketId = route.params?.ticketId;
  const editing = ticketId != null;

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["ticket", ticketId],
    queryFn: () => fetchTicketDetail({ TicketId: ticketId! }),
    enabled: editing,
  });

  if (editing && (isLoading || isError)) {
    return (
      <Screen>
        <ScreenHeader title="Edit complaint" onBack={navigation.goBack} />
        <ScreenLoader failed={isError} onRetry={refetch} />
      </Screen>
    );
  }

  if (editing && !data?.ticket) {
    return (
      <Screen>
        <ScreenHeader title="Edit complaint" onBack={navigation.goBack} />
        <View style={styles.centre}>
          <Lock size={30} color={colors.textMuted} />
          <Text variant="h3">Complaint not available</Text>
          <Text variant="secondary" align="center">
            It may have been deleted, or it belongs to a branch you cannot see.
          </Text>
        </View>
      </Screen>
    );
  }

  return (
    <ComplaintForm
      navigation={navigation}
      ticket={data?.ticket ?? null}
      detail={data ?? null}
    />
  );
}

interface ComplaintFormProps {
  navigation: Nav;
  ticket: Ticket | null;
  detail: TicketDetail | null;
}

function ComplaintForm({ navigation, ticket, detail }: ComplaintFormProps) {
  const queryClient = useQueryClient();
  const editing = ticket != null;

  // --- the customer -------------------------------------------------------
  // On edit this is seeded from the ticket row: sp_FetchTicketDetail RS1
  // carries the customer's own columns, so the block opens collapsed on the
  // right customer without a second request.
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
  // One object rather than four useStates — four setters that always move
  // together are one piece of state wearing a disguise.
  const [newCustomer, setNewCustomer] = useState({
    Name: "",
    ContactPerson: "",
    Mobile: "",
    Email: "",
  });

  // --- the complaint ------------------------------------------------------
  const [subject, setSubject] = useState(ticket?.Subject ?? "");
  const [contactPerson, setContactPerson] = useState(ticket?.ContactPerson ?? "");
  const [contact, setContact] = useState(ticket?.Contact ?? "");
  const [channel, setChannel] = useState<number | null>(ticket?.ChannelId ?? null);
  const [category, setCategory] = useState<number | null>(ticket?.CategoryId ?? null);
  const [priority, setPriority] = useState<number | null>(ticket?.Priority ?? null);
  const [product, setProduct] = useState<number | null>(ticket?.ProductId ?? null);
  // Create-only, so it is never seeded from the ticket: sp_SaveTicket does not
  // touch AssignedTo on update, and reassigning is transferTicket's job.
  const [assignee, setAssignee] = useState<number | null>(null);
  const [description, setDescription] = useState(ticket?.Description ?? "");
  const [draft, setDraft] = useState<Record<number, string | boolean>>(() =>
    detail?.fields.length ? draftFromValues(detail.fields) : {},
  );
  const [error, setError] = useState<string | null>(null);

  // Pickers. No statuses: a complaint's status is never set from this form —
  // it is seeded `open` on insert and moved only by sp_SetTicketStatus.
  const { categories, priorities, channels, users } = useTicketRefData();

  const { data: defs } = useQuery({
    queryKey: ["custom-fields", "ticket"],
    queryFn: () => fetchCustomFields({ Entity: "ticket" }),
  });
  const { data: products } = useQuery({
    queryKey: ["products"],
    queryFn: fetchProducts,
  });

  // Deferred rather than debounced with a timer: React keeps the previous
  // results on screen while the next request resolves, and there is no timeout
  // to clean up. Two characters minimum — one letter would ask the server for
  // most of the company.
  const term = useDeferredValue(search.trim());
  const matches = useQuery({
    queryKey: ["customers", term],
    queryFn: () => fetchCustomers({ SearchTerm: term, PageSize: 8 }),
    enabled: !customer && !creatingCustomer && term.length >= 2,
  });
  const rows = matches.data ?? [];

  const fieldDefs: CustomFieldDef[] = useMemo(() => defs ?? [], [defs]);

  // A definition the ticket has no stored value for still needs a controlled
  // entry, or its input flips from uncontrolled on first keystroke.
  const values = useMemo(
    () => ({ ...blankDraft(fieldDefs), ...draft }),
    [fieldDefs, draft],
  );

  const setField = (fieldId: number, value: string | boolean) =>
    setDraft((prev) => ({ ...prev, [fieldId]: value }));

  const setNewField = (key: keyof typeof newCustomer, value: string) =>
    setNewCustomer((prev) => ({ ...prev, [key]: value }));

  // The TAT is the whole reason priority matters here — it is what sets DueAt,
  // and therefore what puts the complaint at the top of somebody's Overdue
  // queue. Showing it at the point of choosing is the difference between
  // picking a word and picking a deadline.
  const priorityOptions = useMemo(
    () =>
      priorities.map((p) => {
        const tat = tatLabel(p.TatHours);
        return {
          value: p.Id,
          label: p.Value,
          sublabel: tat ? `Due in ${tat}` : "No due time",
        };
      }),
    [priorities],
  );

  const productOptions = useMemo(
    () =>
      (products ?? []).map((p) => ({
        value: p.Id,
        label: p.Name,
        sublabel: p.Code ?? undefined,
      })),
    [products],
  );

  const assigneeOptions = useMemo(
    () =>
      users.map((u) => ({
        value: u.Id,
        label: u.FullName,
        sublabel: [u.JobTitle, u.BranchName].filter(Boolean).join(" · ") || undefined,
      })),
    [users],
  );

  /**
   * Choosing a customer also answers "reported by" — for most complaints the
   * caller IS the contact on the customer record. Prefilled, never
   * overwritten: whatever has already been typed is the agent's, and a second
   * pick must not wipe it.
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

  /**
   * Carry the typed search into the create form. Spec §1 opens with "agent
   * types the customer's mobile"; making them type it a second time is the
   * friction this flow exists to remove. Digits go to Mobile, words to Name.
   */
  const startNewCustomer = () => {
    const typed = search.trim();
    const isNumber = LOOKS_LIKE_A_NUMBER.test(typed);
    setNewCustomer((prev) => ({
      ...prev,
      Name: prev.Name || (isNumber ? "" : typed),
      Mobile: prev.Mobile || (isNumber ? typed : ""),
    }));
    setCreatingCustomer(true);
  };

  const createCustomer = useMutation({ mutationFn: saveCustomer });

  const save = useMutation({
    mutationFn: saveTicket,
    onSuccess: (response) => {
      if (!response.success) {
        setError(response.message || "Could not save this complaint.");
        return;
      }
      queryClient.invalidateQueries({ queryKey: ["tickets"] });
      if (ticket) queryClient.invalidateQueries({ queryKey: ["ticket", ticket.Id] });
      navigation.goBack();
    },
    onError: (err) =>
      setError(
        apiErrorMessage(err, "Could not save this complaint. Check your connection."),
      ),
  });

  /**
   * Saves the typed-in customer and returns it, or null after saying why.
   *
   * It is deliberately NOT rolled back if the ticket then fails: tblCustomer is
   * a real record, not part of this draft. `pick` collapses the block onto it,
   * so the retry sends the ticket alone against a customer that already exists.
   *
   * The 409 "Another customer already has this mobile number" arrives here as a
   * rejection, and the SP's own sentence is the right answer — it tells the
   * agent to go back and search rather than to try a different spelling.
   */
  const createTypedCustomer = async (): Promise<PickedCustomer | null> => {
    const fields = {
      Name: newCustomer.Name.trim(),
      ContactPerson: newCustomer.ContactPerson.trim() || null,
      Mobile: newCustomer.Mobile.trim() || null,
      Email: newCustomer.Email.trim() || null,
    };
    try {
      const response = await createCustomer.mutateAsync(fields);
      const id = response.data?.Id;
      if (!response.success || !id) {
        setError(response.message || "Could not save that customer.");
        return null;
      }
      const row: PickedCustomer = { Id: id, ...fields };
      pick(row);
      queryClient.invalidateQueries({ queryKey: ["customers"] });
      return row;
    } catch (err) {
      setError(apiErrorMessage(err, "Could not save that customer."));
      return null;
    }
  };

  const submit = async () => {
    const subjectText = subject.trim();
    const descriptionText = description.trim();

    if (!customer && !creatingCustomer) {
      return setError("Pick the customer, or add a new one.");
    }
    if (!customer && creatingCustomer) {
      if (!newCustomer.Name.trim()) return setError("The new customer needs a name.");
      if (!newCustomer.Mobile.trim() && !newCustomer.Email.trim()) {
        return setError("A mobile number or an email is required for a new customer.");
      }
    }
    if (!subjectText) return setError("What is the complaint about?");
    if (!category) return setError("Pick a category.");
    if (!priority) return setError("Pick a priority.");
    if (!descriptionText) return setError("Describe the complaint.");

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
      // Read off `chosen`, not out of state: on the create path the prefill
      // that `pick` just queued has not rendered yet.
      ContactPerson: contactPerson.trim() || chosen.ContactPerson || chosen.Name || null,
      Contact: contact.trim() || chosen.Mobile || chosen.Email || null,
      ChannelId: channel,
      CategoryId: category,
      Priority: priority,
      ProductId: product,
      AssignedTo: assignee,
      Description: descriptionText,
      CustomJSON: serialiseCustomFields(fieldDefs, values),
      // LinkedLeadId stays out. The SP updates it as
      // ISNULL(@LinkedLeadId, LinkedLeadId) precisely so a client that cannot
      // see the lead link cannot sever it.
    });
  };

  const busy = save.isPending || createCustomer.isPending;

  return (
    <Screen>
      <ScreenHeader
        title={editing ? "Edit complaint" : "Log a complaint"}
        subtitle={ticket?.TicketNo}
        tint="danger"
        onBack={navigation.goBack}
      />

      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* ---------------------------------------------------- customer --
            Three states, one at a time: picked (collapsed), creating, or
            searching. A complaint without a customer row cannot be saved at
            all now, so this is the first thing the screen asks for. */}
        <View style={styles.block}>
          <Text variant="overline" color="textMuted">
            Customer
          </Text>

          {customer ? (
            <Card>
              <View style={styles.pickedRow}>
                <Building2 size={18} color={colors.textMuted} />
                <View style={styles.pickedText}>
                  <Text variant="bodyStrong" numberOfLines={1}>
                    {customer.Name || "Unnamed customer"}
                  </Text>
                  <Text variant="caption" color="textMuted" numberOfLines={1}>
                    {[customer.Mobile, customer.Email].filter(Boolean).join(" · ") ||
                      "No contact details"}
                  </Text>
                </View>
                <Button
                  title="Change"
                  variant="ghost"
                  size="sm"
                  onPress={changeCustomer}
                />
              </View>
            </Card>
          ) : creatingCustomer ? (
            <>
              <Input
                label="Name"
                required
                value={newCustomer.Name}
                onChangeText={(v) => setNewField("Name", v)}
                placeholder="Shop, company or person"
                autoFocus
              />
              <Input
                label="Contact person"
                value={newCustomer.ContactPerson}
                onChangeText={(v) => setNewField("ContactPerson", v)}
                placeholder="Who to ask for"
              />
              <Input
                label="Mobile"
                value={newCustomer.Mobile}
                onChangeText={(v) => setNewField("Mobile", v)}
                placeholder="10-digit number"
                keyboardType="phone-pad"
                hint="A mobile number or an email is required."
              />
              <Input
                label="Email"
                value={newCustomer.Email}
                onChangeText={(v) => setNewField("Email", v)}
                placeholder="name@company.com"
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
              />
              <Button
                title="Search instead"
                variant="ghost"
                size="sm"
                icon={Search}
                onPress={() => setCreatingCustomer(false)}
                style={styles.link}
              />
            </>
          ) : (
            <>
              <Input
                value={search}
                onChangeText={setSearch}
                placeholder="Search customer (mobile or name)"
                leftIcon={Search}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="search"
                autoFocus={!editing}
              />

              {rows.map((row) => (
                <Card key={row.Id} onPress={() => pick(row)} gap={1}>
                  <Text variant="bodyStrong" numberOfLines={1}>
                    {row.Name}
                  </Text>
                  <Text variant="caption" color="textMuted" numberOfLines={1}>
                    {[
                      row.Mobile,
                      row.City,
                      row.OpenTickets ? `${row.OpenTickets} open` : null,
                    ]
                      .filter(Boolean)
                      .join(" · ") || "No contact details"}
                  </Text>
                </Card>
              ))}

              {term.length >= 2 && !matches.isFetching && !rows.length ? (
                <Text variant="caption" color="textMuted">
                  Nobody matches “{term}”. Add them as a new customer.
                </Text>
              ) : null}

              <Button
                title="New customer"
                variant="ghost"
                size="sm"
                icon={UserPlus}
                onPress={startNewCustomer}
                style={styles.link}
              />
            </>
          )}
        </View>

        {/* --------------------------------------------------- complaint -- */}
        <View style={styles.block}>
          <Text variant="overline" color="textMuted">
            Complaint
          </Text>

          <Input
            label="Subject"
            required
            value={subject}
            onChangeText={setSubject}
            placeholder="One line — what is wrong"
          />

          <Select
            label="Category"
            required
            value={category}
            options={asOptions(categories)}
            onChange={(v) => setCategory(v as number)}
            sheetTitle="What kind of complaint?"
          />

          <Select
            label="Priority"
            required
            value={priority}
            options={priorityOptions}
            onChange={(v) => setPriority(v as number)}
            sheetTitle="How urgent is it?"
          />

          {/* Optional: the channel list is company data now and can be empty,
              and @ChannelId is nullable. Same for Product. */}
          <Select
            label="Channel"
            value={channel}
            options={asOptions(channels)}
            onChange={(v) => setChannel(v as number)}
            placeholder="Not recorded"
            sheetTitle="How did it come in?"
          />

          <Select
            label="Product"
            value={product}
            options={productOptions}
            onChange={(v) => setProduct(v as number)}
            placeholder="None"
            sheetTitle="Which product?"
          />

          <Input
            label="Reported by"
            value={contactPerson}
            onChangeText={setContactPerson}
            placeholder="Who called or wrote in"
          />

          <Input
            label="Phone or email"
            value={contact}
            onChangeText={setContact}
            placeholder="How to reach them back"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
          />

          {/* Create only. On update the SP ignores AssignedTo entirely, so an
              assignee picker here would be a control that silently does
              nothing — handing it on is Transfer's job, on the detail screen. */}
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

          <Input
            label="What happened"
            required
            value={description}
            onChangeText={setDescription}
            placeholder="The complaint in the customer's words"
            multiline
            numberOfLines={4}
          />
        </View>

        {fieldDefs.length ? (
          <View style={styles.block}>
            <Text variant="overline" color="textMuted">
              Extra details
            </Text>
            {fieldDefs.map((def) => (
              <DynamicField
                key={def.Id}
                field={def}
                value={values[def.Id] ?? ""}
                onChange={(next) => setField(def.Id, next)}
              />
            ))}
          </View>
        ) : null}

        {error ? (
          <Text variant="caption" color="danger">
            {error}
          </Text>
        ) : null}

        <View style={styles.actions}>
          <Button
            title={editing ? "Save changes" : "Log complaint"}
            // `submit` is async (it may have to create the customer first) and
            // handles its own failures, so the promise is deliberately dropped.
            onPress={() => void submit()}
            loading={busy}
            fullWidth
          />
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  centre: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing[2],
    padding: spacing[6],
  },
  content: {
    padding: SCREEN_PADDING,
    paddingBottom: spacing[20],
    gap: spacing[6],
  },
  block: { gap: spacing[4] },
  pickedRow: { flexDirection: "row", alignItems: "center", gap: spacing[3] },
  pickedText: { flex: 1, gap: spacing[1] },
  // A ghost button in a column stretches to the full width by default, which
  // reads as a second primary action. These are links.
  link: { alignSelf: "flex-start" },
  actions: { paddingTop: spacing[2] },
});
