import { useCallback, useDeferredValue, useMemo, useRef, useState } from "react";
import { FlatList, RefreshControl, StyleSheet, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRightLeft,
  Ban,
  CircleCheck,
  CloudOff,
  Headset,
  Plus,
  Search,
} from "lucide-react-native";
import type { StackScreenProps } from "@react-navigation/stack";

import { fetchLookups, fetchPipelines, LOOKUP_KIND } from "../../api/configQueries";
import { fetchTickets, moveTicketStage } from "../../api/ticketQueries";
import { fetchUserDirectory } from "../../api/userQueries";
import type { RootStackParamList } from "../../navigation/RootNavigator";
import type { PipelineStage, Ticket } from "../../types/api";
import { colors, radius, shadows, spacing, SCREEN_PADDING } from "../../theme";
import {
  ActionSheet,
  BoardColumns,
  EmptyState,
  Fab,
  Input,
  Screen,
  ScreenHeader,
  Text,
  type SheetAction,
  type SheetRef,
} from "../../ui";
import { ComplaintCard } from "./ComplaintCard";
import {
  lookupMap,
  needsResolution,
  stageRoles,
} from "./ticketHelpers";

type Props = StackScreenProps<RootStackParamList, "Complaints">;

/** Tickets whose StageId is missing or points at a retired stage. */
const NO_STAGE_ID = -1;

/**
 * The complaints board — the web's ticket board, on a phone.
 *
 * The web splits this into a Tickets table and a TicketBoard. Mobile does not:
 * a table on a 360px screen is a worse version of a list, and the board
 * already answers the only question a phone gets asked — what is where, and
 * move this one along. One screen, no separate table.
 *
 * Columns are the default pipeline's stages, which is why there is no
 * Open/Mine/All filter: the stage IS the filter, and it is the same lifecycle
 * the web board shows.
 */
export default function ComplaintsScreen({ navigation }: Props) {
  const queryClient = useQueryClient();

  const [search, setSearch] = useState("");
  const [moving, setMoving] = useState<Ticket | null>(null);
  const [pendingStage, setPendingStage] = useState<PipelineStage | null>(null);

  const stageRef = useRef<SheetRef>(null);
  const resolutionRef = useRef<SheetRef>(null);

  // Deferred rather than debounced with a timer: React holds the old board on
  // screen while the new query resolves, so typing never blanks it and there is
  // no timeout to clean up.
  const term = useDeferredValue(search.trim());

  const ticketsQuery = useQuery({
    queryKey: ["tickets", term],
    queryFn: () => fetchTickets({ PageSize: 200, SearchTerm: term || null }),
  });

  // The ticket row carries ids, not names — sp_FetchTickets joins nothing.
  const { data: pipeline } = useQuery({
    queryKey: ["pipelines", "ticket"],
    queryFn: () => fetchPipelines({ Entity: "ticket" }),
  });
  const { data: categories } = useQuery({
    queryKey: ["lookups", LOOKUP_KIND.ticketCategory],
    queryFn: () => fetchLookups({ Kind: LOOKUP_KIND.ticketCategory }),
  });
  const { data: priorities } = useQuery({
    queryKey: ["lookups", LOOKUP_KIND.priority],
    queryFn: () => fetchLookups({ Kind: LOOKUP_KIND.priority }),
  });
  const { data: resolutions } = useQuery({
    queryKey: ["lookups", LOOKUP_KIND.resolution],
    queryFn: () => fetchLookups({ Kind: LOOKUP_KIND.resolution }),
  });
  const { data: directory } = useQuery({
    queryKey: ["users", "directory"],
    queryFn: () => fetchUserDirectory(),
  });

  const move = useMutation({
    mutationFn: moveTicketStage,
    onSuccess: () => {
      setMoving(null);
      setPendingStage(null);
      queryClient.invalidateQueries({ queryKey: ["tickets"] });
      queryClient.invalidateQueries({ queryKey: ["ticket"] });
    },
  });

  const roles = useMemo(() => stageRoles(pipeline?.stages), [pipeline]);
  const categoryNames = useMemo(() => lookupMap(categories), [categories]);
  const priorityNames = useMemo(() => lookupMap(priorities), [priorities]);
  const people = useMemo(
    () => new Map((directory ?? []).map((u) => [u.Id, u.FullName])),
    [directory],
  );

  const tickets = useMemo(
    () => ticketsQuery.data?.data?.tickets ?? [],
    [ticketsQuery.data],
  );

  // A company can run more than one support pipeline; the board shows the
  // default one, exactly as the web board does.
  const activePipeline = useMemo(
    () =>
      (pipeline?.pipelines ?? []).find((p) => p.IsDefault) ??
      pipeline?.pipelines?.[0] ??
      null,
    [pipeline],
  );

  const stages = useMemo(
    () => roles.ordered.filter((s) => s.PipelineId === activePipeline?.Id),
    [roles, activePipeline],
  );

  // A "No stage" column only exists when something is actually in it — an
  // empty extra column on a small screen is a wasted swipe.
  const columns = useMemo(() => {
    const known = new Set(stages.map((s) => s.Id));
    const orphans = tickets.some(
      (t) => t.StageId == null || !known.has(t.StageId),
    );
    if (!orphans) return stages;
    return [
      ...stages,
      { Id: NO_STAGE_ID, Name: "No stage", Color: null } as PipelineStage,
    ];
  }, [stages, tickets]);

  const byStage = useMemo(() => {
    const known = new Set(columns.map((c) => c.Id));
    const map = new Map<number, Ticket[]>();
    for (const column of columns) map.set(column.Id, []);
    for (const ticket of tickets) {
      const key =
        ticket.StageId != null && known.has(ticket.StageId)
          ? ticket.StageId
          : NO_STAGE_ID;
      map.get(key)?.push(ticket);
    }
    return map;
  }, [columns, tickets]);

  const openTicket = useCallback(
    (ticket: Ticket) =>
      navigation.navigate("ComplaintDetail", { ticketId: ticket.Id }),
    [navigation],
  );

  const promptMove = useCallback((ticket: Ticket) => {
    setMoving(ticket);
    stageRef.current?.present();
  }, []);

  /**
   * Entering the first `won` stage needs a resolution — the SP rejects the
   * move without one, and a silent failure would read as the app ignoring the
   * tap. So that move opens a second sheet instead of firing.
   */
  const pickStage = (target: PipelineStage) => {
    if (!moving) return;
    if (needsResolution(target, roles) && !moving.ResolutionId) {
      setPendingStage(target);
      resolutionRef.current?.present();
      return;
    }
    move.mutate({ TicketId: moving.Id, StageId: target.Id });
  };

  const stageActions: SheetAction[] = stages.map((s) => ({
    key: String(s.Id),
    label: s.Name,
    sublabel:
      s.Id === roles.resolved?.Id
        ? "Fixed — awaiting the customer"
        : s.Id === roles.closed?.Id
          ? "Done and confirmed"
          : s.StageType === "lost"
            ? "Closed without a fix"
            : undefined,
    icon:
      s.StageType === "lost"
        ? Ban
        : s.StageType === "won"
          ? CircleCheck
          : ArrowRightLeft,
    tone: s.StageType === "lost" ? "danger" : undefined,
    selected: moving?.StageId === s.Id,
    onPress: () => pickStage(s),
  }));

  const resolutionActions: SheetAction[] = (resolutions ?? []).map((r) => ({
    key: String(r.Id),
    label: r.Value,
    icon: CircleCheck,
    onPress: () =>
      moving &&
      pendingStage &&
      move.mutate({
        TicketId: moving.Id,
        StageId: pendingStage.Id,
        ResolutionId: r.Id,
      }),
  }));

  const loading = ticketsQuery.isLoading || !pipeline;

  return (
    <Screen>
      <ScreenHeader
        title="Complaints"
        subtitle={
          activePipeline
            ? `${tickets.length} on ${activePipeline.Name}`
            : `${tickets.length} logged`
        }
        tint="danger"
        onBack={navigation.goBack}
      />

      <View style={styles.controls}>
        <Input
          value={search}
          onChangeText={setSearch}
          placeholder="Customer, contact or ticket no."
          leftIcon={Search}
          autoCorrect={false}
          returnKeyType="search"
        />
      </View>

      {!loading && !columns.length ? (
        <EmptyState
          icon={ticketsQuery.isError ? CloudOff : Headset}
          title={
            ticketsQuery.isError
              ? "Couldn't load complaints"
              : "No support pipeline"
          }
          message={
            ticketsQuery.isError
              ? "Pull down to try again."
              : "Set up a pipeline and its stages on the web, then the board appears here."
          }
        />
      ) : (
        <BoardColumns
          columns={columns}
          keyOf={(column) => String(column.Id)}
          renderColumn={(column) => {
            const cards = byStage.get(column.Id) ?? [];
            return (
              <>
                <View style={styles.columnHeader}>
                  <View
                    style={[
                      styles.dot,
                      { backgroundColor: column.Color ?? colors.primary },
                    ]}
                  />
                  <Text variant="h3" numberOfLines={1} style={styles.columnTitle}>
                    {column.Name}
                  </Text>
                  <View style={styles.count}>
                    <Text variant="caption" color="textSecondary">
                      {cards.length}
                    </Text>
                  </View>
                </View>

                <FlatList
                  data={cards}
                  keyExtractor={(ticket) => String(ticket.Id)}
                  contentContainerStyle={styles.cards}
                  showsVerticalScrollIndicator={false}
                  keyboardShouldPersistTaps="handled"
                  refreshControl={
                    <RefreshControl
                      refreshing={ticketsQuery.isRefetching && !loading}
                      onRefresh={ticketsQuery.refetch}
                      tintColor={colors.primary}
                    />
                  }
                  ListEmptyComponent={
                    <Text variant="secondary" style={styles.columnEmpty}>
                      {term ? "Nothing matches here." : "Nothing here yet."}
                    </Text>
                  }
                  renderItem={({ item }) => (
                    <ComplaintCard
                      ticket={item}
                      roles={roles}
                      categories={categoryNames}
                      priorities={priorityNames}
                      people={people}
                      onPress={openTicket}
                      onLongPress={promptMove}
                      showStage={false}
                    />
                  )}
                />
              </>
            );
          }}
        />
      )}

      <Fab
        icon={Plus}
        accessibilityLabel="Log a complaint"
        onPress={() => navigation.navigate("ComplaintForm", {})}
      />

      <ActionSheet
        ref={stageRef}
        title={moving ? `Move ${moving.TicketNo}` : "Move to stage"}
        actions={stageActions}
        emptyMessage="This company has no support pipeline configured."
      />
      <ActionSheet
        ref={resolutionRef}
        title="How was it resolved?"
        actions={resolutionActions}
        emptyMessage="No resolutions are configured. Add them on the web first."
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  controls: {
    paddingHorizontal: SCREEN_PADDING,
    paddingTop: spacing[4],
    paddingBottom: spacing[3],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
  },
  columnHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
    paddingHorizontal: spacing[1],
    paddingBottom: spacing[3],
  },
  dot: { width: 10, height: 10, borderRadius: radius.full },
  columnTitle: { flex: 1 },
  count: {
    minWidth: 26,
    paddingHorizontal: spacing[2],
    paddingVertical: 1,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    alignItems: "center",
    ...shadows.sm,
  },
  // Clears the FAB so the last card in a full column stays reachable.
  // 16, not 12: the gap has to out-reach the card shadow or the two shadows
  // meet and the column reads as one continuous strip.
  cards: { gap: spacing[4], paddingBottom: spacing[20] },
  columnEmpty: { paddingHorizontal: spacing[1] },
});
