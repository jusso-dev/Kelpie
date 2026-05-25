import Image from "next/image";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-md">
        <div className="mb-6 flex flex-col items-center text-center">
          <Image
            src="/brand/kelpie-logo.png"
            alt="Kelpie"
            width={220}
            height={220}
            priority
            className="h-auto w-44 sm:w-52"
          />
          <p className="mt-3 text-sm uppercase tracking-[0.24em] text-slate-400">
            Incidents. Managed. Closed.
          </p>
        </div>
        {children}
      </div>
    </main>
  );
}
