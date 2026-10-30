import { useState } from "react";
import { Lock } from "lucide-react";
import { api } from "./api";
import { Btn, inputCls } from "./ui";

export function Login({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      await api("POST", "/api/auth/login", { password });
      onDone();
    } catch (e) {
      const m = (e as Error).message;
      setErr(m.includes("wrong password") ? "Contraseña incorrecta." : m.includes("too many") ? "Demasiados intentos. Espera unos minutos." : m);
      setBusy(false);
    }
  };

  return (
    <div className="flex h-screen w-screen items-center justify-center bg-zinc-50 dark:bg-zinc-950">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        className="w-[340px] space-y-4 rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900"
      >
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-zinc-200 dark:bg-[#2f2f32]">
            <Lock size={16} />
          </span>
          <div>
            <h1 className="text-base font-semibold">Omni Sales CRM</h1>
            <p className="text-xs text-zinc-500">Acceso del equipo</p>
          </div>
        </div>
        <label className="block space-y-1 text-xs text-zinc-500">
          Contraseña
          <input autoFocus type="password" value={password} onChange={(e) => setPassword(e.target.value)} className={inputCls} autoComplete="current-password" />
        </label>
        {err && <p role="alert" className="text-xs text-red-500">{err}</p>}
        <Btn variant="primary" className="w-full" disabled={busy || !password}>
          {busy ? "Entrando…" : "Entrar"}
        </Btn>
      </form>
    </div>
  );
}
