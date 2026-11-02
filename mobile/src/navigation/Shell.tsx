import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import { useRoute } from "@react-navigation/native";

import { ensurePersonalWorkspace, fetchWorkspaces } from "../api/workspaceQueries";
import { apiErrorMessage } from "../api/errors";
import { useAccess } from "../features/auth/useAccess";
import { useHeartbeat } from "../hooks/useHeartbeat";
import useAuthStore from "../stores/useAuthStore";
import { ActionBar, useLayout, useToast, type BarAction, type SheetRef } from "../ui";
import { useNavBadges } from "./badges";
import { BottomBar } from "./BottomBar";
import { CREATE_ROWS, CreateSheet, type CreateKind } from "./CreateSheet";
import { Rail } from "./Rail";
import type { RootStackParamList } from "./RootNavigator";
import { railTabsFor, tabsFor, useCan, type RailItem, type TabName } from "./tabs";

export type StackRoute = keyof RootStackParamList;
export type RouteOwner = TabName | "action" | "none";

/**
 * What the bottom chrome shows for each stack route (spec §3.4): the tab that
 * owns it (active on the bar), the record's action bar, or nothing (forms).
 */
export const ROUTE_OWNER: Record<StackRoute, RouteOwner> = {
  Login: "none",
  Tabs: "Home",
  TaskDetail: "Tasks",
  Board: "Tasks",
  WorkspaceSettings: "Tasks",
  Columns: "Tasks",
  Boards: "More",
  FollowUps: "More",
  Me: "More",
  Inbox: "Home",
  Search: "Home",
  Complaints: "Complaints",
  Leads: "Leads",
  ComplaintDetail: "action",
  LeadDetail: "action",
  TaskForm: "none",
  ComplaintForm: "none",
  LeadForm: "none",
  WorkspaceForm: "none",
};

/** Until a record screen publishes its actions, the bar keeps showing its list's tab. */
const ACTION_FALLBACK: Partial<Record<StackRoute, TabName>> = { ComplaintDetail: "Complaints", LeadDetail: "Leads" };

/** The focused route: the stack route, its key, and the focused tab when it is Tabs. */
export interface FocusedRoute { name: StackRoute; key: string; tab: TabName | null }

const FIRST_ROUTE: FocusedRoute = { name: "Tabs", key: "", tab: "Home" };

export interface ShellNavigator {
  navigate: <R extends StackRoute>(name: R, params?: RootStackParamList[R]) => void;
  /** Back to the tab root, on that tab (StackActions.popTo). */
  toTab: (tab: TabName) => void;
}

interface ShellApi {
  setActions: (routeKey: string, actions: BarAction[] | null) => void;
  openCreate: () => void;
  createLabel: string;
  nav: "bar" | "rail";
}

const ShellContext = createContext<ShellApi | null>(null);

/**
 * A record screen publishes its action bar (E 11, 15). On a phone the Shell
 * draws it in place of the bottom bar; at the rail it returns `inBand: true`
 * and the screen puts the actions in its band instead (T2/T3).
 *
 * Re-published only when an action's key, label, main or disabled flag
 * changes; a press always runs the latest handler.
 */
export function useActionBar(actions: BarAction[]): { inBand: boolean } {
  const shell = useContext(ShellContext);
  const route = useRoute();
  const latest = useRef(actions);
  useEffect(() => {
    latest.current = actions;
  });
  const signature = actions.map((a) => `${a.key}:${a.label}:${a.main ? 1 : 0}:${a.disabled ? 1 : 0}`).join("|");
  useEffect(() => {
    if (!shell) return;
    const live = latest.current.map((a) => ({ ...a, onPress: () => latest.current.find((x) => x.key === a.key)?.onPress() }));
    shell.setActions(route.key, live);
    return () => shell.setActions(route.key, null);
    // signature stands for `actions`; the ref carries the handlers.
  }, [shell, route.key, signature]);
  return { inBand: shell?.nav === "rail" };
}

/**
 * The band's "+ New": opens the Create sheet, or — with exactly one module the
 * role can add to — goes straight to its form and reads "+ Lead" (E 27).
 */
export function useCreate(): { open: () => void; label: string } {
  const shell = useContext(ShellContext);
  return { open: shell?.openCreate ?? (() => {}), label: shell?.createLabel ?? "New" };
}

export interface ShellProps {
  route: FocusedRoute | null;
  navigator: ShellNavigator;
  children: ReactNode;
}

/**
 * The signed-in frame (spec §3.4): rail beside the stack at ≥ medium, else the
 * docked bar / action bar / nothing under it, by `ROUTE_OWNER`. It also owns
 * the Create sheet and the session heartbeat.
 */
export function Shell({ route, navigator, children }: ShellProps) {
  const layout = useLayout();
  const can = useCan();
  const badges = useNavBadges(can);
  const toast = useToast();
  const queryClient = useQueryClient();
  const userId = useAuthStore((s) => s.UserId);
  useHeartbeat();

  const addable: CreateKind[] = [
    ...(useAccess("tasks").add ? (["task"] as const) : []),
    ...(useAccess("complaints").add ? (["complaint"] as const) : []),
    ...(useAccess("leads").add ? (["lead"] as const) : []),
  ];
  const single = addable.length === 1 ? addable[0]! : null;
  const sheet = useRef<SheetRef>(null);

  const [actions, setActionMap] = useState<Record<string, BarAction[]>>({});
  const setActions = useCallback((key: string, list: BarAction[] | null) => {
    setActionMap((prev) => {
      const next = { ...prev };
      if (list) next[key] = list;
      else delete next[key];
      return next;
    });
  }, []);

  const startCreate = useCallback(
    async (kind: CreateKind) => {
      if (kind === "complaint") return navigator.navigate("ComplaintForm", {});
      if (kind === "lead") return navigator.navigate("LeadForm", {});
      // New task → the caller's personal workspace (spec: proposed), made if missing.
      try {
        const find = async () =>
          (await queryClient.fetchQuery({ queryKey: ["workspaces", false], queryFn: () => fetchWorkspaces({ PageSize: 100 }) }))
            .find((w) => w.Type === "personal" && w.OwnerUserId === userId);
        let personal = await find();
        if (!personal) {
          await ensurePersonalWorkspace();
          await queryClient.invalidateQueries({ queryKey: ["workspaces"] });
          personal = await find();
        }
        if (personal) navigator.navigate("TaskForm", { workspaceId: personal.Id });
        else toast.error("Could not find your personal workspace.");
      } catch (err) {
        toast.error(apiErrorMessage(err, "Could not open a new task."));
      }
    },
    [navigator, queryClient, toast, userId],
  );

  const openCreate = useCallback(() => {
    if (single) void startCreate(single);
    else sheet.current?.present();
  }, [single, startCreate]);

  const nav = layout.nav;
  const createLabel = single ? CREATE_ROWS[single].short : "New";
  const api = useMemo(() => ({ setActions, openCreate, createLabel, nav }), [setActions, openCreate, createLabel, nav]);

  // Before the container reports its first state, the stack is on Tabs/Home:
  // seeding it draws the bar on the very first frame instead of popping it in.
  const at = route ?? FIRST_ROUTE;
  const owner: RouteOwner = at.name === "Tabs" ? (at.tab ?? "Home") : ROUTE_OWNER[at.name];
  const routeActions = actions[at.key];
  const activeTab: TabName | null =
    owner === "action" ? (ACTION_FALLBACK[at.name] ?? null) : owner === "none" ? null : owner;
  // The rail carries Inbox and Follow-ups as items of their own, so a pushed
  // one is its own item there (on the bar they stay under Today / More).
  const railActive: RailItem | null = at.name === "Inbox" ? "Inbox" : at.name === "FollowUps" ? "FollowUps" : activeTab;

  const pressItem = (item: RailItem) => {
    // Follow-ups is a tab only while the bar has room; navigate() lands on the
    // tab when it exists and pushes the queue when it does not.
    if (item === "Inbox" || item === "FollowUps") navigator.navigate(item);
    else navigator.toTab(item);
  };

  let bottom: ReactNode = null;
  if (nav === "bar" && owner !== "none") {
    bottom =
      owner === "action" && routeActions?.length ? (
        <ActionBar actions={routeActions} />
      ) : (
        <BottomBar tabs={tabsFor(can)} active={activeTab} onPress={pressItem} badges={badges} />
      );
  }

  return (
    <ShellContext.Provider value={api}>
      <View style={[styles.fill, nav === "rail" && styles.row]}>
        {nav === "rail" ? (
          <Rail
            items={railTabsFor(can)}
            active={railActive}
            onPress={pressItem}
            badges={badges}
            onCreate={openCreate}
            createLabel={single ? `New ${CREATE_ROWS[single].short.toLowerCase()}` : "Create"}
          />
        ) : null}
        <View style={styles.fill}>{children}</View>
        {bottom}
      </View>
      <CreateSheet ref={sheet} kinds={addable} onPick={(k) => void startCreate(k)} />
    </ShellContext.Provider>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  row: { flexDirection: "row" },
});

export default Shell;
