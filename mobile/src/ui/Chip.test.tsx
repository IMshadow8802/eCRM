import { StyleSheet } from "react-native";
import { render, screen } from "@testing-library/react-native";
import { User } from "lucide-react-native";

import { Chip } from "./Chip";

// Found on the emulator (Task 30): a long owner name ran past the end of its
// capped pill ("…under Neha)" outside the fill). A label in a row only
// truncates at maxWidth if it is allowed to shrink.
it("a capped chip lets its label shrink so it truncates inside the pill", async () => {
  await render(<Chip label="Amit Singh (Exec HO, under Neha)" icon={User} maxWidth={200} />);
  const label = screen.getByText("Amit Singh (Exec HO, under Neha)");
  expect(label).toHaveProp("numberOfLines", 1);
  expect(StyleSheet.flatten(label.props.style).flexShrink).toBe(1);
  expect(StyleSheet.flatten(label.parent?.props.style).maxWidth).toBe(200);
});
