import { act, fireEvent, render, screen } from "@testing-library/react-native";

import { Button } from "./Button";
import { renderWithProviders } from "../test/renderWithProviders";
import { useToast } from "./Toast";

function Trigger({ tone, message }: { tone: "error" | "success"; message: string }) {
  const toast = useToast();
  return <Button title={`fire ${message}`} onPress={() => toast[tone](message)} />;
}

afterEach(() => jest.useRealTimers());

it("an error shows the server's words and a tap dismisses it", async () => {
  await renderWithProviders(<Trigger tone="error" message="  Not allowed  " />);
  await fireEvent.press(screen.getByText("fire   Not allowed  "));
  const toast = screen.getByRole("alert");
  expect(toast).toHaveAccessibleName("Not allowed");
  await fireEvent.press(toast);
  expect(screen.queryByRole("alert")).toBeNull();
});

it("a blank message shows nothing", async () => {
  await renderWithProviders(<Trigger tone="error" message="   " />);
  await fireEvent.press(screen.getByRole("button"));
  expect(screen.queryByRole("alert")).toBeNull();
});

it("a newer toast replaces the one on screen", async () => {
  await renderWithProviders(
    <>
      <Trigger tone="error" message="First" />
      <Trigger tone="success" message="Second" />
    </>,
  );
  await fireEvent.press(screen.getByText("fire First"));
  await fireEvent.press(screen.getByText("fire Second"));
  expect(screen.getAllByRole("alert")).toHaveLength(1);
  expect(screen.getByRole("alert")).toHaveAccessibleName("Second");
});

it("a confirmation leaves on its own; an error outlives it", async () => {
  jest.useFakeTimers();
  await renderWithProviders(
    <>
      <Trigger tone="success" message="Saved" />
      <Trigger tone="error" message="Refused" />
    </>,
  );
  await fireEvent.press(screen.getByText("fire Saved"));
  await act(async () => jest.advanceTimersByTime(3000));
  expect(screen.queryByRole("alert")).toBeNull();

  await fireEvent.press(screen.getByText("fire Refused"));
  await act(async () => jest.advanceTimersByTime(3000));
  expect(screen.getByRole("alert")).toHaveAccessibleName("Refused");
  await act(async () => jest.advanceTimersByTime(2500));
  expect(screen.queryByRole("alert")).toBeNull();
});

it("useToast outside the provider throws instead of silently doing nothing", async () => {
  // React logs the thrown render error; silenced for this test only.
  const quiet = jest.spyOn(console, "error").mockImplementation(() => {});
  try {
    await expect(render(<Trigger tone="error" message="x" />)).rejects.toThrow(/inside <ToastProvider>/);
  } finally {
    quiet.mockRestore();
  }
});
