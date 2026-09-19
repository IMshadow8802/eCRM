import { describe, it, expect, vi } from "vitest";
import { screen, fireEvent, waitFor, within } from "@testing-library/react";
import renderWithProviders from "../../../../test/renderWithProviders";

// The editor has its own suite (components/ui). Here it is a labelled textarea.
vi.mock("../../../../components/ui/RichTextEditor", () => ({
  __esModule: true,
  default: ({ label, value, onChange, disabled }) => <textarea aria-label={label} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} />,
}));

import SectionsEditor from "./SectionsEditor";

const SECTIONS = [
  { key: "s1", type: "text", title: "Scope", body: "<p>x</p>" },
  { key: "s2", type: "images", title: "Sites", items: [{ attachmentId: 21, caption: "Bopal" }] },
];
const draw = (props = {}) => {
  const onChange = vi.fn();
  renderWithProviders(<SectionsEditor sections={SECTIONS} images={{ 21: "data:site" }} onChange={onChange} onUploadPicture={vi.fn()} {...props} />);
  return onChange;
};
const sec = (i) => screen.getAllByTestId("quote-section")[i];

describe("SectionsEditor", () => {
  it("adds a text section and a picture section", () => {
    const onChange = draw();
    fireEvent.click(screen.getByRole("button", { name: /add text section/i }));
    expect(onChange.mock.calls.at(-1)[0][2]).toMatchObject({ type: "text", title: "", body: "" });
    fireEvent.click(screen.getByRole("button", { name: /add picture section/i }));
    expect(onChange.mock.calls.at(-1)[0][2]).toMatchObject({ type: "images", title: "", items: [] });
  });

  it("edits a title and a body", () => {
    const onChange = draw();
    fireEvent.change(within(sec(0)).getByLabelText("Section title"), { target: { value: "What is included" } });
    expect(onChange.mock.calls.at(-1)[0][0].title).toBe("What is included");
    fireEvent.change(within(sec(0)).getByLabelText("Section text"), { target: { value: "<p>y</p>" } });
    expect(onChange.mock.calls.at(-1)[0][0].body).toBe("<p>y</p>");
  });

  it("uploads a picture into its section, captions it, and removes it", async () => {
    const onUploadPicture = vi.fn().mockResolvedValue({ id: 33 });
    const onChange = draw({ onUploadPicture });
    const file = new File(["x"], "site.jpg", { type: "image/jpeg" });
    fireEvent.change(within(sec(1)).getByTestId("section-file"), { target: { files: [file] } });
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(onUploadPicture).toHaveBeenCalledWith(file);
    expect(onChange.mock.calls.at(-1)[0][1].items).toEqual([{ attachmentId: 21, caption: "Bopal" }, { attachmentId: 33, caption: "" }]);

    fireEvent.change(within(sec(1)).getByLabelText("Caption 1"), { target: { value: "Bopal, 5 kW" } });
    expect(onChange.mock.calls.at(-1)[0][1].items[0].caption).toBe("Bopal, 5 kW");
    fireEvent.click(within(sec(1)).getByRole("button", { name: "Remove picture 1" }));
    expect(onChange.mock.calls.at(-1)[0][1].items).toEqual([]);
  });

  it("shows the upload's refusal next to the section, and changes nothing", async () => {
    const onUploadPicture = vi.fn().mockRejectedValue(new Error("Use a PNG or JPEG image"));
    const onChange = draw({ onUploadPicture });
    fireEvent.change(within(sec(1)).getByTestId("section-file"), { target: { files: [new File(["x"], "a.webp", { type: "image/webp" })] } });
    expect(await within(sec(1)).findByRole("alert")).toHaveTextContent("Use a PNG or JPEG image");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("reorders and removes sections", () => {
    const onChange = draw();
    fireEvent.click(within(sec(1)).getByRole("button", { name: "Move section up" }));
    expect(onChange.mock.calls.at(-1)[0].map((s) => s.key)).toEqual(["s2", "s1"]);
    fireEvent.click(within(sec(0)).getByRole("button", { name: "Remove section" }));
    expect(onChange.mock.calls.at(-1)[0].map((s) => s.key)).toEqual(["s2"]);
  });

  it("is read-only when disabled", () => {
    draw({ disabled: true });
    expect(screen.queryByRole("button", { name: /add text section/i })).toBeNull();
    expect(within(sec(0)).getByLabelText("Section title")).toBeDisabled();
  });
});
