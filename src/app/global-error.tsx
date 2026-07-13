"use client";

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Kelpie failed to render", error.digest ?? "unidentified error");
  }, [error.digest]);

  function retry() {
    reset();
    window.location.reload();
  }

  return (
    <html lang="en">
      <body style={{ margin: 0, background: "#101827", color: "#f1f5f9", fontFamily: "system-ui, sans-serif" }}>
        <style>{`.kelpie-global-recovery:focus-visible { outline: 3px solid #60a5fa; outline-offset: 3px; }`}</style>
        <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: "24px" }}>
          <section style={{ width: "100%", maxWidth: "560px", border: "1px solid #334155", borderRadius: "8px", background: "#172033", padding: "40px 24px", textAlign: "center" }}>
            <p style={{ margin: 0, color: "#fcd34d", fontSize: "12px", fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase" }}>
              Kelpie interrupted
            </p>
            <h1 style={{ margin: "12px 0 0", fontSize: "24px" }}>The application could not be loaded</h1>
            <p style={{ margin: "12px auto 0", maxWidth: "440px", color: "#94a3b8", fontSize: "14px", lineHeight: 1.6 }}>
              Your saved data is unchanged. Retry the application, or return to the start and sign in again.
            </p>
            <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: "8px", marginTop: "24px" }}>
              <button
                className="kelpie-global-recovery"
                type="button"
                onClick={retry}
                style={{ minHeight: "44px", border: 0, borderRadius: "6px", background: "#2563eb", color: "white", padding: "10px 16px", fontWeight: 600, cursor: "pointer" }}
              >
                Retry Kelpie
              </button>
              <a
                className="kelpie-global-recovery"
                href="/"
                style={{ minHeight: "44px", display: "inline-flex", alignItems: "center", border: "1px solid #475569", borderRadius: "6px", color: "#e2e8f0", padding: "0 16px", textDecoration: "none", fontWeight: 600 }}
              >
                Return to start
              </a>
            </div>
          </section>
        </main>
      </body>
    </html>
  );
}
