const {
  success,
  error,
  dbErrors,
  tokenErrors,
  serverErrors,
  validationError,
} = require("../../../src/utils/responseHelper");
const { mockRes } = require("../../helpers/mockRes");

describe("responseHelper", () => {
  describe("success", () => {
    it("returns 200 with success envelope by default", () => {
      const res = mockRes();
      success(res, "ok", { foo: 1 });
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          message: "ok",
          responseCode: 200,
          data: { foo: 1 },
        })
      );
    });

    it("honors custom status codes", () => {
      const res = mockRes();
      success(res, "created", { id: 5 }, 201);
      expect(res.status).toHaveBeenCalledWith(201);
    });
  });

  describe("error", () => {
    it("defaults to 500 with SERVER_ERROR code", () => {
      const res = mockRes();
      error(res, "boom");
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          message: "boom",
          code: "SERVER_ERROR",
        })
      );
    });
  });

  describe("validationError", () => {
    it("returns 400 with VALIDATION_ERROR code", () => {
      const res = mockRes();
      validationError(res, "missing field");
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ code: "VALIDATION_ERROR", responseCode: 400 })
      );
    });
  });

  describe("tokenErrors", () => {
    it.each([
      ["noToken", "NO_TOKEN"],
      ["invalidFormat", "INVALID_TOKEN_FORMAT"],
      ["tokenExpired", "TOKEN_EXPIRED"],
      ["invalidToken", "INVALID_TOKEN"],
    ])("%s returns 401 with code %s", (method, code) => {
      const res = mockRes();
      tokenErrors[method](res);
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ code, responseCode: 401 })
      );
    });
  });

  describe("dbErrors", () => {
    it("connectionFailed returns 503", () => {
      const res = mockRes();
      dbErrors.connectionFailed(res);
      expect(res.status).toHaveBeenCalledWith(503);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ code: "DB_CONNECTION_FAILED" })
      );
    });

    it("procedureFailed includes proc name in message", () => {
      const res = mockRes();
      dbErrors.procedureFailed(res, "sp_FetchUser");
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining("sp_FetchUser"),
          code: "DB_PROCEDURE_FAILED",
        })
      );
    });

    it("hides query details in production", () => {
      const prevEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = "production";
      const res = mockRes();
      dbErrors.queryFailed(res, "secret stack trace");
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ details: null })
      );
      process.env.NODE_ENV = prevEnv;
    });
  });

  describe("serverErrors", () => {
    it("timeout returns 408", () => {
      const res = mockRes();
      serverErrors.timeout(res);
      expect(res.status).toHaveBeenCalledWith(408);
    });

    it("serviceUnavailable returns 503", () => {
      const res = mockRes();
      serverErrors.serviceUnavailable(res);
      expect(res.status).toHaveBeenCalledWith(503);
    });
  });
});
