import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ThemeProvider } from "@mui/material/styles";
import { buildTheme } from "../theme";
import ComingSoon from "./ComingSoon";

const wrap = (ui) => render(<ThemeProvider theme={buildTheme("light")}>{ui}</ThemeProvider>);

describe("ComingSoon", () => {
  it("renders the given title and a placeholder description", () => {
    wrap(<ComingSoon title="Sales" />);
    expect(screen.getByText("Sales")).toBeInTheDocument();
    expect(screen.getByText(/under construction/i)).toBeInTheDocument();
  });

  it("renders a different title for Settings", () => {
    wrap(<ComingSoon title="Settings" />);
    expect(screen.getByText("Settings")).toBeInTheDocument();
  });
});
