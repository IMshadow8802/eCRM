import { fireEvent, screen } from "@testing-library/react-native";

import type { Workspace } from "../../types/api";
import { renderWithProviders } from "../../test/renderWithProviders";
import { WorkspaceCard } from "./WorkspaceCard";

const ws = (patch: Partial<Workspace> = {}) =>
  ({
    Id: 3,
    Name: "Launch plan",
    Type: "shared",
    IsArchived: false,
    MyRole: "manager",
    MyInviteStatus: "active",
    MemberCount: 4,
    ...patch,
  }) as Workspace;

it("shows name, type, member count and the caller's role; a tap hands back the workspace", async () => {
  const onPress = jest.fn();
  const workspace = ws();
  await renderWithProviders(<WorkspaceCard workspace={workspace} onPress={onPress} />);
  expect(screen.getByText("Launch plan")).toBeOnTheScreen();
  expect(screen.getByText("Shared")).toBeOnTheScreen();
  expect(screen.getByText("4 members")).toBeOnTheScreen();
  expect(screen.getByText("manager")).toBeOnTheScreen();
  await fireEvent.press(screen.getByText("Launch plan"));
  expect(onPress).toHaveBeenCalledWith(workspace);
});

it("one member is singular; a missing count reads as zero", async () => {
  const { rerender } = await renderWithProviders(
    <WorkspaceCard workspace={ws({ MemberCount: 1 })} onPress={jest.fn()} />,
  );
  expect(screen.getByText("1 member")).toBeOnTheScreen();
  await rerender(
    <WorkspaceCard workspace={ws({ MemberCount: null, Type: "project", IsArchived: true })} onPress={jest.fn()} />,
  );
  expect(screen.getByText("0 members")).toBeOnTheScreen();
  expect(screen.getByText("Project")).toBeOnTheScreen();
});

it("a personal board shows no member count, and no role when the caller has none", async () => {
  await renderWithProviders(
    <WorkspaceCard workspace={ws({ Type: "personal", MyRole: null })} onPress={jest.fn()} />,
  );
  expect(screen.getByText("Personal")).toBeOnTheScreen();
  expect(screen.queryByText(/member/)).toBeNull();
  expect(screen.queryByText("manager")).toBeNull();
});
