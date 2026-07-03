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

  it("opens the guide in English by default and toggles to Hindi", async () => {
    const user = userEvent.setup();
    wrap(<HelpGuide guide={GUIDE} />);

    await user.click(screen.getByTestId("help-guide-button"));

    // English by default
    expect(await screen.findByText("How to use Tasks")).toBeInTheDocument();
    expect(screen.getByText("Create a task")).toBeInTheDocument();

    // Toggle to Hindi
    await user.click(screen.getByTestId("help-lang-hi"));
    expect(screen.getByText("टास्क कैसे इस्तेमाल करें")).toBeInTheDocument();
    expect(screen.getByText("टास्क बनाएं")).toBeInTheDocument();

    // Back to English
    await user.click(screen.getByTestId("help-lang-en"));
    expect(screen.getByText("Change status")).toBeInTheDocument();
  });

  it("can start in Hindi via defaultLang", async () => {
    const user = userEvent.setup();
    wrap(<HelpGuide guide={GUIDE} defaultLang="hi" />);
    await user.click(screen.getByTestId("help-guide-button"));
    expect(await screen.findByText("टास्क कैसे इस्तेमाल करें")).toBeInTheDocument();
  });

  const SECTIONED = {
    titleHi: "टास्क", titleEn: "Tasks",
    sections: [
      { headingEn: "For yourself", headingHi: "अपने लिए", steps: [{ en: "Add a task", hi: "टास्क जोड़ें" }] },
      { adminOnly: true, headingEn: "You are an Admin", headingHi: "आप Admin हैं", steps: [{ en: "Assign to anyone", hi: "किसी को भी दें" }] },
    ],
  };

  it("hides admin-only sections for non-admins", async () => {
    const user = userEvent.setup();
    wrap(<HelpGuide guide={SECTIONED} isAdmin={false} />);
    await user.click(screen.getByTestId("help-guide-button"));
    expect(await screen.findByText("For yourself")).toBeInTheDocument();
    expect(screen.queryByText("You are an Admin")).not.toBeInTheDocument();
    expect(screen.queryByText("Assign to anyone")).not.toBeInTheDocument();
  });

  it("shows admin-only sections for admins", async () => {
    const user = userEvent.setup();
    wrap(<HelpGuide guide={SECTIONED} isAdmin />);
    await user.click(screen.getByTestId("help-guide-button"));
    expect(await screen.findByText("You are an Admin")).toBeInTheDocument();
    expect(screen.getByText("Assign to anyone")).toBeInTheDocument();
  });
});
