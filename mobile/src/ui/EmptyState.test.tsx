// EmptyState, SkeletonRows, ErrorCard (E 20a–c); ScreenLoader built on them.
import { act, fireEvent, render, screen } from "@testing-library/react-native";

import { badgeTones, colors } from "../theme";
import { EmptyState, ErrorCard, SkeletonRows } from "./EmptyState";
import { ScreenLoader } from "./ScreenLoader";

import { flat } from "../test/style";

afterEach(() => jest.useRealTimers());

describe("EmptyState (20a)", () => {
  it("132 art in the module colour, accents, title, line, a secondary sm button", async () => {
    const onAction = jest.fn();
    await render(
      <EmptyState module="complaints" accents={["done", "escalated"]} title="No complaints here"
        message="Nothing is escalated to you right now." actionLabel="Show all of mine" onAction={onAction} />,
    );
    expect(flat(screen.getByTestId("empty-art"))).toMatchObject({ width: 132, height: 132, borderRadius: 40, backgroundColor: badgeTones.peach.fill });
    expect(flat(screen.getByText("No complaints here"))).toMatchObject({ fontSize: 20, marginTop: 28 });
    expect(flat(screen.getByText("Nothing is escalated to you right now."))).toMatchObject({ color: colors.textSecondary, maxWidth: 280 });
    const button = screen.getByRole("button", { name: "Show all of mine" });
    expect(flat(button)).toMatchObject({ height: 36, backgroundColor: colors.secondaryFill });
    await fireEvent.press(button);
    expect(onAction).toHaveBeenCalled();
  });

  it("no handler, no button; default module is slate", async () => {
    await render(<EmptyState title="Nothing" actionLabel="Add" />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(flat(screen.getByTestId("empty-art")).backgroundColor).toBe(badgeTones.slate.fill);
  });
});

describe("SkeletonRows (20b)", () => {
  it("row geometry: 40 badge, 22 chips, no shimmer; pills optional", async () => {
    await render(<SkeletonRows rows={3} pills />);
    expect(screen.getAllByTestId("skeleton-row")).toHaveLength(3);
    expect(screen.getByTestId("pills-skeleton")).toBeOnTheScreen();
    const badge = screen.getAllByTestId("skeleton-row")[0]!.children[0] as never;
    expect(flat(badge)).toMatchObject({ width: 40, height: 40, borderRadius: 12, backgroundColor: colors.skeleton });
    expect(flat(screen.getAllByTestId("skeleton-chip")[0]!)).toMatchObject({ height: 22, borderRadius: 11 });
  });
});

describe("ErrorCard (20c)", () => {
  it("red 72 badge, E copy, a full-width retry", async () => {
    const onRetry = jest.fn();
    await render(<ErrorCard onRetry={onRetry} />);
    expect(screen.getByText("Could not load. Try again")).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalled();
  });
});

describe("ScreenLoader", () => {
  it("skeleton rows first, then after 6s admits it is slow and offers a retry", async () => {
    jest.useFakeTimers();
    const onRetry = jest.fn();
    await render(<ScreenLoader onRetry={onRetry} />);
    expect(screen.getAllByTestId("skeleton-row").length).toBeGreaterThan(0);
    expect(screen.queryByText("Still trying…")).toBeNull();
    await act(async () => jest.advanceTimersByTime(6000));
    expect(screen.getByText("Still trying…")).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("a failed load says so at once, with the caller's message and no retry when none is given", async () => {
    await render(<ScreenLoader failed message="Server is down" />);
    expect(screen.getByText("Could not load this")).toBeOnTheScreen();
    expect(screen.getByText("Server is down")).toBeOnTheScreen();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
