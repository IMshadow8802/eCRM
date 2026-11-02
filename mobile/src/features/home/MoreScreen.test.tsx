import { fireEvent, screen, waitFor } from "@testing-library/react-native";
import Constants from "expo-constants";

import { logout } from "../../api/authQueries";
import { fetchFollowUps } from "../../api/followupQueries";
import { fetchNotifications } from "../../api/notificationQueries";
import { fetchBranches } from "../../api/userQueries";
import { fetchWorkspaces } from "../../api/workspaceQueries";
import useAuthStore from "../../stores/useAuthStore";
import { chipTones } from "../../theme";
import type { ModuleKey } from "../../types/api";
import { envelope, makeWorkspace, pagination } from "../../test/fixtures";
import { makeNavigation, renderWithProviders, seedAuth } from "../../test/renderWithProviders";
import { flat } from "../../test/style";
import { spySheets } from "../../test/sheets";
import { PHONE, setWindow } from "../../test/window";
import { localDay } from "../sales/leadHelpers";
import MoreScreen from "./MoreScreen";

jest.mock("../../api/authQueries");
jest.mock("../../api/followupQueries");
jest.mock("../../api/notificationQueries");
jest.mock("../../api/userQueries");
jest.mock("../../api/workspaceQueries");
const mockExpo: { config: Partial<NonNullable<typeof Constants.expoConfig>> | null } = { config: null };
jest.mock("expo-constants", () => {
  const actual = jest.requireActual("expo-constants");
  return {
    ...actual,
    __esModule: true,
    default: new Proxy(actual.default, {
      get: (target, key) => (key === "expoConfig" ? mockExpo.config : Reflect.get(target, key)),
    }),
  };
});

const mockNav = makeNavigation<"Tabs">();
jest.mock("@react-navigation/native", () => ({
  ...jest.requireActual("@react-navigation/native"),
  useNavigation: () => mockNav,
}));

const VIEW = { view: true, add: false, edit: false, delete: false, reach: "Own" as const };
const signInWith = (modules: ModuleKey[], patch: Parameters<typeof seedAuth>[0] = {}) => {
  seedAuth({
    user: { Id: 7, FullName: "Ayush Mishra", JobTitle: null },
    BranchId: 2,
    ...patch,
    access: { modules: Object.fromEntries(modules.map((m) => [m, VIEW])), ...patch.access },
  });
  useAuthStore.setState({ companyName: "PRD Infotech (Test)" });
};
const unread = (n: number) => envelope({ notifications: [], unreadCount: n, pagination: pagination(n) });
const ROWS = ["Inbox", "Workspaces", "Follow-ups", "Profile", "Change password", "Sign out"];
// The password sheet stays mounted (gorhom mock), so its title repeats a row label.
const rowLabels = () => ROWS.filter((l) => screen.queryAllByText(l).length);
/** The pill a label sits in: the nearest ancestor with a fill. */
const fillOf = (label: string) => {
  let el = screen.getByText(label).parent;
  while (el && !flat(el).backgroundColor) el = el.parent;
  return flat(el).backgroundColor;
};

beforeEach(() => {
  setWindow(...PHONE);
  mockExpo.config = { version: "1.0.1", ios: { buildNumber: "20261102" } };
  useAuthStore.setState({ companyName: "PRD Infotech (Test)" });
  jest.mocked(fetchNotifications).mockResolvedValue(unread(0));
  jest.mocked(fetchBranches).mockResolvedValue([{ Id: 1, BranchName: "Lajpat Nagar" }, { Id: 2, BranchName: "Head Office" }]);
  jest.mocked(fetchWorkspaces).mockResolvedValue([
    makeWorkspace({ Id: 1 }),
    makeWorkspace({ Id: 2 }),
    makeWorkspace({ Id: 3, IsArchived: true }),
    makeWorkspace({ Id: 4, MyInviteStatus: "pending" }),
    // Seen only through the admin bypass: not yours.
    makeWorkspace({ Id: 5, MyRole: null, MyInviteStatus: null }),
  ]);
  jest.mocked(fetchFollowUps).mockResolvedValue(envelope({ followups: [], pagination: pagination(4) }));
  jest.mocked(logout).mockResolvedValue(envelope({}));
});

describe("rows by access, in E's order", () => {
  it.each([
    // Follow-ups is a tab for these two, so it is not repeated here.
    ["leads-only", ["leads"], ["Inbox", "Profile", "Change password", "Sign out"]],
    ["tasks and leads", ["tasks", "leads"], ["Inbox", "Workspaces", "Profile", "Change password", "Sign out"]],
    // No room on the bar: Follow-ups moves here (E 19).
    ["all three", ["tasks", "complaints", "leads"], ROWS],
    // E 26.
    ["complaints-only", ["complaints"], ["Inbox", "Profile", "Change password", "Sign out"]],
  ] as const)("%s", async (_role, modules, rows) => {
    signInWith([...modules]);
    await renderWithProviders(<MoreScreen />);
    expect(await screen.findByText("Profile")).toBeOnTheScreen();
    expect(rowLabels()).toEqual(rows);
  });

  it("each row opens its screen on the stack", async () => {
    signInWith(["tasks", "complaints", "leads"]);
    await renderWithProviders(<MoreScreen />);
    for (const [row, ...target] of [
      ["Inbox", "Inbox"],
      ["Workspaces", "Boards"],
      ["Follow-ups", "FollowUps", undefined],
      ["Profile", "Me"],
    ] as const) {
      await fireEvent.press(await screen.findByText(row));
      expect(mockNav.navigate).toHaveBeenLastCalledWith(...target);
    }
  });

  it("Inbox carries the unread badge; Workspaces your boards; Follow-ups today's count", async () => {
    jest.mocked(fetchNotifications).mockResolvedValue(unread(63));
    signInWith(["tasks", "complaints", "leads"]);
    await renderWithProviders(<MoreScreen />);
    expect(await screen.findByLabelText("63 new")).toBeOnTheScreen();
    expect(await screen.findByText("2")).toBeOnTheScreen();
    expect(await screen.findByText("4 today")).toBeOnTheScreen();
    expect(fillOf("4 today")).toBe(chipTones.butter.fill);
    const today = localDay(new Date());
    expect(fetchFollowUps).toHaveBeenCalledWith({ Status: "open", DueFrom: today, DueTo: today, PageSize: 1 });
  });

  it("nothing unread, no badge; no follow-ups today, no chip", async () => {
    jest.mocked(fetchFollowUps).mockResolvedValue(envelope({ followups: [], pagination: pagination(0) }));
    signInWith(["tasks", "complaints", "leads"]);
    await renderWithProviders(<MoreScreen />);
    await waitFor(() => expect(fetchFollowUps).toHaveBeenCalled());
    expect(screen.queryByLabelText(/new$/)).toBeNull();
    expect(screen.queryByText(/today$/)).toBeNull();
  });

  it("a role without tasks or leads fires no workspace or follow-up request", async () => {
    signInWith(["complaints"]);
    await renderWithProviders(<MoreScreen />);
    expect(await screen.findByText("Profile")).toBeOnTheScreen();
    expect(fetchWorkspaces).not.toHaveBeenCalled();
    expect(fetchFollowUps).not.toHaveBeenCalled();
  });
});

describe("the profile band", () => {
  it("name, the office (G24) and the company", async () => {
    signInWith(["tasks"]);
    await renderWithProviders(<MoreScreen />);
    expect(screen.getByText("Ayush Mishra")).toBeOnTheScreen();
    expect(await screen.findByText("Head Office · PRD Infotech (Test)")).toBeOnTheScreen();
  });

  it("until the offices load (or with no match) it shows the company alone", async () => {
    jest.mocked(fetchBranches).mockResolvedValue([]);
    signInWith(["tasks"]);
    await renderWithProviders(<MoreScreen />);
    await waitFor(() => expect(fetchBranches).toHaveBeenCalled());
    expect(screen.getByText("PRD Infotech (Test)")).toBeOnTheScreen();
  });

  // G23: JobTitle; else "Admin" for an admin; else no chip. Tone: lilac for an
  // admin, else the one module the role has, else indigo.
  it.each([
    ["an admin with no title", [], { isAdmin: true }, null, "Admin", "lilac"],
    ["a complaints-only agent (E 26)", ["complaints"], {}, "Support Agent", "Support Agent", "peach"],
    ["a leads-only rep", ["leads"], {}, "Sales Rep", "Sales Rep", "mint"],
    ["a tasks-only user", ["tasks"], {}, "Designer", "Designer", "lilac"],
    ["a two-module role", ["tasks", "leads"], {}, "Manager", "Manager", "indigo"],
  ] as const)("%s", async (_who, modules, access, JobTitle, label, tone) => {
    signInWith([...modules], { user: { Id: 7, FullName: "Ayush Mishra", JobTitle }, access });
    await renderWithProviders(<MoreScreen />);
    expect(fillOf(label)).toBe(chipTones[tone].fill);
  });

  it("no title and not an admin: no chip", async () => {
    signInWith(["tasks"]);
    await renderWithProviders(<MoreScreen />);
    expect(screen.queryByText("Admin")).toBeNull();
  });
});

describe("footnote: the modules a role lacks (E 26)", () => {
  it.each([
    [["complaints"], "Your role covers Complaints only, so Tasks, Leads, Workspaces and Follow-ups do not appear. Ask your admin if that is wrong."],
    [["leads"], "Your role covers Leads only, so Tasks, Complaints and Workspaces do not appear. Ask your admin if that is wrong."],
    [["tasks", "leads"], "Your role covers Tasks and Leads only, so Complaints does not appear. Ask your admin if that is wrong."],
    [[], "Your role covers none of the modules, so Tasks, Complaints, Leads, Workspaces and Follow-ups do not appear. Ask your admin if that is wrong."],
  ] as const)("%o", async (modules, sentence) => {
    signInWith([...modules]);
    await renderWithProviders(<MoreScreen />);
    expect(await screen.findByText(sentence)).toBeOnTheScreen();
  });

  it("a role with every module gets no footnote", async () => {
    signInWith(["tasks", "complaints", "leads"]);
    await renderWithProviders(<MoreScreen />);
    expect(await screen.findByText("Profile")).toBeOnTheScreen();
    expect(screen.queryByText(/Your role covers/)).toBeNull();
  });
});

describe("the session footer (G22)", () => {
  it("version, then when you signed in and when the session ends", async () => {
    signInWith(["tasks"]);
    useAuthStore.setState({
      loginTimestamp: new Date("2026-11-02T09:28:00+05:30").getTime(),
      sessionExpiresAt: "2026-11-02T13:30:00.000Z", // 7:00 pm IST
    });
    await renderWithProviders(<MoreScreen />);
    expect(screen.getByText("Nexus CRM · v1.0.1")).toBeOnTheScreen();
    expect(screen.getByText("Signed in since 9:28 am · session ends 7:00 pm")).toBeOnTheScreen();
  });

  it("without an expiry, only the sign-in time", async () => {
    signInWith(["tasks"]);
    useAuthStore.setState({ loginTimestamp: new Date("2026-11-02T12:05:00+05:30").getTime(), sessionExpiresAt: null });
    await renderWithProviders(<MoreScreen />);
    expect(screen.getByText("Signed in since 12:05 pm")).toBeOnTheScreen();
  });

  it("without a sign-in time, no second line", async () => {
    signInWith(["tasks"]);
    await renderWithProviders(<MoreScreen />);
    expect(screen.getByText("Nexus CRM · v1.0.1")).toBeOnTheScreen();
    expect(screen.queryByText(/Signed in since/)).toBeNull();
  });
});

describe("account rows", () => {
  it("Change password opens the password ComposeSheet (spec 19), masked", async () => {
    signInWith(["tasks"]);
    const { present } = spySheets();
    await renderWithProviders(<MoreScreen />);
    expect(present).not.toHaveBeenCalled();
    await fireEvent.press(screen.getAllByText("Change password")[0]!);
    expect(present).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText("Current password").props.secureTextEntry).toBe(true);
    expect(screen.getByRole("button", { name: "Save password" })).toBeOnTheScreen();
  });

  it("E 19: no row above the avatar, which sits 16 down; menu rows are 15/600 with 12 14 padding", async () => {
    signInWith(["tasks"]);
    await renderWithProviders(<MoreScreen />);
    const avatar = screen.getByTestId("profile-avatar");
    expect(flat(avatar).marginTop).toBe(16);
    // The avatar is the band's first content: nothing (no 52 row) before it.
    const band = avatar.parent!;
    expect(band.children.some((c) => typeof c !== "string" && flat(c).height === 52)).toBe(false);
    expect(flat(screen.getByText("Profile"))).toMatchObject({ fontSize: 15, fontFamily: "Inter_600SemiBold" });
    let row = screen.getByText("Profile").parent;
    while (row && !flat(row).paddingVertical) row = row.parent;
    expect(flat(row!)).toMatchObject({ paddingVertical: 12, paddingHorizontal: 14 });
  });

  it("Sign out asks first, then signs out and clears the session", async () => {
    signInWith(["tasks"]);
    await renderWithProviders(<MoreScreen />);
    await fireEvent.press(screen.getByText("Sign out"));
    const dialog = await screen.findByText("Sign out?");
    expect(dialog).toBeOnTheScreen();
    expect(useAuthStore.getState().isAuthenticated).toBe(true);
    // The dialog's confirm is the second "Sign out" button on screen.
    const buttons = screen.getAllByRole("button", { name: "Sign out" });
    expect(buttons).toHaveLength(2);
    await fireEvent.press(buttons[1]!);
    await waitFor(() => expect(useAuthStore.getState().isAuthenticated).toBe(false));
    expect(logout).toHaveBeenCalledTimes(1);
  });

  it("cancelling keeps the user signed in", async () => {
    signInWith(["tasks"]);
    await renderWithProviders(<MoreScreen />);
    await fireEvent.press(screen.getByText("Sign out"));
    await fireEvent.press(await screen.findByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByText("Sign out?")).toBeNull());
    expect(logout).not.toHaveBeenCalled();
    expect(useAuthStore.getState().isAuthenticated).toBe(true);
  });
});
