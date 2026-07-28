"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import {
  foldActivity,
  reconnectDelayMs,
  type CaseActivityEnvelope,
  type ConnectionStatus,
} from "@/lib/case-activity-client";

export type { ConnectionStatus } from "@/lib/case-activity-client";

export type CollaborationEntry = {
  userId: string;
  userName: string;
  editingField: string | null;
  typing: boolean;
  lastSeenAt: string;
};

type CollaborationContextValue = {
  roster: CollaborationEntry[];
  connectionStatus: ConnectionStatus;
  beginEditing: (field: string) => void;
  endEditing: (field: string) => void;
  setTyping: (typing: boolean) => void;
  lockedBy: (field: string) => CollaborationEntry | null;
};

const CollaborationContext = createContext<CollaborationContextValue | null>(null);

/** A blip shorter than this never surfaces as "reconnecting" in the UI. */
const STALE_AFTER_MS = 8_000;
/** Refreshing more often than this on a burst of events is just noise. */
const REFRESH_THROTTLE_MS = 1_500;

export function CaseCollaborationProvider({
  caseId,
  children,
}: {
  caseId: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [roster, setRoster] = useState<CollaborationEntry[]>([]);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>("connecting");
  const editingField = useRef<string | null>(null);
  const typing = useRef(false);
  const activityState = useRef<{ seenIds: Set<string>; cursor: string | null }>({
    seenIds: new Set(),
    cursor: null,
  });
  const refreshTimer = useRef<number | null>(null);
  const requestRefresh = useCallback(() => {
    if (refreshTimer.current !== null) return;
    refreshTimer.current = window.setTimeout(() => {
      refreshTimer.current = null;
      router.refresh();
    }, REFRESH_THROTTLE_MS);
  }, [router]);

  const sendHeartbeat = useCallback(
    (overrides?: { editingField?: string | null; typing?: boolean }) => {
      const nextField =
        overrides && Object.hasOwn(overrides, "editingField")
          ? (overrides.editingField ?? null)
          : editingField.current;
      const nextTyping =
        overrides && Object.hasOwn(overrides, "typing")
          ? Boolean(overrides.typing)
          : typing.current;
      return fetch(`/api/cases/${caseId}/presence`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ editingField: nextField, typing: nextTyping }),
        keepalive: true,
      }).catch(() => undefined);
    },
    [caseId],
  );

  useEffect(() => {
    let cancelled = false;
    void sendHeartbeat();
    const heartbeat = window.setInterval(() => void sendHeartbeat(), 8_000);

    let source: EventSource | null = null;
    let reconnectAttempt = 0;
    let hasConnectedBefore = false;
    let reconnectTimer: number | null = null;
    let staleTimer: number | null = null;

    const clearStaleTimer = () => {
      if (staleTimer !== null) {
        window.clearTimeout(staleTimer);
        staleTimer = null;
      }
    };

    const connect = () => {
      if (cancelled) return;
      setConnectionStatus((prev) => (prev === "live" ? prev : "connecting"));
      const es = new EventSource(`/api/cases/${caseId}/presence`);
      source = es;

      es.onopen = () => {
        if (cancelled) return;
        clearStaleTimer();
        setConnectionStatus("live");
        // A reconnect (as opposed to the very first connection) may have
        // missed events while disconnected. Rather than trying to replay a
        // gap, fetch authoritative state directly: a Next.js route refresh
        // re-runs this route's server-side data loading, so the client
        // converges on the database's current truth regardless of what the
        // channel did or did not deliver in between.
        if (hasConnectedBefore) {
          router.refresh();
        }
        hasConnectedBefore = true;
        reconnectAttempt = 0;
      };

      es.onmessage = (event) => {
        if (cancelled) return;
        try {
          const data = JSON.parse(event.data) as {
            roster?: CollaborationEntry[];
            activity?: CaseActivityEnvelope[];
          };
          setRoster(data.roster ?? []);
          if (data.activity && data.activity.length > 0) {
            const folded = foldActivity(activityState.current, data.activity);
            activityState.current = { seenIds: folded.seenIds, cursor: folded.cursor };
            if (folded.fresh.length > 0) {
              requestRefresh();
            }
          }
        } catch {
          // Ignore malformed frames; the channel continues with the next update.
        }
      };

      es.onerror = () => {
        if (cancelled) return;
        es.close();
        if (source === es) source = null;
        setConnectionStatus("reconnecting");
        if (staleTimer === null) {
          staleTimer = window.setTimeout(() => {
            if (!cancelled) setConnectionStatus("stale");
          }, STALE_AFTER_MS);
        }
        const delay = reconnectDelayMs(reconnectAttempt);
        reconnectAttempt += 1;
        reconnectTimer = window.setTimeout(connect, delay);
      };
    };

    connect();

    const leave = () => {
      navigator.sendBeacon?.(
        `/api/cases/${caseId}/presence`,
        new Blob([JSON.stringify({ leave: true })], { type: "application/json" }),
      );
    };
    window.addEventListener("pagehide", leave);

    return () => {
      cancelled = true;
      window.clearInterval(heartbeat);
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
      clearStaleTimer();
      if (refreshTimer.current !== null) {
        window.clearTimeout(refreshTimer.current);
        refreshTimer.current = null;
      }
      source?.close();
      window.removeEventListener("pagehide", leave);
      void fetch(`/api/cases/${caseId}/presence`, {
        method: "DELETE",
        keepalive: true,
      }).catch(() => undefined);
    };
  }, [caseId, requestRefresh, router, sendHeartbeat]);

  const beginEditing = useCallback(
    (field: string) => {
      editingField.current = field;
      void sendHeartbeat({ editingField: field });
    },
    [sendHeartbeat],
  );
  const endEditing = useCallback(
    (field: string) => {
      if (editingField.current !== field) return;
      editingField.current = null;
      void sendHeartbeat({ editingField: null });
    },
    [sendHeartbeat],
  );
  const setTypingState = useCallback(
    (next: boolean) => {
      typing.current = next;
      void sendHeartbeat({ typing: next });
    },
    [sendHeartbeat],
  );
  const lockedBy = useCallback(
    (field: string) => roster.find((entry) => entry.editingField === field) ?? null,
    [roster],
  );

  const value = useMemo<CollaborationContextValue>(
    () => ({
      roster,
      connectionStatus,
      beginEditing,
      endEditing,
      setTyping: setTypingState,
      lockedBy,
    }),
    [beginEditing, connectionStatus, endEditing, lockedBy, roster, setTypingState],
  );

  return (
    <CollaborationContext.Provider value={value}>
      {children}
    </CollaborationContext.Provider>
  );
}

export function useCaseCollaboration(): CollaborationContextValue {
  const value = useContext(CollaborationContext);
  if (!value) {
    throw new Error("useCaseCollaboration must be used within CaseCollaborationProvider");
  }
  return value;
}

/**
 * Subtle indicator of the realtime channel's health. Deliberately quiet:
 * nothing is shown once live, since that is the expected steady state. A
 * genuine outage shows a muted "Updates paused" label rather than an alarming
 * error, since case data and every mutating action keep working from the
 * database directly while the channel is down.
 */
export function ConnectionStatusIndicator() {
  const { connectionStatus } = useCaseCollaboration();
  if (connectionStatus === "live" || connectionStatus === "connecting") return null;
  const label =
    connectionStatus === "reconnecting" ? "Reconnecting…" : "Updates paused";
  return (
    <span
      role="status"
      className="inline-flex items-center gap-1.5 text-xs text-slate-400"
      title="Live updates are temporarily unavailable. Case data still loads and saves normally."
    >
      <span className="h-1.5 w-1.5 rounded-full bg-amber-500" aria-hidden="true" />
      {label}
    </span>
  );
}

export function FieldLock({ field }: { field: string }) {
  const { lockedBy } = useCaseCollaboration();
  const editor = lockedBy(field);
  if (!editor) return null;
  return (
    <p className="mt-1 text-xs text-amber-300" role="status">
      {editor.userName} is editing this field
    </p>
  );
}
