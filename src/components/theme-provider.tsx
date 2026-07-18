import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

type Theme = "light" | "dark" | "system";
type Ctx = { theme: Theme; setTheme: (t: Theme) => void; resolved: "light" | "dark" };

const ThemeContext = createContext<Ctx | null>(null);
const STORAGE_KEY = "theme";

function applyTheme(theme: Theme) {
  if (typeof document === "undefined") return "light" as const;
  const resolved =
    theme === "system"
      ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
      : theme;
  const root = document.documentElement;
  root.classList.toggle("dark", resolved === "dark");
  root.style.colorScheme = resolved;
  return resolved;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>("light");
  const [resolved, setResolved] = useState<"light" | "dark">("light");

  useEffect(() => {
    const stored = (localStorage.getItem(STORAGE_KEY) as Theme | null) ?? "light";
    setThemeState(stored);
    setResolved(applyTheme(stored));

    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      if ((localStorage.getItem(STORAGE_KEY) ?? "light") === "system") {
        setResolved(applyTheme("system"));
      }
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const setTheme = (t: Theme) => {
    localStorage.setItem(STORAGE_KEY, t);
    setThemeState(t);
    setResolved(applyTheme(t));
  };

  return (
    <ThemeContext.Provider value={{ theme, setTheme, resolved }}>{children}</ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}

/** Inline script string for RootShell head to prevent flash. */
export const themeNoFlashScript = `
try {
  var t = localStorage.getItem('theme') || 'light';
  var d = t === 'dark' || (t === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  if (d) document.documentElement.classList.add('dark');
  document.documentElement.style.colorScheme = d ? 'dark' : 'light';
} catch (e) {}
`;
