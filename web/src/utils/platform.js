// Web-only platform utilities

/**
 * Get the base path for the application
 * @returns {string} The base path (/eStockCRM/)
 */
export const getBasename = () => {
  return "/eStockCRM/";
};

/**
 * Helper function to create application URLs with correct base path
 * @param {string} path - The path to append to base
 * @returns {string} The complete URL path
 */
export const createAppUrl = (path) => {
  const cleanPath = path.startsWith("/") ? path.slice(1) : path;
  return `/eStockCRM/${cleanPath}`;
};

/**
 * Open external link in new tab
 * @param {string} url - The URL to open
 */
export const openExternalLink = (url) => {
  window.open(url, "_blank");
};
