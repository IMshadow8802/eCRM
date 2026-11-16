import { describe, it, expect, vi } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import dayjs from "dayjs";

vi.mock("../../components/ui/DateField", () => import("../../test/DateFieldStub"));
import renderWithProviders from "../../test/renderWithProviders";
import DueInputs from "./DueInputs";

const setup = (props) =>
  renderWithProviders(<DueInputs date="" time="" onDateChange={vi.fn()} onTimeChange={vi.fn()} dateLabel="Due" dateTestId="d" timeTestId="t" {...props} />);

describe("DueInputs", () => {
  it("time is disabled until a date is set", () => {
    setup();
    expect(screen.getByTestId("t")).toBeDisabled();
  });
  it("typing a time reports HH:mm", () => {
    const onTimeChange = vi.fn();
    setup({ date: dayjs().add(1, "day").format("YYYY-MM-DD"), onTimeChange });
    fireEvent.change(screen.getByTestId("t"), { target: { value: "12:30" } });
    expect(onTimeChange).toHaveBeenCalledWith("12:30");
  });
  it("date change is forwarded", () => {
    const onDateChange = vi.fn();
    setup({ onDateChange });
    fireEvent.change(screen.getByTestId("d"), { target: { value: "2030-01-02" } });
    expect(onDateChange).toHaveBeenCalledWith("2030-01-02");
  });
  it("a past time today shows the error", () => {
    setup({ date: dayjs().subtract(1, "day").format("YYYY-MM-DD"), time: "00:01" });
    expect(screen.getByText("Pick a time from now on")).toBeInTheDocument();
  });
  it("a future time shows no error", () => {
    setup({ date: dayjs().add(1, "day").format("YYYY-MM-DD"), time: "09:00" });
    expect(screen.queryByText("Pick a time from now on")).toBeNull();
  });
});
