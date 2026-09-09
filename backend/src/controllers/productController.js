// src/controllers/productController.js
const database = require("../config/database");
const { success, error, validationError } = require("../utils/responseHelper");
const {
  asyncRoute,
  firstRow,
  spStatus,
  spOk,
  spMessage,
  pageParams,
  positiveInt,
} = require("../utils/controllerKit");

// Numeric form fields arrive as strings from the web; the SP wants decimals.
const num = (v) => (v === "" || v == null ? null : Number(v));

class ProductController {
  save = asyncRoute(
    async (req, res) => {
      const { Id = 0, Name, Code = null, CategoryId = null, UnitPrice = null, MarginPct = null, IsActive = true } = req.body;
      const result = await database.executeStoredProcedure("sp_SaveProduct", {
        Id: positiveInt(Id) ?? 0,
        CompId: req.user.CompId,
        UserId: req.user.UserId,
        Name,
        Code: Code || null,
        CategoryId: positiveInt(CategoryId),
        UnitPrice: num(UnitPrice),
        MarginPct: num(MarginPct),
        IsActive: Boolean(IsActive),
      });
      const row = firstRow(result);
      if (!spOk(row)) return error(res, spMessage(row, "Failed to save product"), "SP_ERROR", spStatus(row));
      return success(res, spMessage(row), row);
    },
    "Failed to save product",
    "PRODUCT_SAVE_ERROR",
  );

  fetch = asyncRoute(
    async (req, res) => {
      const { SearchTerm = null, CategoryId = null, IsActive = true } = req.body;
      const { PageNumber, PageSize } = pageParams(req.body, 25);
      const result = await database.executeStoredProcedure("sp_FetchProducts", {
        CompId: req.user.CompId,
        PageNumber,
        PageSize,
        SearchTerm,
        CategoryId: positiveInt(CategoryId),
        // null = every product, active or not (the admin list); default = pick-lists.
        IsActive: IsActive === null ? null : Boolean(IsActive),
      });
      const products = result.recordsets?.[0] ?? [];
      const p = result.recordsets?.[1]?.[0] ?? {};
      return success(res, "Products fetched successfully", {
        products,
        pagination: {
          currentPage: p.CurrentPage ?? PageNumber,
          pageSize: p.PageSize ?? PageSize,
          totalRecords: p.TotalRecords ?? products.length,
          totalPages: p.TotalPages ?? 1,
        },
      });
    },
    "Failed to fetch products",
    "PRODUCT_FETCH_ERROR",
  );

  delete = asyncRoute(
    async (req, res) => {
      const Id = positiveInt(req.body.Id);
      if (!Id) return validationError(res, "Product ID is required");
      const result = await database.executeStoredProcedure("sp_DeleteProduct", { Id, CompId: req.user.CompId });
      const row = firstRow(result);
      if (!spOk(row)) return error(res, spMessage(row, "Failed to delete product"), "SP_ERROR", spStatus(row));
      return success(res, spMessage(row));
    },
    "Failed to delete product",
    "PRODUCT_DELETE_ERROR",
  );
}

module.exports = new ProductController();
