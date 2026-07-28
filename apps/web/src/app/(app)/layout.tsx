/**
 * apps/web — the authenticated app shell route group `(app)`.
 *
 * This layout auth-gates every route under it and mounts {@link AppShell} (the
 * sidebar + main frame) so the sidebar persists across / ↔ /p/[pageId]
 * navigation. Unauthenticated visitors are redirected to /auth.
 *
 * The route group's parentheses mean it doesn't affect the URL: / and /p/:id
 * keep their paths, but both now share this layout (and thus the sidebar).
 */
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/session";
import AppShell from "@/components/sidebar/AppShell";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getSessionUser();
  if (!user) {
    redirect("/auth");
  }
  return <AppShell>{children}</AppShell>;
}
