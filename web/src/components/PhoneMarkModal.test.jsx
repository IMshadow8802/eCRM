import { describe, it, expect, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import PhoneMarkModal from "./PhoneMarkModal";
import renderWithProviders from "../test/renderWithProviders";
import { mockCallingEndpoints } from "../test/callingMocks";

describe("PhoneMarkModal", () => {
  it("needs a note, then posts the number, the mark and the note", async () => {
    const cap = mockCallingEndpoints();
    const onClose = vi.fn();
    renderWithProviders(<PhoneMarkModal open mobile="9811456021" onClose={onClose} />);
    const user = userEvent.setup();
    expect(screen.getByTestId("mark-save")).toBeDisabled();
    await user.click(screen.getByRole("radio", { name: "Call with caution" }));
    await user.type(screen.getByTestId("mark-note"), "Call after 6 pm");
    await user.click(screen.getByTestId("mark-save"));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(cap.markSet).toEqual({ Mobile: "9811456021", Mark: "caution", Note: "Call after 6 pm" });
  });

  it("an admin types the number; a refusal keeps the modal open with the sentence", async () => {
    const cap = mockCallingEndpoints({ fail: { markSet: "This number is already marked" } });
    const onClose = vi.fn();
    renderWithProviders(<PhoneMarkModal open onClose={onClose} />);
    const user = userEvent.setup();
    await user.type(screen.getByTestId("mark-mobile"), "98112 40087");
    await user.type(screen.getByTestId("mark-note"), "Wrote to the office");
    await user.click(screen.getByTestId("mark-save"));
    expect(await screen.findByTestId("mark-error")).toHaveTextContent("This number is already marked");
    expect(cap.markSet).toMatchObject({ Mobile: "9811240087", Mark: "dnc" });
    expect(onClose).not.toHaveBeenCalled();
  });
});
