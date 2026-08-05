import { useMemo, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Lock } from "lucide-react-native";
import type {
  StackNavigationProp,
  StackScreenProps,
} from "@react-navigation/stack";

import { fetchCustomFields, fetchLookups, LOOKUP_KIND } from "../../api/configQueries";
import { fetchTicketDetail, saveTicket } from "../../api/ticketQueries";
import { apiErrorMessage } from "../../api/errors";
import { fetchUserDirectory } from "../../api/userQueries";
import type { RootStackParamList } from "../../navigation/RootNavigator";
import type { CustomFieldDef, Ticket, TicketDetail } from "../../types/api";
import { colors, spacing, SCREEN_PADDING } from "../../theme";
import {
  Button,
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
  CHANNELS,
  draftFromValues,
  missingRequired,
  serialiseCustomFields,
} from "./ticketHelpers";

type Props = StackScreenProps<RootStackParamList, "ComplaintForm">;
type Nav = StackNavigationProp<RootStackParamList, "ComplaintForm">;

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

  const [customerName, setCustomerName] = useState(ticket?.CustomerName ?? "");
  const [contactPerson, setContactPerson] = useState(ticket?.ContactPerson ?? "");
  const [contact, setContact] = useState(ticket?.Contact ?? "");
  const [channel, setChannel] = useState<string | null>(ticket?.Channel ?? null);
  const [category, setCategory] = useState<number | null>(ticket?.CategoryId ?? null);
  const [priority, setPriority] = useState<number | null>(ticket?.Priority ?? null);
  const [assignee, setAssignee] = useState<number | null>(ticket?.AssignedTo ?? null);
  const [description, setDescription] = useState(ticket?.Description ?? "");
  const [draft, setDraft] = useState<Record<number, string | boolean>>(() =>
    detail?.fields.length ? draftFromValues(detail.fields) : {},
  );
  const [error, setError] = useState<string | null>(null);

  const { data: categories } = useQuery({
    queryKey: ["lookups", LOOKUP_KIND.ticketCategory],
    queryFn: () => fetchLookups({ Kind: LOOKUP_KIND.ticketCategory }),
  });
  const { data: priorities } = useQuery({
    queryKey: ["lookups", LOOKUP_KIND.priority],
    queryFn: () => fetchLookups({ Kind: LOOKUP_KIND.priority }),
  });
  const { data: directory } = useQuery({
    queryKey: ["users", "directory"],
    queryFn: () => fetchUserDirectory(),
  });
  const { data: defs } = useQuery({
    queryKey: ["custom-fields", "ticket"],
    queryFn: () => fetchCustomFields({ Entity: "ticket" }),
  });

  const fieldDefs: CustomFieldDef[] = useMemo(() => defs ?? [], [defs]);

  // A definition the ticket has no stored value for still needs a controlled
  // entry, or its input flips from uncontrolled on first keystroke.
  const values = useMemo(
    () => ({ ...blankDraft(fieldDefs), ...draft }),
    [fieldDefs, draft],
  );

  const setField = (fieldId: number, value: string | boolean) =>
    setDraft((prev) => ({ ...prev, [fieldId]: value }));

  const assigneeOptions = useMemo(
    () =>
      (directory ?? []).map((user) => ({
        value: user.Id,
        label: user.FullName,
        sublabel: user.JobTitle ?? user.Username ?? undefined,
      })),
    [directory],
  );

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

  const submit = () => {
    if (!customerName.trim()) return setError("Who is the customer?");
    if (!contactPerson.trim()) return setError("Who reported it?");
    if (!contact.trim()) return setError("A phone number or email is needed.");
    if (!channel) return setError("How did it come in?");
    if (!category) return setError("Pick a category.");
    if (!priority) return setError("Pick a priority.");
    if (!description.trim()) return setError("Describe the complaint.");

    const missing = missingRequired(fieldDefs, values);
    if (missing.length) return setError(`${missing[0]!.Label} is required.`);

    setError(null);

    save.mutate({
      Id: ticket?.Id ?? 0,
      CustomerName: customerName.trim(),
      ContactPerson: contactPerson.trim(),
      Contact: contact.trim(),
      Channel: channel,
      CategoryId: category,
      Priority: priority,
      AssignedTo: assignee,
      Description: description.trim(),
      CustomJSON: serialiseCustomFields(fieldDefs, values),
      // StageId stays null on purpose. On create the SP seeds the first `open`
      // stage; on update it does ISNULL(@StageId, StageId), so the ticket keeps
      // the stage it is in. Moving one is moveTicketStage's job, never this.
    });
  };

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
        <Input
          label="Customer"
          required
          value={customerName}
          onChangeText={setCustomerName}
          placeholder="Company or account name"
          autoFocus={!editing}
        />

        <Input
          label="Reported by"
          required
          value={contactPerson}
          onChangeText={setContactPerson}
          placeholder="Who called or wrote in"
        />

        <Input
          label="Phone or email"
          required
          value={contact}
          onChangeText={setContact}
          placeholder="How to reach them back"
          autoCapitalize="none"
          keyboardType="email-address"
        />

        <Select
          label="Channel"
          required
          value={channel}
          options={CHANNELS.map((c) => ({ value: c.value, label: c.label }))}
          onChange={(v) => setChannel(v as string)}
          sheetTitle="How did it come in?"
        />

        <Select
          label="Category"
          required
          value={category}
          options={asOptions(categories)}
          onChange={(v) => setCategory(v as number)}
        />

        <Select
          label="Priority"
          required
          value={priority}
          options={asOptions(priorities)}
          onChange={(v) => setPriority(v as number)}
        />

        <Select
          label="Assign to"
          value={assignee}
          options={assigneeOptions}
          onChange={(v) => setAssignee(v as number)}
          placeholder="Nobody yet"
          sheetTitle="Who picks this up?"
        />

        <Input
          label="What happened"
          required
          value={description}
          onChangeText={setDescription}
          placeholder="The complaint in the customer's words"
          multiline
          numberOfLines={4}
        />

        {fieldDefs.map((def) => (
          <DynamicField
            key={def.Id}
            field={def}
            value={values[def.Id] ?? ""}
            onChange={(next) => setField(def.Id, next)}
          />
        ))}

        {error ? (
          <Text variant="caption" color="danger">
            {error}
          </Text>
        ) : null}

        <View style={styles.actions}>
          <Button
            title={editing ? "Save changes" : "Log complaint"}
            onPress={submit}
            loading={save.isPending}
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
    gap: spacing[4],
  },
  actions: { paddingTop: spacing[2] },
});
