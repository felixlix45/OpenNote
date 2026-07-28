import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "OpenNote",
  description: "Self-hostable, multi-tenant, real-time notes.",
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
