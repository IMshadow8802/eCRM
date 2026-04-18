// src/utils/spHelpers.js
//
// Most fetch SPs emit a single "no records found" placeholder row
// (all NULL fields) when the query returns nothing, so the result set
// has a predictable column shape. That placeholder leaks into the API
// response as a ghost record with Id=null, which then trips up any
// consumer that assumes "length > 0 ⇒ real data" (e.g. `projects[0].Id
// .toString()`). cleanSpRows strips the envelope fields and drops any
// placeholder row — callers always get a clean list of real records.

function cleanSpRows(rows, pkField = "Id") {
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row) => {
      const {
        ResponseCode,
        ResponseMess,
        ResponseMessage,
        TotalRecords,
        TotalPages,
        CurrentPage,
        PageSize,
        ...clean
      } = row;
      return clean;
    })
    .filter((row) => row[pkField] !== null && row[pkField] !== undefined);
}

module.exports = { cleanSpRows };
