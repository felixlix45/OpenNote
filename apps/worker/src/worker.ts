/**
 * apps/worker — background jobs (ticket 0009).
 *
 * Spine status: boots, validates env, and runs the trash-purge job on an
 * interval. Thumbnail generation + quota recompute attach here as the
 * attachments ticket (0007) lands.
 *
 * Trash purge (ticket 0003): folders/pages with deleted_at older than
 * TRASH_RETENTION_DAYS are hard-deleted. Runs once per hour.
 */
import { loadEnv } from "@opennote/config/env";
import { prisma } from "@opennote/db";

const env = loadEnv(process.env);

const PURGE_INTERVAL_MS = 60 * 60 * 1000; // hourly

async function purgeTrash() {
  const cutoff = new Date(Date.now() - env.TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const folders = await prisma.folder.deleteMany({
    where: { deletedAt: { lt: cutoff } },
  });
  const pages = await prisma.page.deleteMany({
    where: { deletedAt: { lt: cutoff } },
  });
  if (folders.count || pages.count) {
    console.log(
      `[worker] purged ${folders.count} folders, ${pages.count} pages older than ${env.TRASH_RETENTION_DAYS}d`,
    );
  }
}

console.log(
  `[worker] running (trash retention ${env.TRASH_RETENTION_DAYS}d, purge every ${PURGE_INTERVAL_MS / 1000}s)`,
);

await purgeTrash();
setInterval(purgeTrash, PURGE_INTERVAL_MS);

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, async () => {
    console.log(`[worker] ${signal} received, exiting…`);
    await prisma.$disconnect();
    process.exit(0);
  });
}
