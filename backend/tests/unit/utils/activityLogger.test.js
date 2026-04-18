jest.mock("../../../src/config/database", () => ({
  executeStoredProcedure: jest.fn(),
}));

const database = require("../../../src/config/database");
const { logActivity, ACTIONS } = require("../../../src/utils/activityLogger");

describe("activityLogger", () => {
  beforeEach(() => {
    database.executeStoredProcedure.mockReset();
    database.executeStoredProcedure.mockResolvedValue({ recordsets: [[{}]] });
  });

  const baseReq = {
    user: { UserId: 5, CompId: 1, BranchId: 2 },
    ip: "10.0.0.1",
    headers: { "user-agent": "jest" },
  };

  it("calls sp_SaveActivityLog with the canonical envelope", async () => {
    await logActivity({
      entityType: "Lead",
      entityId: 42,
      action: ACTIONS.CREATED,
      description: "Lead created for ACME",
      req: baseReq,
    });

    expect(database.executeStoredProcedure).toHaveBeenCalledWith(
      "sp_SaveActivityLog",
      expect.objectContaining({
        EntityType: "Lead",
        EntityId: 42,
        Action: "Created",
        Description: "Lead created for ACME",
        UserId: 5,
        CompId: 1,
        BranchId: 2,
        IpAddress: "10.0.0.1",
        UserAgent: "jest",
      })
    );
  });

  it("stringifies oldValue/newValue when provided", async () => {
    await logActivity({
      entityType: "Lead",
      entityId: 7,
      action: ACTIONS.TRANSFERRED,
      fieldName: "BranchId",
      oldValue: 2,
      newValue: 5,
      req: baseReq,
    });
    expect(database.executeStoredProcedure).toHaveBeenCalledWith(
      "sp_SaveActivityLog",
      expect.objectContaining({
        FieldName: "BranchId",
        OldValue: "2",
        NewValue: "5",
      })
    );
  });

  it("no-ops when req.user is missing", async () => {
    await logActivity({
      entityType: "Lead",
      entityId: 1,
      action: ACTIONS.CREATED,
      req: {},
    });
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
  });

  it("no-ops when required fields are missing", async () => {
    await logActivity({ entityType: "Lead", action: ACTIONS.CREATED, req: baseReq });
    await logActivity({ entityId: 1, action: ACTIONS.CREATED, req: baseReq });
    await logActivity({ entityType: "Lead", entityId: 1, req: baseReq });
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
  });

  it("swallows SP failures (audit must never break the operation)", async () => {
    database.executeStoredProcedure.mockRejectedValue(new Error("DB down"));
    await expect(
      logActivity({
        entityType: "Lead",
        entityId: 1,
        action: ACTIONS.CREATED,
        req: baseReq,
      })
    ).resolves.toBeUndefined();
  });

  it("ACTIONS exposes a stable set of action names", () => {
    expect(ACTIONS.CREATED).toBe("Created");
    expect(ACTIONS.UPDATED).toBe("Updated");
    expect(ACTIONS.DELETED).toBe("Deleted");
    expect(ACTIONS.TRANSFERRED).toBe("Transferred");
    expect(ACTIONS.STATUS_CHANGED).toBe("StatusChanged");
  });
});
