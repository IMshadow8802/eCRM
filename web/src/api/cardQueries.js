// src/api/cardQueries.js — scanned visiting cards (read-only on the web).
import { apiClient } from "../utils/axiosConfig";

export const CARD_ENDPOINTS = { fetchCard: "/api/Card/fetchCard" };

// Photos need the auth header, so an <img src> cannot load them directly:
// fetch as a blob and hand back an object URL. Caller revokes it.
export const fetchCardPhoto = async (path) => {
  const res = await apiClient.get(`/uploads/${path}`, { responseType: "blob" });
  return { url: URL.createObjectURL(res.data) };
};
