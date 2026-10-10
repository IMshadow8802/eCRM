import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import dayjs from "dayjs";

import LeadCreateModal from "./LeadCreateModal";
import useAuthStore from "../../stores/useAuthStore";
import { server } from "../../test/mocks/server";
import renderWithProviders from "../../test/renderWithProviders";

// The assignable roster, not every user — the owner picker must only offer
// people leadController.save will accept (it 403s anyone outside this list).
const USERS = [
  { Id: 1, FullName: "Alice", BranchId: 2, BranchName: "Pune" },
  { Id: 2, FullName: "Bob", BranchId: 2, BranchName: "Pune" },
];
let rosterCalls = 0;
const SOURCES = [
  { Id: 5, Value: "Website" },
  { Id: 6, Value: "Referral" },
];
// Statuses carry Code + SortOrder — the form defaults to the first 'open' one.
const STATUSES = [
  { Id: 12, Value: "Contacted", Code: "open", SortOrder: 2 },
  { Id: 11, Value: "New", Code: "open", SortOrder: 1 },
  { Id: 13, Value: "Junk", Code: "junk", SortOrder: 3 },
];
const PARTNERS = [
  { Id: 3, Name: "Sharma Traders", City: "Surat", CommType: "pct", CommValue: 10 },
  { Id: 4, Name: "Verma Agency", City: null, CommType: null, CommValue: null },
];
const PRODUCTS = [{ Id: 2, Name: "TV 43in" }];

const json = (data) =>
  HttpResponse.json({ success: true, message: "ok", responseCode: 200, data });

const mockReads = (customFields = []) =>
  server.use(
    http.post("*/api/users/fetchAssignableUsers", async () => {
      rosterCalls += 1;
      return json({ users: USERS });
    }),
    http.post("*/api/config/fetchLookups", async ({ request }) => {
      const { Kind } = await request.json();
      return json({ lookups: Kind === "lead_status" ? STATUSES : SOURCES });
    }),
    http.post("*/api/products/fetchProducts", async () =>
      json({
        products: PRODUCTS,
        pagination: { currentPage: 1, pageSize: 200, totalRecords: 1, totalPages: 1 },
      }),
    ),
    http.post("*/api/config/fetchCustomFields", async () =>
      json({ customFields }),
    ),
    http.post("*/api/partners/fetchPartners", async () => json({ partners: PARTNERS })),
  );

const mockSave = (capture) =>
  server.use(
    http.post("*/api/leads/saveLeads", async ({ request }) => {
      capture?.(await request.json());
      return json({ Id: 42, ResponseCode: 200, ResponseMess: "Lead created" });
    }),
  );

const pick = async (user, testId, optionName) => {
  await user.click(screen.getByTestId(`${testId}-input`));
  await user.click(await screen.findByRole("option", { name: optionName }));
};

describe("LeadCreateModal", () => {
  beforeEach(() => {
    useAuthStore.setState({
      isAuthenticated: true,
      token: null,
      user: { UserId: 1 },
      UserId: 1,
      API_BASE_URL: "https://prdinfotech.in/CRM",
    });
    rosterCalls = 0;
    mockReads();
  });

  it("creates with address, product, remarks and a first follow-up, no pipeline", async () => {
    let captured;
    mockSave((body) => {
      captured = body;
    });
    const onClose = vi.fn();
    renderWithProviders(<LeadCreateModal open onClose={onClose} />, { router: false });
    const user = userEvent.setup();

    await user.type(screen.getByTestId("lead-name"), "Sharma");
    await user.type(screen.getByTestId("lead-mobile"), "9820012345");
    await user.type(screen.getByTestId("lead-company"), "Sharma Traders");
    await user.type(screen.getByTestId("lead-city"), "Pune");
    await user.type(screen.getByTestId("lead-pincode"), "411001");
    await pick(user, "lead-product", "TV 43in");
    await pick(user, "lead-owner", "Bob");
    await user.type(screen.getByTestId("lead-remarks"), "Walk-in, wants delivery Friday");
    await user.click(screen.getByTestId("lead-create-submit"));

    await waitFor(() => expect(captured).toBeTruthy());
    expect(captured).toMatchObject({
      Id: 0,
      Name: "Sharma",
      MobileNo: "9820012345",
      Company: "Sharma Traders",
      City: "Pune",
      Pincode: "411001",
      ProductId: 2,
      OwnerId: 2,
      Remarks: "Walk-in, wants delivery Friday",
      StatusId: 11, // the default 'open' status, lowest SortOrder
      FirstFollowupAt: dayjs().format("YYYY-MM-DD"), // today
    });
    expect(captured).not.toHaveProperty("PipelineId");
    expect(captured).not.toHaveProperty("StageId");
    expect(captured.CustomJSON).toBe("[]");
    expect(onClose).toHaveBeenCalled();
  }, 20000);

  it("serialises configured custom fields into CustomJSON", async () => {
    let captured;
    mockReads([{ Id: 71, Label: "Region", Type: "text", IsRequired: false }]);
    mockSave((body) => {
      captured = body;
    });
    renderWithProviders(<LeadCreateModal open onClose={() => {}} />, { router: false });
    const user = userEvent.setup();

    await user.type(screen.getByTestId("lead-name"), "Beta");
    await user.type(screen.getByTestId("lead-mobile"), "8887776665");
    await pick(user, "lead-source", "Referral");
    await pick(user, "lead-owner", "Bob");
    await user.type(screen.getByLabelText("Region"), "West");

    await user.click(screen.getByTestId("lead-create-submit"));

    await waitFor(() => expect(captured).toBeTruthy());
    expect(JSON.parse(captured.CustomJSON)).toEqual([
      { fieldId: 71, type: "text", value: "West" },
    ]);
    expect(captured).toMatchObject({ OwnerId: 2, SourceId: 6, StatusId: 11 });
  }, 20000);

  it("edit mode: prefills the richer form and posts its Id with null CustomJSON", async () => {
    const LEAD = {
      Id: 55,
      Name: "Acme Corp",
      Company: "Acme Pvt Ltd",
      MobileNo: "9990001111",
      AltMobile: "8880002222",
      Email: "acme@example.com",
      Address: "12 MG Road",
      City: "Pune",
      State: "MH",
      Pincode: "411001",
      SourceId: 5,
      ProductId: 2,
      OwnerId: 1,
      EstValue: 15000,
      Remarks: "Prefers evening calls",
    };
    let captured;
    // Custom fields ARE configured — edit mode must still not touch them.
    mockReads([{ Id: 71, Label: "Region", Type: "text", IsRequired: false }]);
    mockSave((body) => {
      captured = body;
    });
    const onClose = vi.fn();
    renderWithProviders(<LeadCreateModal open lead={LEAD} onClose={onClose} />, {
      router: false,
    });
    const user = userEvent.setup();

    expect(screen.getByText("Edit Lead")).toBeInTheDocument();
    expect(screen.getByTestId("lead-name")).toHaveValue("Acme Corp");
    expect(screen.getByTestId("lead-company")).toHaveValue("Acme Pvt Ltd");
    expect(screen.getByTestId("lead-mobile")).toHaveValue("9990001111");
    expect(screen.getByTestId("lead-alt-mobile")).toHaveValue("8880002222");
    expect(screen.getByTestId("lead-email")).toHaveValue("acme@example.com");
    expect(screen.getByTestId("lead-address")).toHaveValue("12 MG Road");
    expect(screen.getByTestId("lead-city")).toHaveValue("Pune");
    expect(screen.getByTestId("lead-state")).toHaveValue("MH");
    expect(screen.getByTestId("lead-pincode")).toHaveValue("411001");
    expect(screen.getByTestId("lead-remarks")).toHaveValue("Prefers evening calls");
    // Custom fields and attachments belong to the detail page in edit mode.
    expect(screen.queryByText("Custom fields")).not.toBeInTheDocument();
    expect(screen.queryByText("Attachments")).not.toBeInTheDocument();

    await user.clear(screen.getByTestId("lead-name"));
    await user.type(screen.getByTestId("lead-name"), "Acme Renamed");
    await user.click(screen.getByTestId("lead-create-submit"));

    await waitFor(() => expect(captured).toBeTruthy());
    expect(captured).toMatchObject({
      Id: 55,
      Name: "Acme Renamed",
      Company: "Acme Pvt Ltd",
      MobileNo: "9990001111",
      Address: "12 MG Road",
      City: "Pune",
      State: "MH",
      Pincode: "411001",
      SourceId: 5,
      ProductId: 2,
      EstValue: 15000,
      Remarks: "Prefers evening calls",
    });
    expect(captured).not.toHaveProperty("PipelineId");
    expect(captured).not.toHaveProperty("StageId");
    // null CustomJSON = sp_SaveLead skips the merge, stored values survive.
    expect(captured.CustomJSON).toBeNull();
    expect(onClose).toHaveBeenCalled();
  }, 20000);

  it("edit hides Owner and Status and sends neither", async () => {
    let captured;
    mockSave((body) => {
      captured = body;
    });
    renderWithProviders(
      <LeadCreateModal
        open
        lead={{ Id: 9, Name: "Acme", MobileNo: "9998887776", City: "Pune" }}
        onClose={() => {}}
      />,
      { router: false },
    );
    expect(screen.queryByTestId("lead-owner-input")).toBeNull();
    expect(screen.queryByTestId("lead-status-input")).toBeNull();
    const user = userEvent.setup();
    await user.click(screen.getByTestId("lead-create-submit"));
    await waitFor(() => expect(captured).toBeTruthy());
    expect(captured).toMatchObject({ Id: 9, City: "Pune", MobileNo: "9998887776", CustomJSON: null });
    expect(captured.OwnerId).toBeUndefined();
    expect(captured.StatusId).toBeUndefined();
    expect(captured.FirstFollowupAt).toBeUndefined();
    // Edit never shows the owner picker, so it must never pull the roster.
    expect(rosterCalls).toBe(0);
  }, 20000);

  it("blocks submit and skips saveLeads when required fields are empty or the email is malformed", async () => {
    const saveSpy = vi.fn();
    mockSave(saveSpy);
    renderWithProviders(<LeadCreateModal open onClose={() => {}} />, { router: false });
    const user = userEvent.setup();

    await user.type(screen.getByTestId("lead-email"), "not-an-email");
    await user.click(screen.getByTestId("lead-create-submit"));

    expect(await screen.findByText("Name is required")).toBeInTheDocument();
    expect(screen.getByText("Mobile number is required")).toBeInTheDocument();
    expect(screen.getByText("Invalid email")).toBeInTheDocument();
    expect(saveSpy).not.toHaveBeenCalled();
  }, 20000);

  it("rejects a mobile that isn't ten digits and posts nothing", async () => {
    const saveSpy = vi.fn();
    mockSave(saveSpy);
    renderWithProviders(<LeadCreateModal open onClose={() => {}} />, { router: false });
    const user = userEvent.setup();

    await user.type(screen.getByTestId("lead-name"), "Sharma");
    await user.type(screen.getByTestId("lead-mobile"), "12345");
    await user.click(screen.getByTestId("lead-create-submit"));

    expect(await screen.findByText("Mobile number must be 10 digits")).toBeInTheDocument();
    expect(saveSpy).not.toHaveBeenCalled();
  }, 20000);

  describe("partner", () => {
    const asViewer = () =>
      useAuthStore.setState({ access: { isAdmin: false, modules: { partners: { view: true } } } });
    const fillRequired = async (user) => {
      await user.type(screen.getByTestId("lead-name"), "Acme");
      await user.type(screen.getByTestId("lead-mobile"), "9990001111");
    };
    const submit = async (user) => {
      let body;
      mockSave((b) => { body = b; });
      await user.click(screen.getByTestId("lead-create-submit"));
      await waitFor(() => expect(body).toBeTruthy());
      return body;
    };

    beforeEach(() => useAuthStore.setState({ access: null }));

    it("sends the chosen PartnerId and shows no commission fields without partners view", async () => {
      renderWithProviders(<LeadCreateModal open onClose={vi.fn()} />, { router: false });
      const user = userEvent.setup();
      await fillRequired(user);
      await pick(user, "lead-partner", "Sharma Traders · Surat");
      expect(screen.queryByTestId("lead-comm-type-input")).toBeNull();
      const body = await submit(user);
      expect(body.PartnerId).toBe(3);
      expect(body).not.toHaveProperty("CommType");
      expect(body).not.toHaveProperty("CommValue");
    });

    it("with partners view fills the usual rule, and sends edited terms", async () => {
      asViewer();
      renderWithProviders(<LeadCreateModal open onClose={vi.fn()} />, { router: false });
      const user = userEvent.setup();
      await fillRequired(user);
      await pick(user, "lead-partner", "Sharma Traders · Surat");
      expect(screen.getByTestId("lead-comm-type-input")).toHaveValue("Percent of deal value");
      expect(screen.getByTestId("lead-comm-value")).toHaveValue("10");
      await pick(user, "lead-comm-type", "Fixed amount");
      await user.clear(screen.getByTestId("lead-comm-value"));
      await user.type(screen.getByTestId("lead-comm-value"), "5000");
      const body = await submit(user);
      expect(body).toMatchObject({ PartnerId: 3, CommType: "fixed", CommValue: 5000 });
    });

    it("a partner with no usual rule starts at No commission and sends nulls", async () => {
      asViewer();
      renderWithProviders(<LeadCreateModal open onClose={vi.fn()} />, { router: false });
      const user = userEvent.setup();
      await fillRequired(user);
      await pick(user, "lead-partner", "Verma Agency");
      expect(screen.queryByTestId("lead-comm-value")).toBeNull();
      const body = await submit(user);
      expect(body).toMatchObject({ PartnerId: 4, CommType: null, CommValue: null });
    });

    it("refuses a percentage over 100 and posts nothing", async () => {
      asViewer();
      let called = false;
      server.use(http.post("*/api/leads/saveLeads", async () => { called = true; return json({ Id: 1 }); }));
      renderWithProviders(<LeadCreateModal open onClose={vi.fn()} />, { router: false });
      const user = userEvent.setup();
      await fillRequired(user);
      await pick(user, "lead-partner", "Sharma Traders · Surat");
      await user.clear(screen.getByTestId("lead-comm-value"));
      await user.type(screen.getByTestId("lead-comm-value"), "150");
      await user.click(screen.getByTestId("lead-create-submit"));
      expect(await screen.findByText("A percentage cannot be over 100")).toBeInTheDocument();
      expect(called).toBe(false);
    });

    it("clearing the partner sends PartnerId null and hides the commission fields", async () => {
      asViewer();
      renderWithProviders(
        <LeadCreateModal open lead={{ Id: 8, Name: "Acme", MobileNo: "9990001111", PartnerId: 3, CommType: "pct", CommValue: 10 }} onClose={vi.fn()} />,
        { router: false },
      );
      const user = userEvent.setup();
      expect(screen.getByTestId("lead-comm-value")).toHaveValue("10");
      await waitFor(() => expect(screen.getByTestId("lead-partner-input")).toHaveValue("Sharma Traders · Surat"));
      fireEvent.click(screen.getByTestId("lead-partner-input").closest(".MuiAutocomplete-root").querySelector('[aria-label="Clear"]'));
      expect(screen.queryByTestId("lead-comm-type-input")).toBeNull();
      const body = await submit(user);
      expect(body).toMatchObject({ PartnerId: null, CommType: null, CommValue: null });
    });

    it("picking another partner then going back to the lead's own restores its agreed terms", async () => {
      asViewer();
      renderWithProviders(
        <LeadCreateModal open lead={{ Id: 8, Name: "Acme", MobileNo: "9990001111", PartnerId: 3, CommType: "fixed", CommValue: 2500 }} onClose={vi.fn()} />,
        { router: false },
      );
      const user = userEvent.setup();
      await waitFor(() => expect(screen.getByTestId("lead-partner-input")).toHaveValue("Sharma Traders · Surat"));
      await pick(user, "lead-partner", "Verma Agency");
      expect(screen.queryByTestId("lead-comm-value")).toBeNull();
      await pick(user, "lead-partner", "Sharma Traders · Surat");
      expect(screen.getByTestId("lead-comm-value")).toHaveValue("2500");
      const body = await submit(user);
      expect(body).toMatchObject({ PartnerId: 3, CommType: "fixed", CommValue: 2500 });
    });

    it("list row (no terms): pick another partner then back sends no terms", async () => {
      asViewer();
      renderWithProviders(
        <LeadCreateModal open lead={{ Id: 8, Name: "Acme", MobileNo: "9990001111", PartnerId: 3, PartnerName: "Sharma Traders" }} onClose={vi.fn()} />,
        { router: false },
      );
      const user = userEvent.setup();
      await waitFor(() => expect(screen.getByTestId("lead-partner-input")).toHaveValue("Sharma Traders · Surat"));
      await pick(user, "lead-partner", "Verma Agency");
      await pick(user, "lead-partner", "Sharma Traders · Surat");
      const body = await submit(user);
      expect(body.PartnerId).toBe(3);
      expect(body).not.toHaveProperty("CommType");
      expect(body).not.toHaveProperty("CommValue");
    });

    it("edit from the lead page prefills partner and terms", async () => {
      asViewer();
      renderWithProviders(
        <LeadCreateModal open lead={{ Id: 8, Name: "Acme", MobileNo: "9990001111", PartnerId: 3, CommType: "fixed", CommValue: 2500 }} onClose={vi.fn()} />,
        { router: false },
      );
      const user = userEvent.setup();
      await waitFor(() => expect(screen.getByTestId("lead-partner-input")).toHaveValue("Sharma Traders · Surat"));
      expect(screen.getByTestId("lead-comm-type-input")).toHaveValue("Fixed amount");
      expect(screen.getByTestId("lead-comm-value")).toHaveValue("2500");
      const body = await submit(user);
      expect(body).toMatchObject({ PartnerId: 3, CommType: "fixed", CommValue: 2500 });
    });

    it("edit from the list (row has no terms) prefills partner only and never sends terms", async () => {
      asViewer();
      renderWithProviders(
        <LeadCreateModal open lead={{ Id: 8, Name: "Acme", MobileNo: "9990001111", PartnerId: 3, PartnerName: "Sharma Traders" }} onClose={vi.fn()} />,
        { router: false },
      );
      const user = userEvent.setup();
      await waitFor(() => expect(screen.getByTestId("lead-partner-input")).toHaveValue("Sharma Traders · Surat"));
      expect(screen.queryByTestId("lead-comm-type-input")).toBeNull();
      const body = await submit(user);
      expect(body.PartnerId).toBe(3);
      expect(body).not.toHaveProperty("CommType");
    });

    it("a deactivated partner still shows on edit and re-saves unchanged", async () => {
      renderWithProviders(
        <LeadCreateModal open lead={{ Id: 8, Name: "Acme", MobileNo: "9990001111", PartnerId: 99, PartnerName: "Old Agency" }} onClose={vi.fn()} />,
        { router: false },
      );
      const user = userEvent.setup();
      await waitFor(() => expect(screen.getByTestId("lead-partner-input")).toHaveValue("Old Agency (inactive)"));
      const body = await submit(user);
      expect(body.PartnerId).toBe(99);
    });

    it("a whitespace-only commission is refused, not sent as 0%", async () => {
      asViewer();
      let called = false;
      server.use(http.post("*/api/leads/saveLeads", async () => { called = true; return json({ Id: 1 }); }));
      renderWithProviders(<LeadCreateModal open onClose={vi.fn()} />, { router: false });
      const user = userEvent.setup();
      await fillRequired(user);
      await pick(user, "lead-partner", "Sharma Traders · Surat");
      await user.clear(screen.getByTestId("lead-comm-value"));
      await user.type(screen.getByTestId("lead-comm-value"), "  ");
      await user.click(screen.getByTestId("lead-create-submit"));
      expect(await screen.findByText("Enter the commission")).toBeInTheDocument();
      expect(called).toBe(false);
    });
  });
});
