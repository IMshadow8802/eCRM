import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import type { StackScreenProps } from "@react-navigation/stack";
import { CloudOff, Search } from "lucide-react-native";

import { fetchLeads } from "../../api/leadQueries";
import { fetchTasks } from "../../api/taskQueries";
import { fetchTickets } from "../../api/ticketQueries";
import { useDebouncedValue } from "../../hooks/useDebouncedValue";
import type { RootStackParamList } from "../../navigation/RootNavigator";
import useAuthStore from "../../stores/useAuthStore";
import { complaintBadge, leadBadge, taskStage, taskStageBadge } from "../../theme";
import {
  Band, BandSheet, Button, EmptyState, ErrorCard, GroupHeader, InfoNote, ListGroup, ListRow, Screen,
  SkeletonRows, type ListRowProps,
} from "../../ui";
import { useAccess } from "../auth/useAccess";
import { leadQueueParams } from "../sales/leadHelpers";
import { complaintQueueParams } from "../support/ticketHelpers";

type Props = StackScreenProps<RootStackParamList, "Search">;

/** Shorter terms match half the company; the server's LIKE gains nothing from one letter. */
export const MIN_TERM = 2;
const PAGE = 5;

interface Group {
  key: string;
  title: string;
  /** null = the module could not be searched. */
  total: number | null;
  retry: () => void;
  seeAll: () => void;
  rows: (ListRowProps & { key: number })[];
}

/**
 * Global search (G25; no search endpoint): one debounced, 5-row fan-out per
 * module the role can view. Each module is asked with the exact filters its
 * "See all" opens (Complaints: Team + active; Leads: All; Tasks: open, all
 * workspaces), so a group's count is the list it leads to.
 */
export default function SearchScreen({ navigation }: Props) {
  const [text, setText] = useState("");
  const term = useDebouncedValue(text.trim());
  const ready = term.length >= MIN_TERM;
  const userId = useAuthStore((s) => s.UserId);
  const canComplaints = useAccess("complaints").view;
  const canLeads = useAccess("leads").view;
  const canTasks = useAccess("tasks").view;

  const ticketParams = { ...complaintQueueParams("team", "active", userId, term), PageSize: PAGE };
  const leadParams = { ...leadQueueParams("all", "all", userId ?? 0, term), PageSize: PAGE };
  const tickets = useQuery({
    queryKey: ["search", "tickets", ticketParams],
    queryFn: () => fetchTickets(ticketParams),
    enabled: ready && canComplaints,
  });
  const leads = useQuery({
    queryKey: ["search", "leads", leadParams],
    queryFn: () => fetchLeads(leadParams),
    enabled: ready && canLeads,
  });
  const tasks = useQuery({
    queryKey: ["search", "tasks", term],
    queryFn: () => fetchTasks({ SearchTerm: term, PageSize: PAGE, WorkspaceId: null, OnlyOpen: true }),
    enabled: ready && canTasks,
  });

  const groups: Group[] = [];
  if (canComplaints) {
    const d = tickets.data?.data;
    groups.push({
      key: "complaints",
      title: "Complaints",
      total: tickets.isError ? null : (d?.pagination.totalRecords ?? 0),
      retry: () => void tickets.refetch(),
      seeAll: () => navigation.navigate("Tabs", { screen: "Complaints", params: { queue: "team", term } }),
      rows: (d?.tickets ?? []).map((x) => {
        const b = complaintBadge(x.StatusCode);
        return {
          key: x.Id,
          badge: { tone: b.tone, icon: b.icon, escalated: x.EscalatedTo != null },
          title: x.Subject,
          number: x.TicketNo,
          meta: x.CustomerName ?? undefined,
          onPress: () => navigation.navigate("ComplaintDetail", { ticketId: x.Id }),
        };
      }),
    });
  }
  if (canLeads) {
    const d = leads.data?.data;
    groups.push({
      key: "leads",
      title: "Leads",
      total: leads.isError ? null : (d?.pagination.totalRecords ?? 0),
      retry: () => void leads.refetch(),
      seeAll: () => navigation.navigate("Tabs", { screen: "Leads", params: { queue: "all", term } }),
      rows: (d?.leads ?? []).map((x) => {
        const b = leadBadge(x.StatusCode);
        return {
          key: x.Id,
          badge: { tone: b.tone, icon: b.icon },
          title: x.Name,
          meta: [x.Company, x.StatusName].filter(Boolean).join(" · ") || undefined,
          onPress: () => navigation.navigate("LeadDetail", { leadId: x.Id }),
        };
      }),
    });
  }
  if (canTasks) {
    const d = tasks.data?.data;
    groups.push({
      key: "tasks",
      title: "Tasks",
      total: tasks.isError ? null : (d?.pagination.totalRecords ?? 0),
      retry: () => void tasks.refetch(),
      seeAll: () => navigation.navigate("Tabs", { screen: "Tasks", params: { filter: "all", term } }),
      rows: (d?.tasks ?? []).map((x) => {
        const b = taskStageBadge(taskStage(x));
        return {
          key: x.Id,
          badge: { tone: b.tone, icon: b.icon },
          title: x.Title,
          meta: [x.WorkspaceName, x.ColumnTitle].filter(Boolean).join(" · ") || undefined,
          onPress: () => navigation.navigate("TaskDetail", { taskId: x.Id, workspaceId: x.WorkspaceId }),
        };
      }),
    });
  }

  const queries = [canComplaints && tickets, canLeads && leads, canTasks && tasks].filter((q) => q !== false);
  const loading = ready && queries.some((q) => q.isFetching);
  const allFailed = ready && !loading && queries.length > 0 && queries.every((q) => q.isError);
  const shown = groups.filter((g) => g.total !== 0);
  const empty = ready && !loading && !allFailed && !shown.length;
  const retryAll = () => groups.forEach((g) => g.retry());

  let body;
  if (!ready) {
    body = <EmptyState module="home" icon={Search} title="Search everything" message={`Type at least ${MIN_TERM} letters.`} />;
  } else if (allFailed) {
    body = <ErrorCard onRetry={retryAll} />;
  } else if (empty) {
    body = <EmptyState module="home" icon={Search} title="No matches" message={`Nothing matches "${term}".`} />;
  } else if (loading && !shown.some((g) => g.rows.length)) {
    body = <SkeletonRows rows={4} />;
  } else {
    body = shown.map((g, i) =>
      g.total == null ? (
        <View key={g.key} style={i ? styles.gap : undefined}>
          <InfoNote icon={CloudOff}>{`Could not search ${g.title.toLowerCase()}.`}</InfoNote>
          <Button title="Try again" accessibilityLabel={`Retry ${g.title.toLowerCase()}`} variant="secondary" size="sm" onPress={g.retry} style={styles.retry} />
        </View>
      ) : (
        <View key={g.key}>
          <GroupHeader title={`${g.title} · ${g.total}`} first={i === 0} link={{ label: "See all", onPress: g.seeAll }} />
          <ListGroup>
            {g.rows.map(({ key, ...row }, j) => (
              <ListRow key={key} {...row} noSeparator={j === 0} />
            ))}
          </ListGroup>
        </View>
      ),
    );
  }

  return (
    <Screen band>
      <Band
        variant="tabs"
        onBack={() => navigation.goBack()}
        search={{ value: text, onChangeText: setText, placeholder: "Search complaints, leads, tasks", autoFocus: true, testID: "search-input" }}
      />
      <BandSheet scroll center={!ready || empty}>{body}</BandSheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  gap: { marginTop: 16 },
  retry: { alignSelf: "flex-start", marginTop: 8 },
});
