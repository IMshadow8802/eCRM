// src/api/productQueries.ts
// Read-only product pick-list. Payload taken from
// backend/src/controllers/productController.js. Maintaining the master
// (saveProduct / deleteProduct) is admin desk work and stays on the web.
import { postData } from "./client";
import type { Product } from "../types/api";

export const PRODUCT_ENDPOINTS = {
  fetchProducts: "/api/products/fetchProducts",
} as const;

/** Every active product, name order. 200 is the controller's page ceiling. */
export const fetchProducts = (): Promise<Product[]> =>
  postData<Product>(
    PRODUCT_ENDPOINTS.fetchProducts,
    { PageNumber: 1, PageSize: 200, SearchTerm: null, CategoryId: null, IsActive: true },
    "products",
  );
