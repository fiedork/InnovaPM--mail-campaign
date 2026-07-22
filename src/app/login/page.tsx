"use client";

import Image from "next/image";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: form.get("password") }),
    });
    const result = await response.json();
    if (!response.ok) {
      setError(result.error || "Logowanie nie powiodło się.");
      setPending(false);
      return;
    }
    const target = new URLSearchParams(window.location.search).get("next");
    router.replace(target?.startsWith("/") ? target : "/");
    router.refresh();
  }

  return (
    <main className="login-page">
      <section className="login-card">
        <div className="login-brand">
          <span className="login-brand-mark">
            <Image src="/innova-logo.jpg" alt="InnovaPM" width={64} height={64} priority />
          </span>
          <div>
            <strong>InnovaPM</strong>
            <small>Mail Campaign</small>
          </div>
        </div>
        <p className="eyebrow">Dostęp prywatny</p>
        <h1>Panel kampanii</h1>
        <p className="copy">
          Podaj hasło dostępu. Sesja wygaśnie automatycznie po 12 godzinach.
        </p>
        <form onSubmit={login}>
          <label>
            Hasło
            <input
              type="password"
              name="password"
              autoComplete="current-password"
              required
              autoFocus
            />
          </label>
          {error && <p className="login-error">{error}</p>}
          <button className="button primary" disabled={pending}>
            {pending ? "Logowanie…" : "Zaloguj"}
          </button>
        </form>
      </section>
    </main>
  );
}
