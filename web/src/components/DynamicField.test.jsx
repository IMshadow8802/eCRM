import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThemeProvider } from "@mui/material/styles";
import { buildTheme } from "../theme";
import DynamicField from "./DynamicField";

const wrap = (ui) => render(<ThemeProvider theme={buildTheme("light")}>{ui}</ThemeProvider>);

describe("DynamicField", () => {
  it("renders a dropdown from Options and fires onChange with the picked value", async () => {
    const onChange = vi.fn();
    const field = {
      Id: 1,
      Label: "Source",
      Type: "dropdown",
      Options: JSON.stringify(["Web", "Referral"]),
      IsRequired: false,
    };
    wrap(<DynamicField field={field} value={null} onChange={onChange} />);

    const user = userEvent.setup();
    await user.click(screen.getByRole("combobox"));
    await user.click(await screen.findByText("Referral"));

    expect(onChange).toHaveBeenCalledWith("Referral");
  });

  it("renders the required marker when IsRequired is true", () => {
    const field = { Id: 2, Label: "Company", Type: "text", IsRequired: true };
    wrap(<DynamicField field={field} value="" onChange={() => {}} />);
    expect(screen.getByText("Company")).toBeInTheDocument();
    expect(screen.getByText("*")).toBeInTheDocument();
  });

  it("does not render a required marker when IsRequired is false", () => {
    const field = { Id: 3, Label: "Notes", Type: "text", IsRequired: false };
    wrap(<DynamicField field={field} value="" onChange={() => {}} />);
    expect(screen.queryByText("*")).not.toBeInTheDocument();
  });

  it("renders a text field and fires onChange with the typed value", async () => {
    const onChange = vi.fn();
    const field = { Id: 4, Label: "Company", Type: "text", IsRequired: false };
    wrap(<DynamicField field={field} value="" onChange={onChange} />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Company"), "Acme");
    expect(onChange).toHaveBeenCalledWith("A");
  });

  it("renders a number field and fires onChange with the numeric value", async () => {
    const onChange = vi.fn();
    const field = { Id: 5, Label: "Budget", Type: "number", IsRequired: false };
    wrap(<DynamicField field={field} value="" onChange={onChange} />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Budget"), "5");
    expect(onChange).toHaveBeenCalledWith("5");
  });

  it("renders a date field", () => {
    const field = { Id: 6, Label: "Close Date", Type: "date", IsRequired: false };
    wrap(<DynamicField field={field} value="" onChange={() => {}} />);
    expect(screen.getByLabelText("Close Date")).toBeInTheDocument();
  });

  it("renders a checkbox field and fires onChange with the boolean value", () => {
    const onChange = vi.fn();
    const field = { Id: 7, Label: "Active", Type: "checkbox", IsRequired: false };
    wrap(<DynamicField field={field} value={false} onChange={onChange} />);
    // Switch's real input has pointer-events:none by design (the visible
    // track is what's clickable) — fireEvent bypasses that, same as
    // ui/Switch.test.jsx does for the identical reason.
    fireEvent.click(screen.getByRole("switch"));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("shows the required marker on a checkbox field too", () => {
    const field = { Id: 8, Label: "Active", Type: "checkbox", IsRequired: true };
    wrap(<DynamicField field={field} value={false} onChange={() => {}} />);
    expect(screen.getByText("*")).toBeInTheDocument();
  });

  it("accepts Options already parsed as an array of {value,label} objects", async () => {
    const onChange = vi.fn();
    const field = {
      Id: 9,
      Label: "Status",
      Type: "dropdown",
      Options: [
        { value: "open", label: "Open" },
        { value: "won", label: "Won" },
      ],
      IsRequired: false,
    };
    wrap(<DynamicField field={field} value={null} onChange={onChange} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("combobox"));
    await user.click(await screen.findByText("Won"));
    expect(onChange).toHaveBeenCalledWith("won");
  });

  it("falls back to an empty option list when Options is invalid JSON", async () => {
    const field = { Id: 10, Label: "Broken", Type: "dropdown", Options: "{not json", IsRequired: false };
    wrap(<DynamicField field={field} value={null} onChange={() => {}} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("combobox"));
    expect(await screen.findByText(/Nothing found/i)).toBeInTheDocument();
  });

  it("defaults unknown Type to a text input", () => {
    const field = { Id: 11, Label: "Whatever", Type: "mystery", IsRequired: false };
    wrap(<DynamicField field={field} value="" onChange={() => {}} />);
    expect(screen.getByLabelText("Whatever")).toBeInTheDocument();
  });

  it("handles a missing field definition without crashing (defaults to text)", () => {
    wrap(<DynamicField value="" onChange={() => {}} />);
    expect(screen.getByRole("textbox")).toBeInTheDocument();
  });

  it("treats a null/undefined value as empty for text, number and date", () => {
    wrap(
      <>
        <DynamicField field={{ Label: "T", Type: "text" }} value={null} onChange={() => {}} />
        <DynamicField field={{ Label: "N", Type: "number" }} value={undefined} onChange={() => {}} />
        <DynamicField field={{ Label: "D", Type: "date" }} value={null} onChange={() => {}} />
      </>,
    );
    expect(screen.getByLabelText("T")).toHaveValue("");
    expect(screen.getByLabelText("N")).toHaveValue(null);
    expect(screen.getByLabelText("D")).toHaveValue("");
  });

  it("treats missing/non-array Options as an empty option list", async () => {
    const field = { Label: "No Options", Type: "dropdown" };
    wrap(<DynamicField field={field} value={null} onChange={() => {}} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("combobox"));
    expect(await screen.findByText(/Nothing found/i)).toBeInTheDocument();
  });

  it("clears the dropdown selection by firing onChange with null", async () => {
    const onChange = vi.fn();
    const field = {
      Label: "Source",
      Type: "dropdown",
      Options: ["Web", "Referral"],
    };
    wrap(<DynamicField field={field} value="Web" onChange={onChange} />);
    const user = userEvent.setup();
    await user.click(screen.getByLabelText("Clear"));
    expect(onChange).toHaveBeenCalledWith(null);
  });
});
