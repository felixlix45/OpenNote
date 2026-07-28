import type { Metadata } from "next";
import "./globals.css";
// The cmd+K palette mounts globally (⌘K works everywhere). It's a client
// component ("use client"), so it renders fine in the server-component layout —
// its DOM/keyboard code only runs client-side via effects.
import SearchPalette from "@/components/search/SearchPalette";

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
      <body>
        {children}
        <SearchPalette />
      </body>
    </html>
  );
}
