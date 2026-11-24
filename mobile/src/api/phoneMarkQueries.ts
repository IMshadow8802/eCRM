// src/api/phoneMarkQueries.ts
// Do-not-call / caution marks (149). Payload from
// backend/src/controllers/phoneMarkController.js. The route needs the calling
// edit grant: a caller marks do-not-call only through a call result.
import { post } from "./client";
import type { PhoneMark } from "../types/api";

export const setPhoneMark = ({ Mobile, Mark, Note }: { Mobile: string; Mark: PhoneMark; Note: string }) =>
  post("/api/phoneMark/set", { Mobile, Mark, Note });
