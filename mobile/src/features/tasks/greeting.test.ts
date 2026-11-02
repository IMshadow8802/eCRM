import { greetingFor, longDate } from "./greeting";

const at = (h: number) => new Date(2026, 7, 2, h, 0);

it("greets by the device's local hour", () => {
  // Both sides of every boundary.
  const cases: [number, string][] = [
    [4, "Working late"],
    [5, "Good morning"],
    [11, "Good morning"],
    [12, "Good afternoon"],
    [16, "Good afternoon"],
    [17, "Good evening"],
    [20, "Good evening"],
    [21, "Good night"],
  ];
  for (const [hour, text] of cases) expect([hour, greetingFor(at(hour)).text]).toEqual([hour, text]);
  expect(greetingFor(at(9)).emoji).toBe("👋");
});

it("longDate is the weekday, day and month", () => {
  expect(longDate(at(9))).toBe("Sunday, 2 August");
});
