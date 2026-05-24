import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Kelpie",
  description: "Herd the incident from alert to closed.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
