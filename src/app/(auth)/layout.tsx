export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <h1 className="text-3xl font-semibold tracking-tight text-[color:var(--color-tan-400)]">
            Kelpie
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Herd the incident from alert to closed.
          </p>
        </div>
        {children}
      </div>
    </main>
  );
}
