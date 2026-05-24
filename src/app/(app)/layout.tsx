import Nav from "@/components/nav";
import { requireUser } from "@/lib/session";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireUser();
  return (
    <div className="min-h-screen">
      <Nav organisationName={user.organisationName} userName={user.name} />
      <main className="mx-auto max-w-7xl px-6 py-6">{children}</main>
    </div>
  );
}
