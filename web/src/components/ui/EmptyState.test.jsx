import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ThemeProvider } from "@mui/material/styles";
import { buildTheme } from "../../theme";
import EmptyState from "./EmptyState";
import { Inbox } from "lucide-react";

const wrap = (ui) => render(<ThemeProvider theme={buildTheme()}>{ui}</ThemeProvider>);

describe("EmptyState", () => {
  it("renders title, description, action", () => {
    wrap(
      <EmptyState
        icon={<Inbox data-testid="icon" />}
        title="No data"
        description="Nothing here yet"
        action={<button data-testid="cta">Create</button>}
        data-testid="es"
      />,
    );
    expect(screen.getByText("No data")).toBeInTheDocument();
    expect(screen.getByText("Nothing here yet")).toBeInTheDocument();
    expect(screen.getByTestId("cta")).toBeInTheDocument();
    expect(screen.getByTestId("icon")).toBeInTheDocument();
  });

  it("sizes render", () => {
    for (const size of ["sm", "md", "lg"]) {
      wrap(
        <EmptyState title="t" size={size} data-testid={`es-${size}`} />,
      );
      expect(screen.getByTestId(`es-${size}`)).toBeInTheDocument();
    }
  });

  it("works without optional fields", () => {
    wrap(<EmptyState data-testid="es" />);
    expect(screen.getByTestId("es")).toBeInTheDocument();
  });
});
