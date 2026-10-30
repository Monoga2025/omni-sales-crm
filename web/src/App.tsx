import { useEffect, useState } from "react";
import { CalendarCheck, ChartColumn, Kanban, LogOut, MessagesSquare, Moon, Settings as SettingsIcon, Sparkles, Sun, Workflow } from "lucide-react";
import { api, LiveContext, useLiveSource } from "./api";
import { Inbox } from "./Inbox";
import { Pipeline } from "./Pipeline";
import { Flows } from "./Flows";
import { AnalyticsView } from "./AnalyticsView";
import { Settings } from "./Settings";
import { Today } from "./Today";
import { Login } from "./Login";
import { Tip, cn } from "./ui";

type View = "inbox" | "today" | "pipeline" | "flows" | "analytics" | "settings";
const NAV: { id: View; label: string; icon: typeof Kanban }[] = [
  { id: "inbox", label: "Bandeja", icon: MessagesSquare },
  { id: "today", label: "Hoy", icon: CalendarCheck },
  { id: "pipeline", label: "Pipeline", icon: Kanban },
  { id: "flows", label: "Flujos e IA", icon: Workflow },
  { id: "analytics", label: "Analítica", icon: ChartColumn },
  { id: "settings", label: "Configuración", icon: SettingsIcon },
];

type Theme = "light" | "dark";
const readTheme = (): Theme => {
  try {
    const saved = localStorage.getItem("theme");
    if (saved === "light" || saved === "dark") return saved;
  } catch {
    /* storage unavailable */
  }
  return "dark";
};

interface AuthState {
  required: boolean;
  authenticated: boolean;
}

export function App() {
  const [theme, setTheme] = useState<Theme>(readTheme);
  const [auth, setAuth] = useState<AuthState | null>(null);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem("theme", theme);
    } catch {
      /* storage unavailable */
    }
  }, [theme]);

  useEffect(() => {
    api<AuthState>("GET", "/api/auth/status")
      .then(setAuth)
      .catch(() => setAuth({ required: false, authenticated: true }));
    const expired = () => setAuth((a) => (a ? { ...a, authenticated: false } : a));
    window.addEventListener("auth-required", expired);
    return () => window.removeEventListener("auth-required", expired);
  }, []);

  if (!auth) return null;
  if (auth.required && !auth.authenticated) return <Login onDone={() => setAuth({ required: true, authenticated: true })} />;
  return (
    <Shell
      theme={theme}
      onTheme={setTheme}
      canLogout={auth.required}
      onLogout={() => void api("POST", "/api/auth/logout").then(() => setAuth({ required: true, authenticated: false }))}
    />
  );
}

function Shell({ theme, onTheme, canLogout, onLogout }: { theme: Theme; onTheme: (t: Theme) => void; canLogout: boolean; onLogout: () => void }) {
  const live = useLiveSource();
  const [view, setView] = useState<View>("inbox");
  const [selected, setSelected] = useState<number | null>(null);

  // ⌘K / Ctrl+K jumps to the inbox search from anywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setView("inbox");
        setTimeout(() => window.dispatchEvent(new Event("focus-search")), 30);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const open = (id: number) => {
    setSelected(id);
    setView("inbox");
  };

  return (
    <LiveContext.Provider value={live}>
      <div className="flex h-screen w-screen overflow-hidden">
        <nav aria-label="Principal" className="flex w-12 shrink-0 flex-col items-center gap-1 border-r border-zinc-200 bg-zinc-50 py-4 dark:border-zinc-800 dark:bg-zinc-950">
          <div className="mb-3 flex h-8 w-8 items-center justify-center rounded-lg bg-zinc-200 text-sm font-bold text-zinc-900 dark:bg-[#2f2f32] dark:text-zinc-100" aria-hidden>
            O
          </div>
          {NAV.map(({ id, label, icon: Icon }) => (
            <Tip key={id} label={label}>
              <button
                onClick={() => setView(id)}
                aria-label={label}
                aria-current={view === id ? "page" : undefined}
                className={cn(
                  "relative flex h-9 w-10 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-zinc-200/70 hover:text-zinc-900 dark:hover:bg-[#2f2f32] dark:hover:text-zinc-100",
                  view === id && "text-accent hover:text-accent dark:text-accent",
                )}
              >
                {view === id && <span className="absolute -left-1 h-5 w-0.5 rounded-r bg-accent" />}
                <Icon size={18} strokeWidth={1.75} />
              </button>
            </Tip>
          ))}
          <div className="mt-auto flex flex-col items-center gap-2">
            <Tip label={`Motor IA: ${live.ai || "…"}`}>
              <span className="relative flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500" aria-label={`Motor IA ${live.ai}`}>
                <Sparkles size={16} strokeWidth={1.75} />
                <span className={cn("absolute right-1 top-1 h-1.5 w-1.5 rounded-full ring-2 ring-zinc-50 dark:ring-zinc-950", live.connected ? "bg-emerald-500" : "bg-red-500")} />
              </span>
            </Tip>
            <Tip label={theme === "dark" ? "Modo claro" : "Modo oscuro"}>
              <button
                onClick={() => onTheme(theme === "dark" ? "light" : "dark")}
                aria-label={theme === "dark" ? "Cambiar a modo claro" : "Cambiar a modo oscuro"}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-200/70 hover:text-zinc-900 dark:hover:bg-[#2f2f32] dark:hover:text-zinc-100"
              >
                {theme === "dark" ? <Sun size={16} strokeWidth={1.75} /> : <Moon size={16} strokeWidth={1.75} />}
              </button>
            </Tip>
            {canLogout && (
              <Tip label="Cerrar sesión">
                <button onClick={onLogout} aria-label="Cerrar sesión" className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-200/70 hover:text-zinc-900 dark:hover:bg-[#2f2f32] dark:hover:text-zinc-100">
                  <LogOut size={16} strokeWidth={1.75} />
                </button>
              </Tip>
            )}
          </div>
        </nav>
        <main className="min-w-0 flex-1">
          {view === "inbox" && <Inbox selected={selected} onSelect={setSelected} />}
          {view === "today" && <Today onOpen={open} />}
          {view === "pipeline" && <Pipeline onOpen={open} />}
          {view === "flows" && <Flows />}
          {view === "analytics" && <AnalyticsView />}
          {view === "settings" && <Settings />}
        </main>
      </div>
    </LiveContext.Provider>
  );
}
