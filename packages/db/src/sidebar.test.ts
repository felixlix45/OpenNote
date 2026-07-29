/**
 * @opennote/db — integration tests for the sidebar repository functions.
 *
 * Covers the per-node permission scoping that is the security-critical property
 * of the sidebar: a page/folder the user cannot read must never appear in the
 * visible tree, recents, or favorites — even though the underlying accessor
 * would otherwise return it.
 *
 * Fixture mirrors effective-permission.test.ts (same uuid scheme, same
 * truncate). Runs against the same docker Postgres; skipped without DATABASE_URL.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "./generated/client/index.js";
import {
  listVisibleTree,
  recordPageVisit,
  listRecentPages,
  listFavoritePages,
  addFavorite,
  removeFavorite,
} from "./repository.js";

const DATABASE_URL = process.env.DATABASE_URL;
const itDb = DATABASE_URL ? it : it.skip;

const prisma = new PrismaClient({
  datasources: { db: { url: DATABASE_URL } },
});

// Same recognizable UUID scheme as the sibling test file.
function uuid(n: number): string {
  const hex = n.toString(16).padStart(12, "0").slice(0, 12);
  return `00000000-0000-0000-0000-${hex}`;
}

interface Fixture {
  workspaceId: string;
  ownerId: string;
  memberId: string; // a regular member (editor via open-workspace rule)
  guestId: string; // access only via explicit shares
  allMembersGroupId: string;
  rootFolderId: string;
  secretFolderId: string; // a folder NOT shared with the guest
  sharedPageId: string; // a page the guest CAN read (explicit share)
  secretPageId: string; // a page in secretFolder the guest CANNOT read
  memberPageId: string; // a page the member reads via the open-workspace rule
}

async function seedFixture(db: PrismaClient, f: Fixture): Promise<void> {
  for (const uid of [f.ownerId, f.memberId, f.guestId]) {
    await db.user.upsert({
      where: { id: uid },
      update: {},
      create: { id: uid, email: `u-${uid}@test.local` },
    });
  }

  await db.workspace.upsert({
    where: { id: f.workspaceId },
    update: {},
    create: {
      id: f.workspaceId,
      name: "ws",
      slug: "ws",
      createdById: f.ownerId,
      ownerId: f.ownerId,
    },
  });

  // all-members group BEFORE members (trigger ordering, see sibling tests).
  // Partial unique index (not Prisma @@unique) → findFirst + create.
  const existingAllMembers = await db.group.findFirst({
    where: { workspaceId: f.workspaceId, isAllMembers: true },
  });
  if (!existingAllMembers) {
    await db.group.create({
      data: {
        id: f.allMembersGroupId,
        workspaceId: f.workspaceId,
        name: "All Members",
        isAllMembers: true,
      },
    });
  }

  for (const [uid, role] of [
    [f.ownerId, "owner"],
    [f.memberId, "member"],
    [f.guestId, "guest"],
  ] as const) {
    await db.workspaceMember.upsert({
      where: { workspaceId_userId: { workspaceId: f.workspaceId, userId: uid } },
      update: { role },
      create: { workspaceId: f.workspaceId, userId: uid, role },
    });
  }

  // Open-workspace rule: all-members → editor on the workspace root.
  const existingRootShare = await db.share.findFirst({
    where: {
      workspaceId: f.workspaceId,
      resourceType: "folder",
      resourceId: null,
      principalGroupId: f.allMembersGroupId,
    },
  });
  if (!existingRootShare) {
    await db.share.create({
      data: {
        workspaceId: f.workspaceId,
        resourceType: "folder",
        resourceId: null,
        principalGroupId: f.allMembersGroupId,
        level: "editor",
        createdById: f.ownerId,
      },
    });
  }

  // Two root folders. rootFolder is readable by everyone (open-workspace rule).
  // secretFolder is NOT shared → a guest can't see it or its pages.
  await db.folder.upsert({
    where: { id: f.rootFolderId },
    update: {},
    create: {
      id: f.rootFolderId,
      workspaceId: f.workspaceId,
      parentId: null,
      name: "root",
      createdById: f.ownerId,
    },
  });
  await db.folder.upsert({
    where: { id: f.secretFolderId },
    update: {},
    create: {
      id: f.secretFolderId,
      workspaceId: f.workspaceId,
      parentId: null,
      name: "secret",
      createdById: f.ownerId,
    },
  });

  // memberPage lives in rootFolder → member reads it via the open-workspace rule.
  await db.page.upsert({
    where: { id: f.memberPageId },
    update: {},
    create: {
      id: f.memberPageId,
      workspaceId: f.workspaceId,
      folderId: f.rootFolderId,
      parentPageId: null,
      title: "member-page",
      createdById: f.ownerId,
    },
  });

  // sharedPage lives in rootFolder AND has an explicit reader share for the guest.
  await db.page.upsert({
    where: { id: f.sharedPageId },
    update: {},
    create: {
      id: f.sharedPageId,
      workspaceId: f.workspaceId,
      folderId: f.rootFolderId,
      parentPageId: null,
      title: "shared-page",
      createdById: f.ownerId,
    },
  });
  await db.share.create({
    data: {
      workspaceId: f.workspaceId,
      resourceType: "page",
      resourceId: f.sharedPageId,
      principalUserId: f.guestId,
      level: "reader",
      createdById: f.ownerId,
    },
  });

  // secretPage lives in secretFolder → guest has no share path to it.
  await db.page.upsert({
    where: { id: f.secretPageId },
    update: {},
    create: {
      id: f.secretPageId,
      workspaceId: f.workspaceId,
      folderId: f.secretFolderId,
      parentPageId: null,
      title: "secret-page",
      createdById: f.ownerId,
    },
  });
}

async function truncateAll(db: PrismaClient): Promise<void> {
  await db.$executeRawUnsafe(
    'TRUNCATE TABLE "shares", "page_docs", "attachments", "workspace_invites", "favorite_pages", "page_visits", "pages", "folders", "group_members", "groups", "workspace_members", "workspaces", "verifications", "sessions", "accounts", "users" RESTART IDENTITY CASCADE',
  );
}

describe.skipIf(!DATABASE_URL)("sidebar repository — integration", () => {
  let f: Fixture;

  beforeAll(async () => {
    const exists = await prisma.$queryRaw<{ ok: boolean }[]>`
      SELECT to_regprocedure('effective_permission(uuid,uuid,text,uuid,int)') IS NOT NULL AS ok
    `;
    if (!exists[0]?.ok) {
      throw new Error(
        "effective_permission() not installed — apply packages/db/prisma/sql/*.sql first.",
      );
    }
  });

  beforeEach(async () => {
    await truncateAll(prisma);
    f = {
      workspaceId: uuid(0x10),
      ownerId: uuid(0x20),
      memberId: uuid(0x22),
      guestId: uuid(0x23),
      allMembersGroupId: uuid(0x31),
      rootFolderId: uuid(0x40),
      secretFolderId: uuid(0x44),
      sharedPageId: uuid(0x50),
      secretPageId: uuid(0x51),
      memberPageId: uuid(0x52),
    };
    await seedFixture(prisma, f);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  // ----- visible tree: per-node permission scoping -----

  itDb("guest sees the shared page but NOT the secret page/folder in the tree", async () => {
    const tree = await listVisibleTree(prisma, {
      workspaceId: f.workspaceId,
      userId: f.guestId,
      maxNestingDepth: 32,
    });
    const pageIds = tree.pages.map((p) => p.id);
    const folderIds = tree.folders.map((fo) => fo.id);

    // Guest has an explicit reader share on sharedPage → visible.
    expect(pageIds).toContain(f.sharedPageId);
    // Guest has no share path to secretPage or secretFolder → MUST be absent.
    expect(pageIds).not.toContain(f.secretPageId);
    expect(folderIds).not.toContain(f.secretFolderId);
  });

  itDb("owner sees the entire tree (bypass)", async () => {
    const tree = await listVisibleTree(prisma, {
      workspaceId: f.workspaceId,
      userId: f.ownerId,
      maxNestingDepth: 32,
    });
    const pageIds = tree.pages.map((p) => p.id);
    const folderIds = tree.folders.map((fo) => fo.id);
    expect(pageIds).toContain(f.secretPageId);
    expect(folderIds).toContain(f.secretFolderId);
  });

  itDb("member sees memberPage via the open-workspace rule (no explicit share)", async () => {
    const tree = await listVisibleTree(prisma, {
      workspaceId: f.workspaceId,
      userId: f.memberId,
      maxNestingDepth: 32,
    });
    const pageIds = tree.pages.map((p) => p.id);
    expect(pageIds).toContain(f.memberPageId);
  });

  itDb("visible tree excludes soft-deleted pages", async () => {
    await prisma.page.update({
      where: { id: f.sharedPageId },
      data: { deletedAt: new Date() },
    });
    const tree = await listVisibleTree(prisma, {
      workspaceId: f.workspaceId,
      userId: f.ownerId,
      maxNestingDepth: 32,
    });
    expect(tree.pages.map((p) => p.id)).not.toContain(f.sharedPageId);
  });

  // ----- recent pages: revocation drops the page -----

  itDb("recent pages are newest-first and a revoked share removes the page", async () => {
    // Guest visits both sharedPage and secretPage directly (bypassing the API's
    // can_read gate) to seed visit rows. The listing must still filter.
    await recordPageVisit(prisma, {
      userId: f.guestId,
      pageId: f.sharedPageId,
      workspaceId: f.workspaceId,
    });
    await recordPageVisit(prisma, {
      userId: f.guestId,
      pageId: f.secretPageId,
      workspaceId: f.workspaceId,
    });

    const recent = await listRecentPages(prisma, {
      workspaceId: f.workspaceId,
      userId: f.guestId,
      limit: 10,
      maxNestingDepth: 32,
    });
    const recentIds = recent.map((r) => r.id);
    expect(recentIds).toContain(f.sharedPageId); // share intact → visible
    expect(recentIds).not.toContain(f.secretPageId); // no share → filtered out
  });

  // ----- favorites: add / list / remove round-trip -----

  itDb("favorites add/list/remove round-trip and respect permission scoping", async () => {
    // Guest favorites sharedPage (they can read it) and secretPage (they can't).
    // The orphan favorite on secretPage must be hidden by the listing — the row
    // lingers but the permission predicate excludes it.
    await addFavorite(prisma, {
      userId: f.guestId,
      pageId: f.sharedPageId,
      workspaceId: f.workspaceId,
    });
    await addFavorite(prisma, {
      userId: f.guestId,
      pageId: f.secretPageId,
      workspaceId: f.workspaceId,
    });

    let favs = await listFavoritePages(prisma, {
      workspaceId: f.workspaceId,
      userId: f.guestId,
      maxNestingDepth: 32,
    });
    let favIds = favs.map((x) => x.id);
    expect(favIds).toContain(f.sharedPageId); // readable → shown
    expect(favIds).not.toContain(f.secretPageId); // not readable → hidden (row lingers)

    // Remove the favorite; listing should no longer include it.
    await removeFavorite(prisma, { userId: f.guestId, pageId: f.sharedPageId });
    favs = await listFavoritePages(prisma, {
      workspaceId: f.workspaceId,
      userId: f.guestId,
      maxNestingDepth: 32,
    });
    favIds = favs.map((x) => x.id);
    expect(favIds).not.toContain(f.sharedPageId);
  });

  itDb("removeFavorite is a no-op for a non-favorited page", async () => {
    // Should not throw.
    await removeFavorite(prisma, { userId: f.guestId, pageId: f.sharedPageId });
    const favs = await listFavoritePages(prisma, {
      workspaceId: f.workspaceId,
      userId: f.guestId,
      maxNestingDepth: 32,
    });
    expect(favs.map((x) => x.id)).not.toContain(f.sharedPageId);
  });
});
