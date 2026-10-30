import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { SiInstagram, SiMessenger, SiWhatsapp } from "react-icons/si";
import { ChevronDown, Flame, Globe, LifeBuoy, ListChecks, Sprout } from "lucide-react";
import type { AiMode } from "./api";

/** Reactive color scheme: follows `data-theme` on <html>, so canvases that need it as a prop stay in sync. */
export function useTheme(): "light" | "dark" {
  return useSyncExternalStore(
    (cb) => {
      const mo = new MutationObserver(cb);
      mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
      return () => mo.disconnect();
    },
    () => (document.documentElement.dataset.theme === "light" ? "light" : "dark"),
  );
}

export const cn = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

// ---- channels: real brand glyphs
const BRAND: Record<string, { bg: string; icon: (p: { size: number; className?: string }) => ReactNode; color: string }> = {
  whatsapp: { bg: "bg-[#25D366]", color: "#25D366", icon: (p) => <SiWhatsapp {...p} /> },
  instagram: { bg: "bg-gradient-to-tr from-amber-400 via-pink-500 to-fuchsia-600", color: "#E4405F", icon: (p) => <SiInstagram {...p} /> },
  messenger: { bg: "bg-gradient-to-b from-sky-400 to-blue-600", color: "#0A7CFF", icon: (p) => <SiMessenger {...p} /> },
  "web-chat": { bg: "bg-zinc-500", color: "#71717a", icon: (p) => <Globe {...p} /> },
};

export function ChannelBadge({ channel, size = 14, className }: { channel: string; size?: number; className?: string }) {
  const b = BRAND[channel] ?? BRAND["web-chat"]!;
  return (
    <span
      className={cn("inline-flex items-center justify-center rounded-full text-white ring-2 ring-white dark:ring-zinc-950", b.bg, className)}
      style={{ width: size, height: size }}
    >
      {b.icon({ size: Math.round(size * 0.6) })}
    </span>
  );
}

export function ChannelGlyph({ channel, size = 14 }: { channel: string; size?: number }) {
  const b = BRAND[channel] ?? BRAND["web-chat"]!;
  return <span style={{ color: b.color }} className="inline-flex">{b.icon({ size })}</span>;
}

const TONES = ["bg-sky-600", "bg-emerald-600", "bg-amber-600", "bg-rose-600", "bg-indigo-600", "bg-teal-600", "bg-orange-600", "bg-cyan-700"];
const tone = (name: string) => TONES[[...name].reduce((a, c) => a + c.charCodeAt(0), 0) % TONES.length]!;
export const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join("") || "?";

export function Avatar({ name, channel, size = 32 }: { name: string; channel?: string; size?: number }) {
  return (
    <span className="relative inline-flex shrink-0" style={{ width: size, height: size }}>
      <span
        className={cn("inline-flex h-full w-full items-center justify-center rounded-full font-semibold text-white", tone(name))}
        style={{ fontSize: Math.max(10, size * 0.38) }}
      >
        {initials(name)}
      </span>
      {channel && <ChannelBadge channel={channel} size={Math.round(size * 0.46)} className="absolute -bottom-0.5 -right-0.5" />}
    </span>
  );
}

// ---- small primitives
export function Tip({ label, children, side = "right" }: { label: string; children: ReactNode; side?: "right" | "bottom" | "top" }) {
  const pos = side === "right" ? "left-full top-1/2 ml-2 -translate-y-1/2" : side === "bottom" ? "top-full left-1/2 mt-1.5 -translate-x-1/2" : "bottom-full left-1/2 mb-1.5 -translate-x-1/2";
  return (
    <span className="group/tip relative inline-flex">
      {children}
      <span
        role="tooltip"
        className={cn(
          "pointer-events-none absolute z-50 whitespace-nowrap rounded-lg bg-zinc-900 px-2 py-1 text-[11px] font-medium text-zinc-50 opacity-0 shadow-lg transition-opacity delay-150 group-hover/tip:opacity-100 dark:bg-zinc-100 dark:text-zinc-900",
          pos,
        )}
      >
        {label}
      </span>
    </span>
  );
}

export const Kbd = ({ children }: { children: ReactNode }) => (
  <kbd className="rounded border border-zinc-300 bg-zinc-100 px-1 font-sans text-[10px] font-medium text-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400">{children}</kbd>
);

export function Section({ title, icon, children, defaultOpen = true, action }: { title: string; icon?: ReactNode; children: ReactNode; defaultOpen?: boolean; action?: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="border-b border-zinc-200 dark:border-zinc-800">
      <div className="flex h-9 items-center pr-3">
        <button
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          className="flex h-full flex-1 items-center gap-2 px-3 text-left text-[11px] font-semibold uppercase tracking-wide text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
        >
          <ChevronDown size={13} className={cn("transition-transform", !open && "-rotate-90")} />
          {icon}
          {title}
        </button>
        {action}
      </div>
      {open && <div className="px-3 pb-3">{children}</div>}
    </section>
  );
}

const MODE_ICON: Record<AiMode, typeof Flame> = { qualify: ListChecks, nurture: Sprout, close_aggressive: Flame, support: LifeBuoy };
const MODE_TONE: Record<AiMode, string> = {
  qualify: "text-sky-600 dark:text-sky-400",
  nurture: "text-emerald-600 dark:text-emerald-400",
  close_aggressive: "text-orange-600 dark:text-orange-400",
  support: "text-zinc-500 dark:text-zinc-400",
};
export function ModeIcon({ mode, size = 13 }: { mode: AiMode; size?: number }) {
  const I = MODE_ICON[mode];
  return <I size={size} className={MODE_TONE[mode]} />;
}

export function Btn({ variant = "ghost", className, ...p }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" | "danger" | "subtle" }) {
  const v = {
    primary: "bg-accent text-white hover:brightness-110 dark:text-black",
    ghost: "border border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800",
    subtle: "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800",
    danger: "border border-red-200 text-red-600 hover:bg-red-50 dark:border-red-900/60 dark:text-red-400 dark:hover:bg-red-950/40",
  }[variant];
  return (
    <button
      {...p}
      className={cn("inline-flex h-7 items-center justify-center gap-1.5 rounded-lg px-3 text-sm font-medium transition-colors disabled:cursor-default disabled:opacity-40", v, className)}
    />
  );
}

export const inputCls =
  "h-7 w-full rounded-lg border border-zinc-200 bg-white px-2 text-xs text-zinc-900 placeholder:text-zinc-400 focus:border-accent focus:outline-none dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100 dark:placeholder:text-zinc-500";

/** Click-to-edit text: Enter or blur saves, Escape cancels. */
export function InlineEdit({ value, onSave, placeholder = "Añadir", className }: { value: string; onSave: (v: string) => void; placeholder?: string; className?: string }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => setDraft(value), [value]);
  useEffect(() => {
    if (editing) ref.current?.select();
  }, [editing]);
  const commit = () => {
    setEditing(false);
    if (draft.trim() !== value) onSave(draft.trim());
  };
  if (!editing)
    return (
      <button onClick={() => setEditing(true)} className={cn("min-w-0 truncate rounded px-1 text-left hover:bg-zinc-100 dark:hover:bg-zinc-800", !value && "text-zinc-400", className)}>
        {value || placeholder}
      </button>
    );
  return (
    <input
      ref={ref}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
        if (e.key === "Escape") {
          setDraft(value);
          setEditing(false);
        }
      }}
      className={cn(inputCls, "h-6 px-1", className)}
    />
  );
}

export function ScoreBar({ score, className }: { score: number; className?: string }) {
  const tone = score >= 60 ? "bg-emerald-500" : score >= 30 ? "bg-amber-500" : "bg-rose-500";
  return (
    <span className={cn("block h-1 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800", className)} role="img" aria-label={`Puntaje ${score} de 100`}>
      <span className={cn("block h-full rounded-full", tone)} style={{ width: `${score}%` }} />
    </span>
  );
}
