"use client";

import { useCallback, useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import type { ExternalPortalView } from "@/lib/stakeholder/types";

function PortalInner() {
  const params = useSearchParams();
  const inviteToken = params.get("token");
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [view, setView] = useState<ExternalPortalView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [responseBody, setResponseBody] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  const authHeaders = useCallback(
    (json = true): HeadersInit => {
      const h: Record<string, string> = {};
      if (json) h["Content-Type"] = "application/json";
      if (sessionToken) h.Authorization = `Bearer ${sessionToken}`;
      return h;
    },
    [sessionToken],
  );

  const loadMe = useCallback(
    async (token: string) => {
      const res = await fetch("/api/portal/me", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Unable to load portal");
      }
      setView((await res.json()) as ExternalPortalView);
    },
    [],
  );

  useEffect(() => {
    if (!inviteToken) return;
    let cancelled = false;
    (async () => {
      setBusy(true);
      setError(null);
      try {
        // Invite secret arrives via query only as a one-shot bootstrap (email
        // links). Prefer POST body exchange; strip token from the URL after
        // accept so it is not retained in history, referrers, or screenshots.
        const res = await fetch("/api/portal/accept", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: inviteToken }),
        });
        const body = (await res.json()) as {
          error?: string;
          sessionToken?: string;
        };
        if (!res.ok || !body.sessionToken) {
          throw new Error(body.error ?? "Invalid or expired invitation");
        }
        if (cancelled) return;
        setSessionToken(body.sessionToken);
        if (typeof window !== "undefined") {
          const url = new URL(window.location.href);
          url.searchParams.delete("token");
          window.history.replaceState({}, "", url.pathname + url.search + url.hash);
        }
        await loadMe(body.sessionToken);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to open portal");
        }
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [inviteToken, loadMe]);

  async function submitResponse() {
    if (!sessionToken || !responseBody.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/portal/responses", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ body: responseBody }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Failed to send response");
      }
      setResponseBody("");
      setMessage("Response submitted");
      await loadMe(sessionToken);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function markRead(updateId: string) {
    if (!sessionToken) return;
    await fetch(`/api/portal/updates/${updateId}/read`, {
      method: "POST",
      headers: authHeaders(),
    });
    await loadMe(sessionToken);
  }

  async function decide(approvalId: string, decision: "approved" | "rejected") {
    if (!sessionToken) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/portal/approvals/${approvalId}`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ decision }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Decision failed");
      }
      setMessage(`Marked ${decision}`);
      await loadMe(sessionToken);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function uploadEvidence(requestId: string, file: File) {
    if (!sessionToken) return;
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.set("file", file);
      const res = await fetch(
        `/api/portal/evidence-requests/${requestId}/upload`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${sessionToken}` },
          body: form,
        },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Upload failed");
      }
      setMessage("Upload received and queued for scanning");
      await loadMe(sessionToken);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  if (!inviteToken && !sessionToken) {
    return (
      <main className="mx-auto max-w-lg px-4 py-16 text-center text-slate-300">
        <h1 className="text-lg font-semibold text-slate-100">
          Kelpie stakeholder portal
        </h1>
        <p className="mt-2 text-sm text-slate-500">
          Open the secure link from your invitation email to continue. This
          portal does not use organisation staff accounts.
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-2xl space-y-6 px-4 py-10">
      <header className="space-y-1">
        <p className="text-xs uppercase tracking-wide text-violet-300">
          External stakeholder portal
        </p>
        <h1 className="text-xl font-semibold text-slate-100">
          {view?.case.caseNumber ?? "Loading…"}
        </h1>
        {view && (
          <p className="text-sm text-slate-400">
            {view.case.title} · {view.case.status} · TLP:{view.case.tlp} · role{" "}
            {view.case.role}
          </p>
        )}
        {view && (
          <p className="text-xs text-slate-500">
            Purpose: {view.case.purpose}. Signed in as{" "}
            {view.collaborator.displayName}.
          </p>
        )}
      </header>

      {busy && !view && (
        <p className="text-sm text-slate-400">Opening invitation…</p>
      )}
      {error && (
        <p className="rounded border border-rose-800/50 bg-rose-950/30 p-3 text-sm text-rose-200">
          {error}
        </p>
      )}
      {message && (
        <p className="rounded border border-emerald-800/40 bg-emerald-950/20 p-2 text-sm text-emerald-200">
          {message}
        </p>
      )}

      {view && (
        <>
          {view.case.classificationRedacted && (
            <p className="text-xs text-amber-300">
              Some case fields are restricted by the invitation classification
              ceiling.
            </p>
          )}

          {view.capabilities.includes("view_updates") && (
            <section className="space-y-2">
              <h2 className="text-sm font-medium text-slate-200">Updates</h2>
              {view.updates.length === 0 && (
                <p className="text-xs text-slate-500">No updates yet.</p>
              )}
              {view.updates.map((u) => (
                <article
                  key={u.id}
                  className="rounded border border-slate-800 bg-slate-950/50 p-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-sm font-medium text-slate-100">
                      {u.title}
                    </h3>
                    {!u.read &&
                      view.capabilities.includes("read_receipt") && (
                        <button
                          type="button"
                          className="text-xs text-sky-400 underline"
                          onClick={() => markRead(u.id)}
                        >
                          Mark read
                        </button>
                      )}
                  </div>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-slate-300">
                    {u.body}
                  </p>
                  <p className="mt-1 text-[10px] text-slate-500">
                    {new Date(u.publishedAt).toLocaleString()} · TLP:{u.tlp}
                    {u.read ? " · read" : ""}
                  </p>
                </article>
              ))}
            </section>
          )}

          {view.capabilities.includes("view_evidence_requests") && (
            <section className="space-y-2">
              <h2 className="text-sm font-medium text-slate-200">
                Evidence requests
              </h2>
              {view.evidenceRequests.map((r) => (
                <article
                  key={r.id}
                  className="rounded border border-slate-800 p-3 text-sm"
                >
                  <h3 className="font-medium text-slate-100">{r.title}</h3>
                  <p className="mt-1 text-slate-400">{r.instructions}</p>
                  <p className="mt-1 text-[10px] uppercase text-slate-500">
                    {r.status}
                  </p>
                  {r.status === "open" &&
                    view.capabilities.includes("upload_evidence") && (
                      <input
                        type="file"
                        className="mt-2 block text-xs text-slate-300"
                        aria-label={`Upload for ${r.title}`}
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) void uploadEvidence(r.id, f);
                        }}
                      />
                    )}
                </article>
              ))}
            </section>
          )}

          {view.capabilities.includes("view_approvals") && (
            <section className="space-y-2">
              <h2 className="text-sm font-medium text-slate-200">Approvals</h2>
              {view.approvals.map((a) => (
                <article
                  key={a.id}
                  className="rounded border border-slate-800 p-3 text-sm"
                >
                  <h3 className="font-medium text-slate-100">{a.title}</h3>
                  <p className="mt-1 text-slate-400">{a.description}</p>
                  <p className="mt-1 text-[10px] uppercase text-slate-500">
                    {a.status}
                  </p>
                  {a.status === "pending" &&
                    view.capabilities.includes("approve") && (
                      <div className="mt-2 flex gap-2">
                        <button
                          type="button"
                          disabled={busy}
                          className="kelpie-btn-primary text-xs"
                          onClick={() => decide(a.id, "approved")}
                        >
                          Approve
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          className="rounded border border-rose-700 px-2 py-1 text-xs text-rose-300"
                          onClick={() => decide(a.id, "rejected")}
                        >
                          Reject
                        </button>
                      </div>
                    )}
                </article>
              ))}
            </section>
          )}

          {view.capabilities.includes("respond") && (
            <section className="space-y-2">
              <h2 className="text-sm font-medium text-slate-200">Your response</h2>
              <textarea
                className="kelpie-input min-h-[96px] w-full"
                value={responseBody}
                onChange={(e) => setResponseBody(e.target.value)}
                placeholder="Write your response to the analyst team"
              />
              <button
                type="button"
                disabled={busy || !responseBody.trim()}
                className="kelpie-btn-primary text-xs"
                onClick={() => void submitResponse()}
              >
                Send response
              </button>
              {view.responses.length > 0 && (
                <ul className="mt-3 space-y-2">
                  {view.responses.map((r) => (
                    <li
                      key={r.id}
                      className="rounded border border-violet-800/40 bg-violet-950/20 p-2 text-xs text-violet-100"
                    >
                      <span className="font-semibold uppercase tracking-wide">
                        External
                      </span>{" "}
                      · {r.attribution}
                      <p className="mt-1 whitespace-pre-wrap text-slate-200">
                        {r.body}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
        </>
      )}
    </main>
  );
}

export default function PortalPage() {
  return (
    <Suspense
      fallback={
        <main className="p-10 text-center text-slate-400">Loading portal…</main>
      }
    >
      <PortalInner />
    </Suspense>
  );
}
