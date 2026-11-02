// Chip, ChipGroup, Segmented, Checkbox: the small pick-and-show controls.
import { StyleSheet } from "react-native";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { Flag } from "lucide-react-native";

import { chipTones } from "../theme";
import { Checkbox } from "./Checkbox";
import { Chip } from "./Chip";
import { ChipGroup } from "./ChipGroup";
import { Segmented } from "./Segmented";

describe("Chip", () => {
  it("shows its label as a sorbet pill: soft fill, the hue's dark ink on text and icon", async () => {
    await render(<Chip label="Overdue" tone="danger" icon={Flag} />);
    const label = screen.getByText("Overdue");
    expect(StyleSheet.flatten(label.parent!.props.style).backgroundColor).toBe(chipTones.danger.fill);
    expect(label).toHaveStyle({ color: chipTones.danger.text });
    expect(JSON.stringify(label.parent!.children[0])).toContain(`"stroke":"${chipTones.danger.text}"`);
  });

  it("defaults to neutral, and maxWidth caps it", async () => {
    await render(<Chip label="Hot" maxWidth={80} />);
    const style = StyleSheet.flatten(screen.getByText("Hot").parent!.props.style);
    expect(style).toMatchObject({ backgroundColor: chipTones.neutral.fill, maxWidth: 80 });
  });

  // WCAG relative luminance — every tone must stay legible as a 12px caption.
  const lum = (hex: string) => {
    const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
  };
  it.each(Object.entries(chipTones))("%s: solid fill and text at least 4.5:1", (_, { fill, text }) => {
    expect(fill).toMatch(/^#[0-9A-F]{6}$/i);
    expect(text).toMatch(/^#[0-9A-F]{6}$/i);
    const [hi, lo] = [lum(fill), lum(text)].sort((a, b) => b - a);
    expect((hi! + 0.05) / (lo! + 0.05)).toBeGreaterThanOrEqual(4.5);
  });
});

describe("ChipGroup", () => {
  it("marks the chosen chip and reports a tap, may start with none", async () => {
    const onChange = jest.fn();
    await render(
      <ChipGroup label="Direction" value={null} options={[{ value: "in", label: "Incoming" }, { value: "out", label: "Outgoing" }]} onChange={onChange} />,
    );
    expect(screen.queryByRole("radio", { selected: true })).toBeNull();
    await fireEvent.press(screen.getByRole("radio", { name: "Outgoing" }));
    expect(onChange).toHaveBeenCalledWith("out");
  });

  it("the selected chip reads as selected", async () => {
    await render(<ChipGroup value={2} options={[{ value: 1, label: "A" }, { value: 2, label: "B" }]} onChange={jest.fn()} />);
    expect(screen.getByRole("radio", { selected: true })).toHaveAccessibleName("B");
  });
});

describe("Segmented", () => {
  const OPTIONS = [
    { value: "checklist", label: "Checklist", count: 3 },
    { value: "files", label: "Files", count: 0 },
    { value: "comments", label: "Comments", count: 150 },
  ] as const;

  it("shows counts, hides a zero, caps past 99, and switches on tap", async () => {
    const onChange = jest.fn();
    await render(<Segmented value="checklist" options={[...OPTIONS]} onChange={onChange} />);
    expect(screen.getByText("3")).toBeOnTheScreen();
    expect(screen.queryByText("0")).toBeNull();
    expect(screen.getByText("99+")).toBeOnTheScreen();
    expect(screen.getByRole("tab", { selected: true })).toHaveAccessibleName("Checklist 3");
    await fireEvent.press(screen.getByRole("tab", { name: /Comments/ }));
    expect(onChange).toHaveBeenCalledWith("comments");
  });

  it("more than three segments become a scrolling strip", async () => {
    await render(
      <Segmented
        value="d"
        options={["a", "b", "c", "d"].map((v) => ({ value: v, label: v.toUpperCase() }))}
        onChange={jest.fn()}
      />,
    );
    expect(screen.getAllByRole("tab")).toHaveLength(4);
    expect(screen.getByRole("tab", { selected: true })).toHaveAccessibleName("D");
  });
});

describe("Checkbox", () => {
  it("toggles through its handler and announces its state", async () => {
    const onPress = jest.fn();
    await render(<Checkbox checked accessibilityLabel="Call the client" onPress={onPress} />);
    const box = screen.getByRole("checkbox", { name: "Call the client" });
    expect(box).toBeChecked();
    await fireEvent.press(box);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it("without a handler it is a read-only mark, not a control", async () => {
    await render(<Checkbox checked={false} />);
    expect(screen.queryByRole("checkbox")).toBeNull();
  });
});
