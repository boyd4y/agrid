import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

type AppShellContextValue = {
  sidebarCollapsed: boolean;
  setSidebarCollapsed: (v: boolean) => void;
  toggleSidebar: () => void;
  aiOpen: boolean;
  setAiOpen: (v: boolean) => void;
  toggleAi: () => void;
  activeTableId: string | null;
  setActiveTableId: (id: string | null) => void;
};

const AppShellContext = createContext<AppShellContextValue | null>(null);

const SIDEBAR_KEY = "agrid.sidebarCollapsed";
const AI_KEY = "agrid.aiOpen";

export function AppShellProvider({ children }: { children: ReactNode }) {
  const [sidebarCollapsed, setSidebarCollapsedState] = useState(() => {
    try {
      return localStorage.getItem(SIDEBAR_KEY) === "1";
    } catch {
      return false;
    }
  });
  const [aiOpen, setAiOpenState] = useState(() => {
    try {
      return localStorage.getItem(AI_KEY) === "1";
    } catch {
      return false;
    }
  });
  const [activeTableId, setActiveTableId] = useState<string | null>(null);

  const setSidebarCollapsed = useCallback((v: boolean) => {
    setSidebarCollapsedState(v);
    try {
      localStorage.setItem(SIDEBAR_KEY, v ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, []);

  const setAiOpen = useCallback((v: boolean) => {
    setAiOpenState(v);
    try {
      localStorage.setItem(AI_KEY, v ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, []);

  const toggleSidebar = useCallback(
    () => setSidebarCollapsed(!sidebarCollapsed),
    [sidebarCollapsed, setSidebarCollapsed]
  );
  const toggleAi = useCallback(() => setAiOpen(!aiOpen), [aiOpen, setAiOpen]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "\\") {
        e.preventDefault();
        setSidebarCollapsed(!sidebarCollapsed);
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "j") {
        e.preventDefault();
        setAiOpen(!aiOpen);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sidebarCollapsed, aiOpen, setSidebarCollapsed, setAiOpen]);

  const value = useMemo(
    () => ({
      sidebarCollapsed,
      setSidebarCollapsed,
      toggleSidebar,
      aiOpen,
      setAiOpen,
      toggleAi,
      activeTableId,
      setActiveTableId,
    }),
    [
      sidebarCollapsed,
      setSidebarCollapsed,
      toggleSidebar,
      aiOpen,
      setAiOpen,
      toggleAi,
      activeTableId,
    ]
  );

  return (
    <AppShellContext.Provider value={value}>{children}</AppShellContext.Provider>
  );
}

export function useAppShell() {
  const ctx = useContext(AppShellContext);
  if (!ctx) throw new Error("useAppShell must be used within AppShellProvider");
  return ctx;
}
