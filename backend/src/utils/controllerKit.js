// src/utils/controllerKit.js
//
// The four things every controller method was doing by hand, 85 times over.
//
// This exists because the duplication was not merely verbose — it drifted.
// Half the endpoints treated `ResponseCode === 200` as success and half used
// `< 300`, so an SP returning 201 was reported as a failure by one endpoint and
// a success by its neighbour in the same file. Some guarded
// `result.recordsets[0][0]`, most did not. None of them clamped a page size.
//
// One import per controller: `require("../utils/controllerKit")`.

const { error } = require("./responseHelper");

/**
 * Wraps a controller method so a thrown error becomes one consistent 500
 * instead of a hand-rolled `catch` block.
 *
 * Controllers here are stateless classes with no `this` usage, so wrapping the
 * method is safe — checked before this was written.
 *
 * `res.headersSent` matters more than it looks: a handler that has already
 * responded and then throws (an `await` on a logger, say) would otherwise write
 * a second response and Express would raise ERR_HTTP_HEADERS_SENT, burying the
 * real error under a confusing one.
 */
const asyncRoute = (handler, message, code) =>
  async function wrapped(req, res, next) {
    try {
      return await handler(req, res, next);
    } catch (err) {
      console.error(`${code}:`, err);
      if (res.headersSent) return undefined;
      return error(res, message, code, 500);
    }
  };

/**
 * The first row of the first recordset, or null.
 *
 * `result.recordsets[0][0]` was written unguarded in about fourteen
 * controllers. An SP that returns no rows — which happens when it hits a RETURN
 * before its SELECT — makes that a TypeError, so a clean "nothing found" turned
 * into a 500 with a stack trace and no useful message.
 */
const firstRow = (result) => result?.recordsets?.[0]?.[0] ?? null;

/**
 * The HTTP status an SP asked for.
 *
 * `res.status(spResponse.ResponseCode)` with no fallback throws
 * `RangeError: Invalid status code: undefined` the moment a procedure omits the
 * column — which Express then reports as a generic 500 with nothing pointing at
 * the real cause. Defaults to 500 rather than 200: a response with no code is a
 * malformed one, and guessing success is how a failure gets reported as an
 * empty list.
 */
const spStatus = (row, fallback = 500) => {
  const code = Number(row?.ResponseCode);
  return Number.isInteger(code) && code >= 100 && code <= 599 ? code : fallback;
};

/** Whether an SP's status row reports success. 2xx, so a 201 counts. */
const spOk = (row) => {
  const code = spStatus(row, 0);
  return code >= 200 && code < 300;
};

/** The message an SP set, under either of the two column names in use. */
const spMessage = (row, fallback = "") =>
  row?.ResponseMess ?? row?.ResponseMessage ?? fallback;

/**
 * Hard ceiling on rows per request.
 *
 * Paging values went from `req.body` straight into SP parameters with only a
 * default, so `{"PageSize": 999999999}` was a one-line way to ask SQL Server for
 * every row a scope allows. 200 is above every legitimate caller: the heaviest
 * client page asks for 200, and the mobile board asks for 200.
 */
const MAX_PAGE_SIZE = 200;

/**
 * Clamped paging parameters.
 *
 * Anything non-numeric, negative or absent falls back to the default rather
 * than reaching SQL Server as-is — `PageNumber: "abc"` produced an OFFSET of
 * NaN, and `-1` produced a negative one.
 */
const pageParams = (body = {}, defaultSize = 10) => {
  const number = Number(body.PageNumber);
  const size = Number(body.PageSize);
  return {
    PageNumber: Number.isFinite(number) && number >= 1 ? Math.floor(number) : 1,
    PageSize:
      Number.isFinite(size) && size >= 1
        ? Math.min(Math.floor(size), MAX_PAGE_SIZE)
        : Math.min(defaultSize, MAX_PAGE_SIZE),
  };
};

/**
 * A positive integer id, or null.
 *
 * Ids were destructured and sent onward with no check, so `undefined` reached
 * the procedure and it decided for itself what that meant. Returns null so the
 * caller can answer 400 rather than letting the database guess.
 */
const positiveInt = (value) => {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
};

module.exports = {
  asyncRoute,
  firstRow,
  spStatus,
  spOk,
  spMessage,
  pageParams,
  positiveInt,
  MAX_PAGE_SIZE,
};
