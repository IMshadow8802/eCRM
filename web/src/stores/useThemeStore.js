import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

const applyHtmlClass = (mode) => {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (mode === "dark") {
    root.classList.add("dark");
    root.style.colorScheme = "dark";
  } else {
    root.classList.remove("dark");
    root.style.colorScheme = "light";
  }
};

const systemPrefersDark = () => {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
};

// First-load default follows OS. Once user toggles, `userOverride`
// flips true and we stop listening to OS changes.
const useThemeStore = create(
  persist(
    (set, get) => ({
      mode: systemPrefersDark() ? "dark" : "light",
      userOverride: false,

      setMode: (mode) => {
        applyHtmlClass(mode);
        set({ mode, userOverride: true });
      },

      toggleMode: () => {
        const next = get().mode === "dark" ? "light" : "dark";
        applyHtmlClass(next);
        set({ mode: next, userOverride: true });
      },

      // Called on app mount to start system listener (no-op after override)
      syncWithSystem: () => {
        if (typeof window === "undefined" || !window.matchMedia) return () => {};
        const mq = window.matchMedia("(prefers-color-scheme: dark)");
        const handler = (e) => {
          if (get().userOverride) return;
          const next = e.matches ? "dark" : "light";
          applyHtmlClass(next);
          set({ mode: next });
        };
        if (mq.addEventListener) mq.addEventListener("change", handler);
        else mq.addListener(handler);
        return () => {
          if (mq.removeEventListener) mq.removeEventListener("change", handler);
          else mq.removeListener(handler);
        };
      },
    }),
    {
      name: "theme-preference-eCRM",
      storage: createJSONStorage(() => localStorage),
      onRehydrateStorage: () => (state) => {
        // If user never overrode, re-sync to current system at rehydrate
        if (state && !state.userOverride) {
          state.mode = systemPrefersDark() ? "dark" : "light";
        }
        applyHtmlClass(state?.mode || "light");
      },
    }
  )
);

export default useThemeStore;
