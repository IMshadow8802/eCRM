import { Fragment, useCallback, useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { CheckCheck, LayoutDashboard, Plus, Search, Timer, X } from "lucide-react-native";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { StackNavigationProp } from "@react-navigation/stack";

import { fetchTasks } from "../../api/taskQueries";
import { useParamState } from "../../hooks/useParamState";
import type { RootStackParamList, TabParamList } from "../../navigation/RootNavigator";
import { useCreate } from "../../navigation/Shell";
import useAuthStore from "../../stores/useAuthStore";
import { taskStage, type TaskStage } from "../../theme";
import type { DayTask, Task } from "../../types/api";
import {
  Band, BandSheet, EmptyState, ErrorCard, FilterPills, GroupHeader, HeaderButton, IconButton, ListGroup, ListRow,
  Screen, SkeletonRows, type FilterOption,
} from "../../ui";
import { TaskRow } from "./TaskRow";
import {
  doneThisWeek, groupByDue, isUnassigned, MY_DAY_QUERY, myDoneQuery, myTasksQuery, needRank, needsYou, WORKSPACES_QUERY,
} from "./taskHelpers";

export type TaskListFilter = "mine" | "unassigned" | "all";
type Filter = TaskListFilter;
type StagePill = "any" | TaskStage;

const NEED_TEXT = ["Tell your manager why", "Past its deadline", "Close to its deadline"];

/**
 * My Work (E 05): Mine · Unassigned · All in the band, stage pills (G8) and
 * Done (G10) on the sheet, rows ordered by deadline. "Needs you" stays above
 * the list on Mine (§7.4). Search narrows the loaded rows by title; Search's
 * "See all" lands here with the term.
 */
export default function MyWorkScreen() {
  const navigation = useNavigation<StackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<TabParamList, "Tasks">>();
  const userId = useAuthStore((s) => s.UserId);
  const create = useCreate();
  const [stage, setStage] = useState<StagePill>("any");
  const [filter, setFilter] = useParamState<Filter>(route.params, route.params?.filter, "mine", () => setStage("any"));
  const [searching, setSearching] = useState(!!route.params?.term);
  const [term, setTerm] = useParamState<string>(route.params, route.params?.term, "", () => setSearching(true));

  // WorkspaceId null = every workspace the caller can see. Open tasks only,
  // except Done (G10), which reads my tasks finished or not.
  const mine = useQuery(myTasksQuery(userId));
  const everyone = useQuery({
    queryKey: ["tasks", "all-workspaces", "open"],
    queryFn: () => fetchTasks({ WorkspaceId: null, OnlyOpen: true, PageSize: 200 }),
  });
  const withDone = useQuery(myDoneQuery(userId));
  const myDay = useQuery(MY_DAY_QUERY);
  const workspaces = useQuery(WORKSPACES_QUERY);
  const needs = useMemo(() => needsYou(myDay.data?.data), [myDay.data]);

  const mineTasks = useMemo(() => mine.data?.data?.tasks ?? [], [mine.data]);
  const allTasks = useMemo(() => everyone.data?.data?.tasks ?? [], [everyone.data]);
  const doneWeek = useMemo(() => doneThisWeek(withDone.data?.data?.tasks ?? []), [withDone.data]);
  const personal = useMemo(
    () => new Set((workspaces.data ?? []).filter((w) => w.Type === "personal").map((w) => w.Id)),
    [workspaces.data],
  );

  const tabList = useMemo(
    () => ({ mine: mineTasks, unassigned: allTasks.filter(isUnassigned), all: allTasks }),
    [mineTasks, allTasks],
  );
  const q = term.trim().toLowerCase();
  const matches = useCallback(
    (t: Task) => !q || t.Title.toLowerCase().includes(q) || (t.WorkspaceName ?? "").toLowerCase().includes(q),
    [q],
  );
  const base = useMemo(() => tabList[filter].filter(matches), [tabList, filter, matches]);
  const visible = useMemo(() => {
    if (stage === "done") return doneWeek.filter(matches);
    return stage === "any" ? base : base.filter((t) => taskStage(t) === stage);
  }, [stage, base, doneWeek, matches]);
  const ordered = useMemo(() => groupByDue(visible).flatMap((g) => g.tasks), [visible]);

  const active = stage === "done" ? withDone : filter === "mine" ? mine : everyone;
  const count = (s: TaskStage) => base.filter((t) => taskStage(t) === s).length;
  const pills: FilterOption<StagePill>[] = [
    { value: "any", label: "Any status" },
    { value: "todo", label: "To Do", count: count("todo"), tone: "slate" },
    { value: "inProgress", label: "In Progress", count: count("inProgress"), tone: "teal" },
    { value: "done", label: "Done", tone: "green" },
  ];

  const openTask = useCallback(
    (task: Task) => navigation.navigate("TaskDetail", { taskId: task.Id, workspaceId: task.WorkspaceId }),
    [navigation],
  );
  const openNeed = (t: DayTask) =>
    navigation.navigate("TaskDetail", {
      taskId: t.TaskId,
      workspaceId: t.WorkspaceId,
      tab: "tat",
      // Straight to the reason sheet, on the clock that owes it.
      ...(t.flags.reasonOwed && t.TatId ? { explainTatId: t.TatId } : {}),
    });
  const newTask = () => {
    const own = (workspaces.data ?? []).find((w) => w.Type === "personal" && w.OwnerUserId === userId);
    if (own) navigation.navigate("TaskForm", { workspaceId: own.Id });
    // No personal board cached: the Shell's create makes one first.
    else create.open();
  };

  const updated = active.dataUpdatedAt
    ? new Date(active.dataUpdatedAt).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" }).toLowerCase()
    : undefined;
  const boardCount = workspaces.data?.filter((w) => w.MyInviteStatus !== "pending").length;

  let list;
  if (active.isLoading) list = <SkeletonRows rows={4} />;
  else if (active.isError) list = <ErrorCard onRetry={() => void active.refetch()} />;
  else if (!ordered.length) {
    list = (
      <EmptyState
        module="tasks"
        title={q ? "No matches" : emptyTitle(filter, stage)}
        message={q ? `Nothing here matches "${term.trim()}".` : emptyMessage(filter, stage)}
      />
    );
  } else {
    list = (
      <ListGroup testID="task-list">
        {ordered.map((t, i) => (
          <TaskRow key={t.Id} task={t} onPress={openTask} personal={t.WorkspaceId != null && personal.has(t.WorkspaceId)} first={i === 0} />
        ))}
      </ListGroup>
    );
  }

  return (
    <Screen band>
      <Band
        title="My Work"
        variant="tabs"
        actions={
          <>
            <IconButton
              icon={searching ? X : Search}
              accessibilityLabel={searching ? "Close search" : "Search tasks"}
              onPress={() => {
                if (searching) setTerm("");
                setSearching(!searching);
              }}
            />
            <HeaderButton label="New" icon={Plus} onPress={newTask} accessibilityLabel="New task" />
          </>
        }
        search={searching ? { placeholder: "Search tasks", value: term, onChangeText: setTerm, autoFocus: !route.params?.term } : undefined}
        tabs={{
          value: filter,
          onChange: (v) => {
            setFilter(v as Filter);
            if (stage === "done") setStage("any");
          },
          options: [
            { value: "mine", label: "Mine", count: mine.data ? tabList.mine.length : undefined },
            { value: "unassigned", label: "Unassigned", count: everyone.data ? tabList.unassigned.length : undefined },
            { value: "all", label: "All", count: everyone.data ? tabList.all.length : undefined },
          ],
        }}
      />
      <BandSheet
        scroll
        refresh={{
          refreshing: active.isRefetching && !active.isLoading,
          onRefresh: () => {
            void active.refetch();
            void myDay.refetch();
          },
        }}
      >
        <FilterPills label="Filter by status" value={stage} options={pills} onChange={setStage} />

        {filter === "mine" && stage === "any" && needs.length > 0 ? (
          <Fragment>
            <GroupHeader title="Needs you" count={needs.length} />
            <ListGroup testID="needs-you">
              {needs.map((t, i) => {
                const rank = needRank(t);
                return (
                  <ListRow
                    key={t.TaskId}
                    testID="needs-you-row"
                    noSeparator={i === 0}
                    badge={{ tone: rank === 2 ? "butter" : "red", icon: Timer }}
                    title={t.Title}
                    right={rank === 0 ? { text: "Explain", tone: "brand" } : undefined}
                    meta={[t.WorkspaceName, NEED_TEXT[rank]].filter(Boolean).join(" · ")}
                    onPress={() => openNeed(t)}
                  />
                );
              })}
            </ListGroup>
          </Fragment>
        ) : null}

        <GroupHeader label={stage === "done" ? "Completed this week" : "Sorted by deadline"} right={updated ? `Updated ${updated}` : undefined} />
        {list}

        <View style={styles.cards}>
          <ListGroup>
            <ListRow
              noSeparator
              badge={{ tone: "green", icon: CheckCheck, size: 36 }}
              title="Completed this week"
              accessibilityLabel="Completed this week"
              right={{ text: withDone.data ? String(doneWeek.length) : "—" }}
              chevron
              // The count is mine, so it opens Mine on the Done pill.
              onPress={() => {
                setFilter("mine");
                setStage("done");
              }}
            />
          </ListGroup>
          <ListGroup>
            <ListRow
              noSeparator
              badge={{ tone: "lilac", icon: LayoutDashboard, size: 36 }}
              title="Open a board"
              accessibilityLabel="Open a board"
              right={boardCount != null ? { text: `${boardCount} workspace${boardCount === 1 ? "" : "s"}` } : undefined}
              chevron
              onPress={() => navigation.navigate("Boards")}
            />
          </ListGroup>
        </View>
      </BandSheet>
    </Screen>
  );
}

const emptyTitle = (filter: Filter, stage: StagePill) =>
  stage === "done"
    ? "Nothing finished this week"
    : filter === "mine"
      ? "Nothing assigned to you"
      : filter === "unassigned"
        ? "Nothing unassigned"
        : "No tasks yet";

const emptyMessage = (filter: Filter, stage: StagePill) =>
  stage === "done"
    ? "Tasks you finish show up here until Sunday night."
    : filter === "mine"
      ? "Tasks assigned to you across every workspace show up here."
      : filter === "unassigned"
        ? "Every task on your boards has someone on it."
        : "Tasks from all your workspaces will appear here.";

const styles = StyleSheet.create({
  cards: { marginTop: 12, gap: 8 },
});
