const AUTH_ENDPOINTS = [
  "/api/auth/loginUser",
  "/api/auth/logoutUser",
  "/api/auth/hashPassword",
];

export const shouldSkipAuthRedirect = (url) => {
  if (!url || typeof url !== "string") return false;
  return AUTH_ENDPOINTS.some((endpoint) => url.endsWith(endpoint));
};
