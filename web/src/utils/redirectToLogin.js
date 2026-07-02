export const getLoginUrl = () => {
  const base = import.meta.env.BASE_URL || "/";
  return `${base.replace(/\/+$/, "")}/login`;
};

export const redirectToLogin = () => {
  if (typeof window !== "undefined") {
    window.location.href = getLoginUrl();
  }
};
