import { act, fireEvent, screen, waitFor } from "@testing-library/react-native";

import { fetchTasks } from "../../api/taskQueries";
import { updateMyProfile } from "../../api/userQueries";
import { fetchWorkspaces } from "../../api/workspaceQueries";
import useAuthStore from "../../stores/useAuthStore";
import { envelope, serverError } from "../../test/fixtures";
import { makeNavigation, makeRoute, renderWithProviders, seedAuth } from "../../test/renderWithProviders";
import { PHONE, setWindow } from "../../test/window";
import MeScreen from "./MeScreen";

jest.mock("../../api/taskQueries");
jest.mock("../../api/userQueries");
jest.mock("../../api/workspaceQueries");

const asha = { Id: 7, FullName: "Asha Patel", Email: "asha@x.in", Mobile: "9825012345", Avatar: "color:violet", Username: "asha" };
const navigation = makeNavigation<"Me">();
const mountMe = () => renderWithProviders(<MeScreen navigation={navigation} route={makeRoute("Me", undefined)} />);
const save = () => fireEvent.press(screen.getByRole("button", { name: "Save" }));

beforeEach(() => {
  setWindow(...PHONE);
  seedAuth({ user: asha });
  useAuthStore.setState({ companyName: "PRD Infotech (Test)" });
});

it("the band shows who is signed in, with Save and back — no extra line under the name", async () => {
  await mountMe();
  expect(screen.getByText("Profile")).toBeOnTheScreen();
  expect(screen.getByText("Asha Patel")).toBeOnTheScreen();
  expect(screen.queryByText(/asha · /)).toBeNull();
  expect(screen.queryByText(/PRD Infotech/)).toBeNull();
  expect(screen.getByRole("button", { name: "Save" })).toBeOnTheScreen();
  // Nothing edited: back goes straight back.
  await fireEvent.press(screen.getByRole("button", { name: "Go back" }));
  expect(navigation.goBack).toHaveBeenCalled();
  expect(screen.queryByText("Discard changes?")).toBeNull();
});

describe("back with unsaved edits", () => {
  it("asks first; Keep editing stays with the edits", async () => {
    await mountMe();
    await fireEvent.changeText(screen.getByLabelText("Display name"), "Asha P");
    await fireEvent.press(screen.getByRole("button", { name: "Go back" }));
    expect(await screen.findByText("Discard changes?")).toBeOnTheScreen();
    expect(navigation.goBack).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole("button", { name: "Keep editing" }));
    await waitFor(() => expect(screen.queryByText("Discard changes?")).toBeNull());
    expect(screen.getByLabelText("Display name")).toHaveDisplayValue("Asha P");
    expect(navigation.goBack).not.toHaveBeenCalled();
  });

  it("Discard goes back without saving; an avatar pick counts as an edit", async () => {
    await mountMe();
    await fireEvent.press(screen.getByLabelText("Colour blue"));
    await fireEvent.press(screen.getByRole("button", { name: "Go back" }));
    await fireEvent.press(await screen.findByRole("button", { name: "Discard" }));
    expect(navigation.goBack).toHaveBeenCalled();
    expect(updateMyProfile).not.toHaveBeenCalled();
  });
});

it("the form opens filled with the current values", async () => {
  await mountMe();
  expect(screen.getByLabelText("Display name")).toHaveDisplayValue("Asha Patel");
  expect(screen.getByLabelText("Email")).toHaveDisplayValue("asha@x.in");
  expect(screen.getByLabelText("Mobile")).toHaveDisplayValue("9825012345");
  expect(screen.getByLabelText("Colour violet")).toBeSelected();
});

// Task 34: the stats tiles are dropped (E has no Me frame; spec §4.1 19).
it("fires no task or workspace requests — Profile is for every role", async () => {
  await mountMe();
  expect(screen.queryByText("Assigned")).toBeNull();
  expect(fetchTasks).not.toHaveBeenCalled();
  expect(fetchWorkspaces).not.toHaveBeenCalled();
});

it("no user loaded: a dash", async () => {
  await mountMe();
  await act(async () => useAuthStore.setState({ user: null }));
  expect(await screen.findByText("—")).toBeOnTheScreen();
});

// parity: ME-01 — edit own profile, as the web's AccountModal.
describe("Save", () => {
  it("sends all four fields, cleaned, updates who is signed in, and goes back", async () => {
    jest.mocked(updateMyProfile).mockResolvedValue(envelope({}));
    await mountMe();
    await fireEvent.changeText(screen.getByLabelText("Display name"), "  Asha P  ");
    await fireEvent.changeText(screen.getByLabelText("Mobile"), "+91 98250 99999");
    await fireEvent.press(screen.getByLabelText("Icon rocket"));
    await fireEvent.press(screen.getByLabelText("Colour blue"));
    await save();

    const sent = { FullName: "Asha P", Email: "asha@x.in", Mobile: "9825099999", Avatar: "icon:rocket|blue" };
    await waitFor(() => expect(updateMyProfile).toHaveBeenCalledWith(sent));
    expect(await screen.findByText("Profile updated")).toBeOnTheScreen();
    expect(useAuthStore.getState().user).toMatchObject(sent);
    expect(navigation.goBack).toHaveBeenCalled();
  });

  it("blank email and mobile go as null; a colour alone gives coloured initials", async () => {
    jest.mocked(updateMyProfile).mockResolvedValue(envelope({}));
    seedAuth({ user: { ...asha, Avatar: null } });
    await mountMe();
    await fireEvent.changeText(screen.getByLabelText("Email"), "  ");
    await fireEvent.changeText(screen.getByLabelText("Mobile"), "");
    await fireEvent.press(screen.getByLabelText("Colour green"));
    await save();
    await waitFor(() =>
      expect(updateMyProfile).toHaveBeenCalledWith({ FullName: "Asha Patel", Email: null, Mobile: null, Avatar: "color:green" }),
    );
  });

  it("an avatar the picker cannot show is sent back unchanged", async () => {
    jest.mocked(updateMyProfile).mockResolvedValue(envelope({}));
    seedAuth({ user: { ...asha, Avatar: "emoji:x" } });
    await mountMe();
    await save();
    await waitFor(() => expect(updateMyProfile).toHaveBeenCalledWith(expect.objectContaining({ Avatar: "emoji:x" })));
  });

  it("refuses a blank name or a mobile that is not ten digits, without a request", async () => {
    await mountMe();
    await fireEvent.changeText(screen.getByLabelText("Mobile"), "12345");
    await save();
    expect(await screen.findByText("A mobile number is ten digits.")).toBeOnTheScreen();
    await fireEvent.changeText(screen.getByLabelText("Mobile"), "9825012345");
    await fireEvent.changeText(screen.getByLabelText("Display name"), " ");
    await save();
    expect(await screen.findByText("Your name cannot be blank.")).toBeOnTheScreen();
    expect(updateMyProfile).not.toHaveBeenCalled();
  });

  it("shows the server's reason and stays on the form", async () => {
    jest.mocked(updateMyProfile).mockRejectedValue(serverError(409, "Mobile already in use"));
    await mountMe();
    await save();
    expect(await screen.findByText("Mobile already in use")).toBeOnTheScreen();
    expect(navigation.goBack).not.toHaveBeenCalled();
    expect(useAuthStore.getState().user?.FullName).toBe("Asha Patel");
  });
});
