import { fireEvent, screen } from "@testing-library/react-native";

import { callContact } from "../../test/fixtures";
import { renderWithProviders } from "../../test/renderWithProviders";
import { ContactCard } from "./ContactCard";

const handlers = () => ({ onCall: jest.fn(), onResult: jest.fn(), onScript: jest.fn() });

it("shows who, the number with the alt, the list, city, tries, the mark and every sheet line", async () => {
  const h = handlers();
  await renderWithProviders(
    <ContactCard
      {...h}
      scriptAvailable
      now={new Date(2026, 10, 16, 9, 0)}
      contact={callContact({
        Name: "Mr. Bedi", Company: "Bedi Traders", AltMobile: "9312245610", Attempts: 2, LastResult: "no_answer",
        LastCalledAt: "2026-11-15T16:10:00", PhoneMark: "caution", PhoneMarkNote: "Speaks only Punjabi",
        extras: [{ label: "Address", value: "45, Lajpat Nagar II" }, { label: "Anniversary", value: "03-Mar" }],
      })}
    />,
  );
  expect(screen.getByText("Mr. Bedi")).toBeOnTheScreen();
  expect(screen.getByText(" · alt 9312245610")).toBeOnTheScreen();
  expect(screen.getByText("Bedi Traders")).toBeOnTheScreen();
  expect(screen.getByText("MLSS Delhi")).toBeOnTheScreen();
  expect(screen.getByText("3rd try · no answer yesterday 4:10 pm")).toBeOnTheScreen();
  expect(screen.getByText("Call with caution — Speaks only Punjabi")).toBeOnTheScreen();
  expect(screen.getByText("Address")).toBeOnTheScreen();
  expect(screen.getByText("03-Mar")).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "Script" }));
  await fireEvent.press(screen.getByRole("button", { name: "Call Mr. Bedi" }));
  await fireEvent.press(screen.getByRole("button", { name: "Save result for Mr. Bedi" }));
  expect(h.onScript).toHaveBeenCalled();
  expect(h.onCall).toHaveBeenCalled();
  expect(h.onResult).toHaveBeenCalled();
});

it("a bare contact: titled by its number, no script link, no tries, no mark, no lines", async () => {
  await renderWithProviders(
    <ContactCard {...handlers()} scriptAvailable={false} contact={callContact({ Name: null, City: null, extras: [] })} />,
  );
  expect(screen.getAllByText("9825012345")).toHaveLength(2);
  expect(screen.queryByRole("button", { name: "Script" })).toBeNull();
  expect(screen.queryByText(/try/)).toBeNull();
  expect(screen.queryByRole("alert")).toBeNull();
});

it("a callback carries its time chip", async () => {
  await renderWithProviders(
    <ContactCard {...handlers()} scriptAvailable={false} contact={callContact()} timeChip={{ label: "tomorrow 11:00 am", tone: "sky" }} />,
  );
  expect(screen.getByText("tomorrow 11:00 am")).toBeOnTheScreen();
});
