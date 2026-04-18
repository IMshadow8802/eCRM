import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ThemeProvider } from "@mui/material/styles";
import { buildTheme } from "../../theme";
import Popover from "./Popover";

const wrap = (ui) => render(<ThemeProvider theme={buildTheme()}>{ui}</ThemeProvider>);

describe("Popover", () => {
  it("renders content when open with anchor", () => {
    const anchor = document.createElement("div");
    document.body.appendChild(anchor);
    wrap(
      <Popover open anchorEl={anchor} onClose={() => {}} data-testid="pop">
        <div>Content</div>
      </Popover>,
    );
    expect(screen.getByText("Content")).toBeInTheDocument();
    anchor.remove();
  });

  it("renders nothing when closed", () => {
    wrap(
      <Popover open={false} anchorEl={null} onClose={() => {}}>
        <div>Hidden</div>
      </Popover>,
    );
    expect(screen.queryByText("Hidden")).not.toBeInTheDocument();
  });
});
