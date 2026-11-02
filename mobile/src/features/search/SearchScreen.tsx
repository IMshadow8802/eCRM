import { useState } from "react";
import { View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import type { StackScreenProps } from "@react-navigation/stack";
import { Search } from "lucide-react-native";

import { fetchLeads } from "../../api/leadQueries";
import { fetchTasks } from "../../api/taskQueries";
import { fetchTickets } from "../../api/ticketQueries";
import { useDebouncedValue } from "../../hooks/useDebouncedValue";
import type { RootStackParamList } from "../../navigation/RootNavigator";
import { complaintBadge, leadBadge, taskStage, taskStageBadge } from "../../theme";
import {
  Band, BandSheet, EmptyState, GroupHeader, ListGroup, ListRow, Screen, SkeletonRows, type ListRowProps,
} from "../../ui";
import { useAccess } from "../auth/useAccess";

type Props = StackScreenProps<RootStackParamList, "Search">;

/** Shorter terms match half the company; the server's LIKE gains nothing from one letter. */
export const MIN_TERM = 2;
const PAGE = 5;

interface Group {
  key: string;
  title: string;
  total: number;
  seeAll: () => void;
  rows: (ListRowProps & { key: number })[];
}

/**
 * Global search (G25; no search endpoint): one debounced, 5-row fan-out per
 * module the role can view, grouped, each with "See all" into its list with
 * the term. Rows are plain ListRows, so this depends on no feature list.
 */
export default function SearchScreen({ navigation }: Props) {
  const [text, setText] = useState("");
  const term = useDebouncedValue(text.trim());
  const ready = term.length >= MIN_TERM;
  const canComplaints = useAccess("complaints").view;
  const canLeads = useAccess("leads").view;
  const canTasks = useAccess("tasks").view;

  const tickets = useQuery({
    queryKey: ["search", "tickets", term],
    queryFn: () => fetchTickets({ SearchTerm: term, PageSize: PAGE }),
    enabled: ready && canComplaints,
  });
  const leads = useQuery({
    queryKey: ["search", "leads", term],
    queryFn: () => fetchLeads({ SearchTerm: term, PageSize: PAGE }),
    enabled: ready && canLeads,
  });
  const tasks = useQuery({
    queryKey: ["search", "tasks", term],
    queryFn: () => fetchTasks({ SearchTerm: term, PageSize: PAGE }),
    enabled: ready && canTasks,
  });

  const groups: Group[] = [];
  const t = tickets.data?.data;
  if (canComplaints && t) {
    groups.push({
      key: "complaints",
      title: "Complaints",
      total: t.pagination.totalRecords,
      seeAll: () => navigation.navigate("Tabs", { screen: "Complaints", params: { queue: "team", term } }),
      rows: t.tickets.map((x) => {
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
  const l = leads.data?.data;
  if (canLeads && l) {
    groups.push({
      key: "leads",
      title: "Leads",
      total: l.pagination.totalRecords,
      seeAll: () => navigation.navigate("Tabs", { screen: "Leads", params: { queue: "all", term } }),
      rows: l.leads.map((x) => {
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
  const k = tasks.data?.data;
  if (canTasks && k) {
    groups.push({
      key: "tasks",
      title: "Tasks",
      total: k.pagination.totalRecords,
      seeAll: () => navigation.navigate("Tabs", { screen: "Tasks", params: { filter: "all", term } }),
      rows: k.tasks.map((x) => {
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

  const loading = ready && [tickets, leads, tasks].some((q) => q.isFetching);
  const found = groups.filter((g) => g.total > 0);
  const empty = ready && !loading && !found.length;

  return (
    <Screen band>
      <Band
        variant="tabs"
        onBack={() => navigation.goBack()}
        search={{ value: text, onChangeText: setText, placeholder: "Search complaints, leads, tasks", autoFocus: true, testID: "search-input" }}
      />
      <BandSheet scroll center={!ready || empty}>
        {!ready ? (
          <EmptyState module="home" icon={Search} title="Search everything" message={`Type at least ${MIN_TERM} letters.`} />
        ) : empty ? (
          <EmptyState module="home" icon={Search} title="No matches" message={`Nothing matches "${term}".`} />
        ) : loading && !found.length ? (
          <SkeletonRows rows={4} />
        ) : (
          found.map((g, i) => (
            <View key={g.key}>
              <GroupHeader title={`${g.title} · ${g.total}`} first={i === 0} link={{ label: "See all", onPress: g.seeAll }} />
              <ListGroup>
                {g.rows.map(({ key, ...row }, j) => (
                  <ListRow key={key} {...row} noSeparator={j === 0} />
                ))}
              </ListGroup>
            </View>
          ))
        )}
      </BandSheet>
    </Screen>
  );
}
