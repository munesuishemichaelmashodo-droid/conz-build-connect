import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useAuth } from "@/lib/auth";

type Theme = "light" | "dark";
type ActiveRole = "customer" | "driver";

type ViewModeState = {
  theme: Theme;
  setTheme: (t: Theme) => void;
  toggleTheme: () => void;
  activeRole: ActiveRole | null;
  setActiveRole: (r: ActiveRole) => void;
  availableRoles: ActiveRole[];
};

const Ctx = createContext<ViewModeState>({
  theme: "light",
  setTheme: () => {},
  toggleTheme: () => {},
  activeRole: null,
  setActiveRole: () => {},
  availableRoles: [],
});

const THEME_KEY = "conz.theme";
const ROLE_KEY = "conz.activeRole";

export function ViewModeProvider({ children }: { children: ReactNode }) {
  const { is } = useAuth();
  const isCustomer = is("customer");
  const isDriver = is("driver");
  const availableRoles: ActiveRole[] = [
    ...(isCustomer ? (["customer"] as const) : []),
    ...(isDriver ? (["driver"] as const) : []),
  ];

  const [theme, setThemeState] = useState<Theme>(() => {
    if (typeof window === "undefined") return "dark";
    return (localStorage.getItem(THEME_KEY) as Theme) ?? "dark";
  });

  const [activeRole, setActiveRoleState] = useState<ActiveRole | null>(() => {
    if (typeof window === "undefined") return null;
    return (localStorage.getItem(ROLE_KEY) as ActiveRole) ?? null;
  });

  // Apply theme class
  useEffect(() => {
    const root = document.documentElement;
    if (theme === "dark") root.classList.add("dark");
    else root.classList.remove("dark");
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  // Sync active role with available roles
  useEffect(() => {
    if (availableRoles.length === 0) return;
    if (!activeRole || !availableRoles.includes(activeRole)) {
      setActiveRoleState(availableRoles[0]);
    }
  }, [availableRoles.join(","), activeRole]); // eslint-disable-line

  const setTheme = (t: Theme) => setThemeState(t);
  const toggleTheme = () => setThemeState((p) => (p === "dark" ? "light" : "dark"));
  const setActiveRole = (r: ActiveRole) => {
    setActiveRoleState(r);
    localStorage.setItem(ROLE_KEY, r);
  };

  return (
    <Ctx.Provider value={{ theme, setTheme, toggleTheme, activeRole, setActiveRole, availableRoles }}>
      {children}
    </Ctx.Provider>
  );
}

export const useViewMode = () => useContext(Ctx);
