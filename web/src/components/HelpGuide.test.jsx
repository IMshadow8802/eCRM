import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThemeProvider } from "@mui/material/styles";

import { buildTheme } from "../theme";
import HelpGuide from "./HelpGuide";

const GUIDE = {
  titleHi: "टास्क कैसे इस्तेमाल करें",
  titleEn: "How to use Tasks",
  steps: [
    { hi: "टास्क बनाएं", en: "Create a task" },
    { hi: "स्टेटस बदलें", en: "Change status" },
  ],
};

const wrap = (ui) => render(<ThemeProvider theme={buildTheme("light")}>{ui}</ThemeProvider>);

describe("HelpGuide", () => {
  it("renders nothing when no guide is given", () => {
    const { container } = wrap(<HelpGuide />);
    expect(container).toBeEmptyDOMElement();
  });

  it("opens the guide in Hindi by default and toggles to English", async () => {
    const user = userEvent.setup();
    wrap(<HelpGuide guide={GUIDE} />);

    await user.click(screen.getByTestId("help-guide-button"));

    // Hindi by default
    expect(await screen.findByText("टास्क कैसे इस्तेमाल करें")).toBeInTheDocument();
    expect(screen.getByText("टास्क बनाएं")).toBeInTheDocument();

    // Toggle to English
    await user.click(screen.getByTestId("help-lang-en"));
    expect(screen.getByText("How to use Tasks")).toBeInTheDocument();
    expect(screen.getByText("Create a task")).toBeInTheDocument();

    // Back to Hindi
    await user.click(screen.getByTestId("help-lang-hi"));
    expect(screen.getByText("स्टेटस बदलें")).toBeInTheDocument();
  });

  it("can start in English via defaultLang", async () => {
    const user = userEvent.setup();
    wrap(<HelpGuide guide={GUIDE} defaultLang="en" />);
    await user.click(screen.getByTestId("help-guide-button"));
    expect(await screen.findByText("How to use Tasks")).toBeInTheDocument();
  });
});
