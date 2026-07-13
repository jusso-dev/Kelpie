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

export type CollaborationEntry = {
  userId: string;
  userName: string;
  editingField: string | null;
  typing: boolean;
  lastSeenAt: string;
};

type CollaborationContextValue = {
  roster: CollaborationEntry[];
  beginEditing: (field: string) => void;
  endEditing: (field: string) => void;
  setTyping: (typing: boolean) => void;
  lockedBy: (field: string) => CollaborationEntry | null;
};

const CollaborationContext = createContext<CollaborationContextValue | null>(null);

export function CaseCollaborationProvider({
  caseId,
  children,
}: {
  caseId: string;
  children: React.ReactNode;
}) {
  const [roster, setRoster] = useState<CollaborationEntry[]>([]);
  const editingField = useRef<string | null>(null);
  const typing = useRef(false);

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
    const events = new EventSource(`/api/cases/${caseId}/presence`);
    events.onmessage = (event) => {
      if (cancelled) return;
      try {
        const data = JSON.parse(event.data) as { roster?: CollaborationEntry[] };
        setRoster(data.roster ?? []);
      } catch {
        // Ignore malformed frames; EventSource continues with the next update.
      }
    };

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
      events.close();
      window.removeEventListener("pagehide", leave);
      void fetch(`/api/cases/${caseId}/presence`, {
        method: "DELETE",
        keepalive: true,
      }).catch(() => undefined);
    };
  }, [caseId, sendHeartbeat]);

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
      beginEditing,
      endEditing,
      setTyping: setTypingState,
      lockedBy,
    }),
    [beginEditing, endEditing, lockedBy, roster, setTypingState],
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
