import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThemeProvider } from "@mui/material/styles";
import { Bell } from "lucide-react";

import { buildTheme } from "../../theme";
import {
  FormLabel,
  FormError,
  FormRow,
  FormContainer,
  FormFieldGroup,
  FormInput,
  FormNumberInput,
  FormSelect,
  FormMultiSelect,
  FormTextarea,
  FormDateInput,
  FormEmailInput,
  FormPhoneInput,
  FormCheckbox,
  FormButtons,
  FormModal,
} from "./FormComponents";

const wrap = (ui, mode = "light") =>
  render(<ThemeProvider theme={buildTheme(mode)}>{ui}</ThemeProvider>);

const OPTS = [
  { value: "a", label: "Apple" },
  { value: "b", label: "Banana" },
];

describe("FormLabel", () => {
  it("renders its text without a marker by default", () => {
    wrap(<FormLabel>Owner</FormLabel>);
    expect(screen.getByText("Owner")).toBeInTheDocument();
    expect(screen.queryByText("*")).toBeNull();
  });

  it("marks a required field with an asterisk", () => {
    wrap(<FormLabel required>Owner</FormLabel>);
    expect(screen.getByText("*")).toBeInTheDocument();
  });

  it("keeps a caller's own class alongside its own", () => {
    wrap(<FormLabel className="mt-6">Owner</FormLabel>);
    expect(screen.getByText(/Owner/).className).toContain("mt-6");
  });
});

describe("FormError", () => {
  it("renders nothing when there is no error", () => {
    const { container } = wrap(<FormError error="" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the message when there is one", () => {
    wrap(<FormError error="Mobile must be 10 digits" />);
    expect(screen.getByText("Mobile must be 10 digits")).toBeInTheDocument();
  });
});

// FormRow's whole job is emitting the right Tailwind grid classes, so the
// class list is the behaviour here.
describe("FormRow", () => {
  const classesFor = (props) => {
    const { container, unmount } = wrap(
      <FormRow {...props}>
        <span>field</span>
      </FormRow>,
    );
    const className = container.firstChild.className;
    unmount();
    return className;
  };

  it("defaults to two responsive columns with a gap-4", () => {
    const cls = classesFor({});
    expect(cls).toContain("grid-cols-1");
    expect(cls).toContain("md:grid-cols-2");
    expect(cls).toContain("gap-4");
  });

  it("stacks a single-column row with no responsive step", () => {
    const cls = classesFor({ columns: 1 });
    expect(cls).toContain("grid-cols-1");
    expect(cls).not.toContain("md:grid-cols");
  });

  it.each([3, 4, 5, 6])("splits into %i columns above md", (columns) => {
    expect(classesFor({ columns })).toContain(`md:grid-cols-${columns}`);
  });

  it("stacks a column count it has no class for", () => {
    const cls = classesFor({ columns: 7 });
    expect(cls).toContain("grid-cols-1");
    expect(cls).not.toContain("md:grid-cols");
  });

  it.each(["1", "2", "3", "6", "8"])("honours a gap of %s", (gap) => {
    expect(classesFor({ gap })).toContain(`gap-${gap}`);
  });

  it("falls back to gap-4 for a gap it has no class for", () => {
    expect(classesFor({ gap: "5" })).toContain("gap-4");
  });

  it("appends a caller's class", () => {
    expect(classesFor({ className: "mb-2" })).toContain("mb-2");
  });
});

describe("FormContainer and FormFieldGroup", () => {
  it("space their children by default", () => {
    const { container } = wrap(
      <FormContainer>
        <FormFieldGroup>
          <span>field</span>
        </FormFieldGroup>
      </FormContainer>,
    );
    expect(container.firstChild.className).toContain("space-y-4");
    expect(container.firstChild.firstChild.className).toContain("space-y-1");
  });

  it("takes an override for both the spacing and the class", () => {
    const { container } = wrap(
      <FormContainer spacing="space-y-8" className="p-4">
        <FormFieldGroup spacing="space-y-3" className="p-2">
          <span>field</span>
        </FormFieldGroup>
      </FormContainer>,
    );
    expect(container.firstChild.className).toContain("space-y-8");
    expect(container.firstChild.className).toContain("p-4");
    expect(container.firstChild.firstChild.className).toContain("space-y-3");
    expect(container.firstChild.firstChild.className).toContain("p-2");
  });
});

describe("FormInput", () => {
  it("shows its label, value and helper text", () => {
    wrap(
      <FormInput label="Company" value="Acme" onChange={() => {}} helperText="Legal name" />,
    );
    expect(screen.getByLabelText(/Company/)).toHaveValue("Acme");
    expect(screen.getByText("Legal name")).toBeInTheDocument();
  });

  it("renders as controlled-empty rather than uncontrolled when value is absent", () => {
    wrap(<FormInput label="Company" onChange={() => {}} />);
    expect(screen.getByLabelText(/Company/)).toHaveValue("");
  });

  it("hands the native event straight to onChange", () => {
    // Read it inside the handler: the controlled re-render puts the old value
    // back on the DOM node before an assertion afterwards could see it.
    const seen = [];
    wrap(
      <FormInput label="Company" value="" onChange={(e) => seen.push(e.target.value)} />,
    );
    fireEvent.change(screen.getByLabelText(/Company/), { target: { value: "Acme" } });
    expect(seen).toEqual(["Acme"]);
  });

  it("shows an error in place of the hint", () => {
    wrap(
      <FormInput
        label="Company"
        value=""
        onChange={() => {}}
        helperText="Legal name"
        error="Required"
      />,
    );
    expect(screen.getByText("Required")).toBeInTheDocument();
    expect(screen.queryByText("Legal name")).toBeNull();
  });

  it("passes disabled and required down", () => {
    wrap(<FormInput label="Company" value="" onChange={() => {}} disabled required />);
    expect(screen.getByLabelText(/Company/)).toBeDisabled();
    expect(screen.getByText("*")).toBeInTheDocument();
  });
});

describe("FormNumberInput", () => {
  it("strips anything that is not a digit before reporting a change", () => {
    const onChange = vi.fn();
    wrap(<FormNumberInput label="Rate" value="" onChange={onChange} />);
    fireEvent.change(screen.getByLabelText(/Rate/), { target: { value: "12a3b" } });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ target: { value: "123" } }),
    );
  });

  it("clamps to maxLength so a pasted overlong number cannot get through", () => {
    const onChange = vi.fn();
    wrap(<FormNumberInput label="Rate" value="" onChange={onChange} maxLength={4} />);
    fireEvent.change(screen.getByLabelText(/Rate/), { target: { value: "1234567" } });
    expect(onChange.mock.calls[0][0].target.value).toBe("1234");
  });

  it("treats a cleared field as an empty string", () => {
    const onChange = vi.fn();
    wrap(<FormNumberInput label="Rate" value="7" onChange={onChange} />);
    fireEvent.change(screen.getByLabelText(/Rate/), { target: { value: "" } });
    expect(onChange.mock.calls[0][0].target.value).toBe("");
  });

  it("survives a change with no handler attached", () => {
    wrap(<FormNumberInput label="Rate" value="" />);
    expect(() =>
      fireEvent.change(screen.getByLabelText(/Rate/), { target: { value: "9" } }),
    ).not.toThrow();
  });

  it("stays a plain field with no steppers when no range is given", () => {
    wrap(<FormNumberInput label="Rate" value="5" onChange={() => {}} />);
    expect(screen.queryByLabelText("Increment")).toBeNull();
    expect(screen.getByLabelText(/Rate/)).toHaveAttribute("inputmode", "numeric");
  });

  it.each([
    ["a minimum", { min: 0 }],
    ["a maximum", { max: 10 }],
  ])("grows steppers once %s is meaningful", (_label, range) => {
    const onChange = vi.fn();
    wrap(<FormNumberInput label="Rate" value="5" onChange={onChange} {...range} />);
    expect(screen.getByLabelText("Increment")).toBeInTheDocument();
    expect(screen.getByLabelText("Decrement")).toBeInTheDocument();
  });

  it("reports a stepped value through the same numeric filter", () => {
    const onChange = vi.fn();
    wrap(
      <FormNumberInput label="Rate" value="5" onChange={onChange} min={0} max={10} step={2} />,
    );
    fireEvent.click(screen.getByLabelText("Increment"));
    expect(onChange.mock.calls[0][0].target.value).toBe("7");
  });

  it("renders an absent value as empty", () => {
    wrap(<FormNumberInput label="Rate" onChange={() => {}} />);
    expect(screen.getByLabelText(/Rate/)).toHaveValue("");
  });
});

describe("FormSelect", () => {
  it("shows the option matching the primitive value", () => {
    wrap(<FormSelect label="Fruit" value="b" options={OPTS} onChange={() => {}} />);
    expect(screen.getByLabelText("Fruit")).toHaveValue("Banana");
  });

  it("shows nothing when the value matches no option", () => {
    wrap(<FormSelect label="Fruit" value="zzz" options={OPTS} onChange={() => {}} />);
    expect(screen.getByLabelText("Fruit")).toHaveValue("");
  });

  // Legacy callers are bound to react-hook-form, which expects an event.
  it("reports a pick as an event-shaped value", async () => {
    const onChange = vi.fn();
    wrap(<FormSelect label="Fruit" value="" options={OPTS} onChange={onChange} />);
    const user = userEvent.setup();
    await user.click(screen.getByLabelText("Fruit"));
    await user.click(await screen.findByText("Apple"));
    expect(onChange).toHaveBeenCalledWith({ target: { value: "a" } });
  });

  it("reports a cleared select as an empty string, not null", async () => {
    const onChange = vi.fn();
    wrap(<FormSelect label="Fruit" value="a" options={OPTS} onChange={onChange} />);
    const user = userEvent.setup();
    await user.click(screen.getByTitle("Clear"));
    expect(onChange).toHaveBeenCalledWith({ target: { value: "" } });
  });

  it("renders with no options and no handler", () => {
    wrap(<FormSelect label="Fruit" value="" />);
    expect(screen.getByLabelText("Fruit")).toBeInTheDocument();
  });

  it("carries error, hint, required and disabled through", () => {
    wrap(
      <FormSelect
        label="Fruit"
        value=""
        options={OPTS}
        onChange={() => {}}
        error="Pick one"
        required
        disabled
      />,
    );
    expect(screen.getByText("Pick one")).toBeInTheDocument();
    expect(screen.getByRole("combobox")).toBeDisabled();
  });
});

describe("FormMultiSelect", () => {
  it("resolves its array of primitives to options, ignoring unknown ids", () => {
    wrap(
      <FormMultiSelect
        label="Fruits"
        value={["a", "nope"]}
        options={OPTS}
        onChange={() => {}}
      />,
    );
    expect(screen.getByText("Apple")).toBeInTheDocument();
    expect(screen.queryByText("nope")).toBeNull();
  });

  it("reports a pick as an array of primitives", async () => {
    const onChange = vi.fn();
    wrap(
      <FormMultiSelect label="Fruits" value={["a"]} options={OPTS} onChange={onChange} />,
    );
    const user = userEvent.setup();
    await user.click(screen.getByLabelText("Fruits"));
    await user.click(await screen.findByText("Banana"));
    expect(onChange).toHaveBeenCalledWith(["a", "b"]);
  });

  it("starts empty when given no value at all", () => {
    wrap(<FormMultiSelect label="Fruits" options={OPTS} onChange={() => {}} />);
    expect(screen.queryByText("Apple")).toBeNull();
  });

  it("carries its hint and disabled state through", () => {
    wrap(
      <FormMultiSelect
        label="Fruits"
        value={[]}
        options={OPTS}
        onChange={() => {}}
        helperText="Pick a few"
        disabled
        required
      />,
    );
    expect(screen.getByText("Pick a few")).toBeInTheDocument();
    expect(screen.getByRole("combobox")).toBeDisabled();
  });
});

describe("FormTextarea", () => {
  it("shows its value and reports edits", () => {
    const seen = [];
    wrap(
      <FormTextarea
        label="Notes"
        value="hello"
        rows={5}
        onChange={(e) => seen.push(e.target.value)}
      />,
    );
    const box = screen.getByLabelText(/Notes/);
    expect(box).toHaveValue("hello");
    fireEvent.change(box, { target: { value: "bye" } });
    expect(seen).toEqual(["bye"]);
  });

  it("renders an absent value as empty, with its hint", () => {
    wrap(<FormTextarea label="Notes" onChange={() => {}} helperText="Optional" />);
    expect(screen.getByLabelText(/Notes/)).toHaveValue("");
    expect(screen.getByText("Optional")).toBeInTheDocument();
  });
});

describe("FormDateInput", () => {
  it("renders a labelled date field", () => {
    wrap(<FormDateInput label="Due" value="" onChange={() => {}} helperText="ISO" />);
    expect(screen.getByLabelText(/Due/)).toBeInTheDocument();
    expect(screen.getByText("ISO")).toBeInTheDocument();
  });

  it("renders an absent value without going uncontrolled", () => {
    wrap(<FormDateInput label="Due" onChange={() => {}} />);
    expect(screen.getByLabelText(/Due/)).toBeInTheDocument();
  });

  it("shows an error and can be disabled", () => {
    wrap(<FormDateInput label="Due" value="" onChange={() => {}} error="Required" disabled />);
    expect(screen.getByText("Required")).toBeInTheDocument();
  });
});

describe("FormEmailInput and FormPhoneInput", () => {
  it("gives the email field a type and a default placeholder", () => {
    wrap(<FormEmailInput label="Email" value="" onChange={() => {}} />);
    const input = screen.getByLabelText(/Email/);
    expect(input).toHaveAttribute("type", "email");
    expect(input).toHaveAttribute("placeholder", "Enter email address");
  });

  it("lets a caller override the email placeholder", () => {
    wrap(
      <FormEmailInput label="Email" value="" onChange={() => {}} placeholder="Work email" />,
    );
    expect(screen.getByLabelText(/Email/)).toHaveAttribute("placeholder", "Work email");
  });

  // A mobile number is ten digits — the clamp is the point of this wrapper.
  it("clamps the phone field to ten digits", () => {
    const onChange = vi.fn();
    wrap(<FormPhoneInput label="Mobile" value="" onChange={onChange} />);
    const input = screen.getByLabelText(/Mobile/);
    expect(input).toHaveAttribute("placeholder", "Enter 10-digit phone number");
    fireEvent.change(input, { target: { value: "98250 12345 67" } });
    expect(onChange.mock.calls[0][0].target.value).toBe("9825012345");
  });
});

describe("FormCheckbox", () => {
  it("reflects a checked state and reports a toggle", () => {
    const onChange = vi.fn();
    wrap(<FormCheckbox label="Active" checked onChange={onChange} />);
    const box = screen.getByRole("checkbox");
    expect(box).toBeChecked();
    fireEvent.click(box);
    expect(onChange).toHaveBeenCalled();
  });

  it("treats an absent checked prop as unchecked", () => {
    wrap(<FormCheckbox label="Active" onChange={() => {}} />);
    expect(screen.getByRole("checkbox")).not.toBeChecked();
  });

  it("can be disabled", () => {
    wrap(<FormCheckbox label="Active" checked={false} onChange={() => {}} disabled />);
    expect(screen.getByRole("checkbox")).toBeDisabled();
  });
});

describe("FormButtons", () => {
  it("defaults to Cancel and Submit and calls both handlers", () => {
    const onCancel = vi.fn();
    const onSubmit = vi.fn();
    wrap(<FormButtons onCancel={onCancel} onSubmit={onSubmit} />);

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("takes its own labels and an extra class", () => {
    const { container } = wrap(
      <FormButtons
        onCancel={() => {}}
        onSubmit={() => {}}
        cancelText="Discard"
        submitText="Save lead"
        className="rounded-b-xl"
      />,
    );
    expect(screen.getByRole("button", { name: "Discard" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save lead" })).toBeInTheDocument();
    expect(container.firstChild.className).toContain("rounded-b-xl");
  });

  it("locks the submit while it is loading", () => {
    const onSubmit = vi.fn();
    wrap(<FormButtons onCancel={() => {}} onSubmit={onSubmit} isLoading />);
    const [, submit] = screen.getAllByRole("button");
    expect(submit).toBeDisabled();
    fireEvent.click(submit);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("locks the submit when the form says it is invalid", () => {
    const onSubmit = vi.fn();
    wrap(<FormButtons onCancel={() => {}} onSubmit={onSubmit} disabled />);
    const submit = screen.getByRole("button", { name: "Submit" });
    expect(submit).toBeDisabled();
    fireEvent.click(submit);
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

describe("FormModal", () => {
  it("renders nothing while closed", () => {
    wrap(
      <FormModal open={false} title="Edit lead">
        <p>body</p>
      </FormModal>,
    );
    expect(screen.queryByText("body")).toBeNull();
  });

  it("renders its header, subtitle, icon and body when open", () => {
    wrap(
      <FormModal
        open
        title="Edit lead"
        subtitle="Acme Pvt Ltd"
        icon={<Bell size={18} />}
        onClose={() => {}}
        data-testid="lead-modal"
      >
        <p>body</p>
      </FormModal>,
    );
    const dialog = screen.getByTestId("lead-modal");
    expect(within(dialog).getByText("Edit lead")).toBeInTheDocument();
    expect(within(dialog).getByText("Acme Pvt Ltd")).toBeInTheDocument();
    expect(within(dialog).getByText("body")).toBeInTheDocument();
    expect(dialog.querySelector(".lucide-bell")).toBeInTheDocument();
  });

  it("drops the header entirely when there is no title", () => {
    wrap(
      <FormModal open onClose={() => {}} data-testid="bare">
        <p>body</p>
      </FormModal>,
    );
    const dialog = screen.getByTestId("bare");
    expect(within(dialog).getByText("body")).toBeInTheDocument();
    expect(within(dialog).queryByRole("button")).toBeNull();
  });

  it("closes from the header's close button", () => {
    const onClose = vi.fn();
    wrap(
      <FormModal open title="Edit lead" onClose={onClose} data-testid="m">
        <p>body</p>
      </FormModal>,
    );
    fireEvent.click(within(screen.getByTestId("m")).getByRole("button"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("maps each Tailwind max-width onto a modal size", () => {
    const widthFor = (maxWidth) => {
      const { unmount } = wrap(
        <FormModal open maxWidth={maxWidth} onClose={() => {}} data-testid="m">
          <p>body</p>
        </FormModal>,
      );
      const width = screen.getByTestId("m").style.maxWidth;
      unmount();
      return width;
    };

    expect(widthFor("max-w-sm")).toBe(widthFor("max-w-md"));
    expect(widthFor("max-w-lg")).toBe(widthFor("max-w-2xl"));
    expect(widthFor("max-w-3xl")).toBe(widthFor("max-w-4xl"));
    expect(widthFor("max-w-5xl")).toBe(widthFor("max-w-6xl"));

    const sizes = [
      widthFor("max-w-sm"),
      widthFor("max-w-lg"),
      widthFor("max-w-3xl"),
      widthFor("max-w-5xl"),
    ];
    expect(new Set(sizes).size).toBe(4);
  });

  it("defaults to the large size, and falls back to it for an unknown max-width", () => {
    const widthFor = (props) => {
      const { unmount } = wrap(
        <FormModal open onClose={() => {}} data-testid="m" {...props}>
          <p>body</p>
        </FormModal>,
      );
      const width = screen.getByTestId("m").style.maxWidth;
      unmount();
      return width;
    };
    const large = widthFor({ maxWidth: "max-w-3xl" });
    expect(widthFor({})).toBe(large);
    expect(widthFor({ maxWidth: "max-w-9xl" })).toBe(large);
  });
});
