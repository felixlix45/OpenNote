/**
 * apps/worker — background jobs (ticket 0009).
 *
 * Spine status: boots, validates env, and runs the trash-purge job on an
 * interval. Thumbnail generation + quota recompute attach here as the
 * attachments ticket (0007) lands.
 *
 * Trash purge (ticket 0003): folders/pages with deleted_at older than
 * TRASH_RETENTION_DAYS are hard-deleted. Attachment S3 objects are deleted
 * before the DB rows cascade away. Runs once per hour.
 */
import { loadEnv } from "@opennote/config/env";
import { prisma } from "@opennote/db";
import { createS3Service } from "@opennote/storage";

const env = loadEnv(process.env);
const s3 = createS3Service(env);

const PURGE_INTERVAL_MS = 60 * 60 * 1000; // hourly

async function purgeTrash() {
  try {
    const cutoff = new Date(
      Date.now() - env.TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000,
    );

    // Collect S3 keys before hard-delete cascades away attachment rows.
    const pagesToPurge = await prisma.page.findMany({
      where: { deletedAt: { lt: cutoff } },
      select: {
        id: true,
        attachments: { select: { s3Key: true } },
      },
    });

    let s3Deleted = 0;
    for (const page of pagesToPurge) {
      for (const att of page.attachments) {
        try {
          await s3.deleteObject(att.s3Key);
          s3Deleted += 1;
        } catch (err) {
          console.error(`[worker] failed to delete s3 object ${att.s3Key}:`, err);
        }
      }
    }

    // Pages first (attachments cascade from pages), then folders.
    const pages = await prisma.page.deleteMany({
      where: { deletedAt: { lt: cutoff } },
    });
    const folders = await prisma.folder.deleteMany({
      where: { deletedAt: { lt: cutoff } },
    });

    if (folders.count || pages.count || s3Deleted) {
      console.log(
        `[worker] purged ${folders.count} folders, ${pages.count} pages, ${s3Deleted} s3 objects older than ${env.TRASH_RETENTION_DAYS}d`,
      );
    }
  } catch (err) {
    console.error("[worker] purgeTrash failed:", err);
  }
}

console.log(
  `[worker] running (trash retention ${env.TRASH_RETENTION_DAYS}d, purge every ${PURGE_INTERVAL_MS / 1000}s)`,
);

await purgeTrash();
setInterval(() => {
  void purgeTrash();
}, PURGE_INTERVAL_MS);

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, async () => {
    console.log(`[worker] ${signal} received, exiting…`);
    await prisma.$disconnect();
    process.exit(0);
  });
}
