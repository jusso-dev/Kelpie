import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Kelpie",
  description: "Incidents. Managed. Closed.",
  icons: {
    icon: "/icon.png",
    apple: "/apple-icon.png",
  },
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
