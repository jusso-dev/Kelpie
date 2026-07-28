import type { ReactNode } from "react";

/**
 * Minimal layout for external stakeholders. No app shell, no staff nav,
 * no organisation enumeration surfaces.
 */
export default function PortalLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="border-b border-slate-800 px-4 py-3">
        <span className="text-sm font-semibold tracking-tight text-violet-200">
          Kelpie
        </span>
        <span className="ml-2 text-xs text-slate-500">Stakeholder portal</span>
      </div>
      {children}
    </div>
  );
}
