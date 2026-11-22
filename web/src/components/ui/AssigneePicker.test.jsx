import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThemeProvider } from "@mui/material/styles";
import { buildTheme } from "../../theme";

vi.mock("../../hooks/useAssignableUsers", () => ({ useAssignableUsers: vi.fn() }));
import { useAssignableUsers } from "../../hooks/useAssignableUsers";
import AssigneePicker from "./AssigneePicker";

const USERS = [
  { Id: 3, FullName: "Zara Other", JobTitle: "Agent", BranchName: "South", GroupRank: 3, Mobile: "9825012345", Email: "z@x.in" },
  { Id: 1, FullName: "Nitin Manager", JobTitle: "Team lead", BranchName: "Head office", GroupRank: 1, IsGiver: true },
  { Id: 2, FullName: "Vivek Office", JobTitle: null, BranchName: "Head office", GroupRank: 2, AwayToday: true },
];

const wrap = (props = {}) =>
  render(
    <ThemeProvider theme={buildTheme("light")}>
      <AssigneePicker module="complaints" recordId={7} value={null} onChange={() => {}} {...props} />
    </ThemeProvider>,
  );
const open = async () => {
  const user = userEvent.setup();
  await user.click(screen.getByRole("combobox"));
  return user;
};

describe("AssigneePicker", () => {
  beforeEach(() => useAssignableUsers.mockReturnValue({ users: USERS, isLoading: false }));

  it("asks for the module's roster for this record", () => {
    wrap({ enabled: false });
    expect(useAssignableUsers).toHaveBeenLastCalledWith({ module: "complaints", recordId: 7, enabled: false });
    expect(screen.getByLabelText("Assign to")).toBeInTheDocument();
  });

  it("renders the three group headings in rank order", async () => {
    wrap();
    await open();
    const text = screen.getByRole("listbox").textContent;
    const at = (s) => text.indexOf(s);
    expect(at("Your manager and team")).toBeGreaterThan(-1);
    expect(at("Your manager and team")).toBeLessThan(at("Your office"));
    expect(at("Your office")).toBeLessThan(at("Other offices"));
    expect(at("Nitin Manager")).toBeLessThan(at("Vivek Office"));
  });

  it("shows Away today and Gave it to you only on flagged rows, never phone or email", async () => {
    wrap();
    await open();
    expect(within(screen.getByTestId("assignee-option-2")).getByText("Away today")).toBeInTheDocument();
    expect(within(screen.getByTestId("assignee-option-1")).queryByText("Away today")).toBeNull();
    expect(within(screen.getByTestId("assignee-option-1")).getByText("Gave it to you")).toBeInTheDocument();
    expect(screen.getAllByText("Away today")).toHaveLength(1);
    expect(within(screen.getByTestId("assignee-option-1")).getByText("Team lead · Head office")).toBeInTheDocument();
    expect(within(screen.getByTestId("assignee-option-2")).getByText("Head office")).toBeInTheDocument();
    expect(screen.queryByText(/9825012345|z@x\.in/)).toBeNull();
  });

  it("filters as you type and hands back the id and the person", async () => {
    const onChange = vi.fn();
    wrap({ onChange });
    const user = await open();
    await user.type(screen.getByRole("combobox"), "viv");
    expect(screen.queryByText("Nitin Manager")).toBeNull();
    await user.click(screen.getByText("Vivek Office"));
    expect(onChange).toHaveBeenCalledWith(2, USERS[2]);
  });

  it("says nothing found when typing matches nobody", async () => {
    wrap();
    const user = await open();
    await user.type(screen.getByRole("combobox"), "qqq");
    expect(screen.getByText("Nothing found")).toBeInTheDocument();
  });

  it("shows the empty text when nobody can take it", async () => {
    useAssignableUsers.mockReturnValue({ users: [], isLoading: false });
    wrap();
    await open();
    expect(screen.getByText("Nobody can take this. Ask a manager.")).toBeInTheDocument();
  });

  it("shows the current value; allowUnassigned lets it clear to null", async () => {
    const onChange = vi.fn();
    wrap({ value: 1, allowUnassigned: true, onChange, label: "Reassign to" });
    expect(screen.getByRole("combobox")).toHaveValue("Nitin Manager");
    const user = userEvent.setup();
    await user.click(screen.getByLabelText("Clear"));
    expect(onChange).toHaveBeenCalledWith(null, null);
  });

  it("without allowUnassigned there is no clear button", () => {
    wrap({ value: 1 });
    expect(screen.queryByLabelText("Clear")).toBeNull();
  });
});
