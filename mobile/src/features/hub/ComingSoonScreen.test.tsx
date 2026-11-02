import { fireEvent, screen } from "@testing-library/react-native";

import { makeNavigation, makeRoute, renderWithProviders } from "../../test/renderWithProviders";
import ComingSoonScreen from "./ComingSoonScreen";

it("names the module, says what it will do, and goes back", async () => {
  const navigation = makeNavigation<"ComingSoon">();
  await renderWithProviders(
    <ComingSoonScreen
      navigation={navigation}
      route={makeRoute("ComingSoon", { title: "Leads", blurb: "Your leads and follow-ups." })}
    />,
  );
  expect(screen.getByText("Leads is on the way")).toBeOnTheScreen();
  expect(screen.getByText("Your leads and follow-ups.")).toBeOnTheScreen();
  await fireEvent.press(screen.getByLabelText("Go back"));
  expect(navigation.goBack).toHaveBeenCalled();
});
