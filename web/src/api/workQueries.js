// src/api/workQueries.js
// Work calendar (shifts, holidays, rules) and task TAT targets. Same thin POST
// fetchers as masterQueries.js.
import { apiClient } from "../utils/axiosConfig";

export const WORK_ENDPOINTS = {
  fetchWorkSettings: "/api/work/fetchWorkSettings",
  saveCompanySetting: "/api/work/saveCompanySetting",
  saveWorkCalendar: "/api/work/saveWorkCalendar",
  deleteWorkCalendar: "/api/work/deleteWorkCalendar",
  saveHoliday: "/api/work/saveHoliday",
  deleteHoliday: "/api/work/deleteHoliday",
  saveTatPolicy: "/api/tat/saveTatPolicy",
  saveDayMark: "/api/work/saveDayMark",
  deleteDayMark: "/api/work/deleteDayMark",
  fetchDayMarks: "/api/work/fetchDayMarks",
};

const post = (endpoint) => (params = {}) => apiClient.post(endpoint, params);

export const saveCompanySetting = post(WORK_ENDPOINTS.saveCompanySetting);
export const saveWorkCalendar = post(WORK_ENDPOINTS.saveWorkCalendar);
export const deleteWorkCalendar = post(WORK_ENDPOINTS.deleteWorkCalendar);
export const saveHoliday = post(WORK_ENDPOINTS.saveHoliday);
export const deleteHoliday = post(WORK_ENDPOINTS.deleteHoliday);
export const saveTatPolicy = post(WORK_ENDPOINTS.saveTatPolicy);
export const saveDayMark = post(WORK_ENDPOINTS.saveDayMark);
export const deleteDayMark = post(WORK_ENDPOINTS.deleteDayMark);
export const fetchDayMarks = post(WORK_ENDPOINTS.fetchDayMarks);
