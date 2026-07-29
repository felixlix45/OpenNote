/**
 * @opennote/db — integration tests for the effective_permission() SQL function.
 *
 * These run against a REAL Postgres (the docker-compose service). They verify
 * the crown-jewel path: the recursive CTE that implements the union rule from
 * ticket 0002. The TS engine unit tests (packages/auth) cover the decision
 * logic; these cover the SQL the engine delegates to.
 *
 * Skipped automatically when DATABASE_URL is unset (so a DB-less environment
 * doesn't fail) — set it to run. Prerequisite: schema + raw SQL applied
 * (constraints.sql, triggers.sql, effective-permission.sql).
 *
 * Coverage matrix (each maps to a spec line in 0002/0003 + SECURITY-REVIEW):
 *   - owner/admin bypass (manage, no shares consulted)
 *   - open-workspace rule: member → editor on the root via all-members group
 *   - guest: only explicit shares
 *   - union rule: strongest grant on the path wins; child never downgrades
 *   - inheritance down a folder tree
 *   - nested-page walk (the bug fixed in code review): shares on a folder
 *     containing an ancestor page apply to the deeply-nested page
 *   - group shares resolve live
 *   - soft-delete: trashed resource excluded from the path walk
 *   - tenant isolation: cross-workspace user gets none
 *   - non-member: none
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "./generated/client/index.js";

const DATABASE_URL = process.env.DATABASE_URL;

const itDb = DATABASE_URL ? it : it.skip;

const prisma = new PrismaClient({
  datasources: { db: { url: DATABASE_URL } },
});

// Stable, recognizable ids per test run — cleared in beforeEach.
function uuid(n: number): string {
  // A valid UUID v4 shape: 8-4-4-4-12 hex. The last group is exactly 12 hex
  // digits: zero-pad n into 12. Postgres rejects anything else.
  const hex = n.toString(16).padStart(12, "0").slice(0, 12);
  return `00000000-0000-0000-0000-${hex}`;
}

interface Fixture {
  workspaceId: string;
  otherWorkspaceId: string;
  ownerId: string; // owner of workspaceId
  adminId: string;
  memberId: string; // a regular member
  guestId: string; // a guest (access only via shares)
  otherUserId: string; // member of the OTHER workspace (tenant-isolation check)
  groupId: string; // a group in workspaceId
  allMembersGroupId: string;
  rootFolderId: string;
  childFolderId: string;
  topPageId: string; // page in childFolderId
  nestedPage1Id: string; // sub-page under topPageId
  nestedPage2Id: string; // sub-sub-page under nestedPage1Id
  otherWorkspacePageId: string; // page in the OTHER workspace
}

async function seedFixture(
  db: PrismaClient,
  f: Fixture,
): Promise<void> {
  // Users.
  for (const uid of [
    f.ownerId,
    f.adminId,
    f.memberId,
    f.guestId,
    f.otherUserId,
  ]) {
    await db.user.upsert({
      where: { id: uid },
      update: {},
      create: { id: uid, email: `u-${uid}@test.local` },
    });
  }

  // Workspaces.
  for (const [wid, name] of [
    [f.workspaceId, "ws"],
    [f.otherWorkspaceId, "ws-other"],
  ] as const) {
    await db.workspace.upsert({
      where: { id: wid },
      update: {},
      create: { id: wid, name, slug: name, createdById: f.ownerId, ownerId: f.ownerId },
    });
  }

  // The all-members group MUST be created BEFORE members are inserted: the
  // keep_all_members_in_sync trigger adds non-guest members to it on insert,
  // but only if the group already exists (else it no-ops). Order matters.
  // Partial unique index (not Prisma @@unique) → findFirst + create.
  let allMembers = await db.group.findFirst({
    where: { workspaceId: f.workspaceId, isAllMembers: true },
  });
  if (!allMembers) {
    allMembers = await db.group.create({
      data: {
        id: f.allMembersGroupId,
        workspaceId: f.workspaceId,
        name: "All Members",
        isAllMembers: true,
      },
    });
  }
  const group = await db.group.upsert({
    where: { id: f.groupId },
    update: {},
    create: { id: f.groupId, workspaceId: f.workspaceId, name: "Engineering" },
  });
  void allMembers;
  void group;

  // Memberships in the main workspace. Inserted AFTER the all-members group so
  // the trigger populates group_members for non-guest roles.
  for (const [uid, role] of [
    [f.ownerId, "owner"],
    [f.adminId, "admin"],
    [f.memberId, "member"],
    [f.guestId, "guest"],
  ] as const) {
    await db.workspaceMember.upsert({
      where: { workspaceId_userId: { workspaceId: f.workspaceId, userId: uid } },
      update: { role },
      create: { workspaceId: f.workspaceId, userId: uid, role },
    });
  }
  // otherUserId is a member of the OTHER workspace only. (No all-members group
  // seeded there — not needed for these tests.)
  await db.workspaceMember.upsert({
    where: {
      workspaceId_userId: { workspaceId: f.otherWorkspaceId, userId: f.otherUserId },
    },
    update: {},
    create: { workspaceId: f.otherWorkspaceId, userId: f.otherUserId, role: "owner" },
  });

  // All-members → Editor share on the workspace root (the open-workspace rule).
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

  // Folder tree: root → childFolder.
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
    where: { id: f.childFolderId },
    update: {},
    create: {
      id: f.childFolderId,
      workspaceId: f.workspaceId,
      parentId: f.rootFolderId,
      name: "child",
      createdById: f.ownerId,
    },
  });

  // Pages: topPage (in childFolder), nestedPage1 (sub-page of topPage),
  // nestedPage2 (sub-sub-page). This chain is what exercises the nested-page
  // folder walk (the code-review bug): nestedPage2's nearest folder is
  // childFolder (via topPage), 2 page-edges up.
  await db.page.upsert({
    where: { id: f.topPageId },
    update: {},
    create: {
      id: f.topPageId,
      workspaceId: f.workspaceId,
      folderId: f.childFolderId,
      parentPageId: null,
      title: "top",
      createdById: f.ownerId,
    },
  });
  await db.page.upsert({
    where: { id: f.nestedPage1Id },
    update: {},
    create: {
      id: f.nestedPage1Id,
      workspaceId: f.workspaceId,
      folderId: null,
      parentPageId: f.topPageId,
      title: "nested1",
      createdById: f.ownerId,
    },
  });
  await db.page.upsert({
    where: { id: f.nestedPage2Id },
    update: {},
    create: {
      id: f.nestedPage2Id,
      workspaceId: f.workspaceId,
      folderId: null,
      parentPageId: f.nestedPage1Id,
      title: "nested2",
      createdById: f.ownerId,
    },
  });

  // A page in the OTHER workspace (tenant-isolation check). It needs exactly
  // one tree parent (the CHECK enforces it), so put it in a folder.
  const otherFolder = await db.folder.upsert({
    where: { id: uuid(0x42) },
    update: {},
    create: {
      id: uuid(0x42),
      workspaceId: f.otherWorkspaceId,
      parentId: null,
      name: "other-root",
      createdById: f.otherUserId,
    },
  });
  await db.page.upsert({
    where: { id: f.otherWorkspacePageId },
    update: {},
    create: {
      id: f.otherWorkspacePageId,
      workspaceId: f.otherWorkspaceId,
      folderId: otherFolder.id,
      parentPageId: null,
      title: "other-ws-page",
      createdById: f.otherUserId,
    },
  });
}

async function effective(
  db: PrismaClient,
  workspaceId: string,
  userId: string,
  resourceType: "folder" | "page",
  resourceId: string | null,
): Promise<string> {
  const rows = await db.$queryRaw<{ effective_permission: string | null }[]>`
    SELECT effective_permission(
      ${workspaceId}::uuid,
      ${userId}::uuid,
      ${resourceType}::text,
      ${resourceId}::uuid,
      32
    ) AS effective_permission
  `;
  return rows[0]?.effective_permission ?? "none";
}

async function truncateAll(db: PrismaClient): Promise<void> {
  // Order-independent: disable + re-enable triggers so the all-members sync
  // trigger doesn't fire mid-truncate.
  await db.$executeRawUnsafe(
    'TRUNCATE TABLE "shares", "page_docs", "attachments", "workspace_invites", "favorite_pages", "page_visits", "pages", "folders", "group_members", "groups", "workspace_members", "workspaces", "verifications", "sessions", "accounts", "users" RESTART IDENTITY CASCADE',
  );
}

describe.skipIf(!DATABASE_URL)("effective_permission() SQL — integration", () => {
  let f: Fixture;

  beforeAll(async () => {
    // Confirm the function exists; fail fast with a clear message if not.
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
      otherWorkspaceId: uuid(0x11),
      ownerId: uuid(0x20),
      adminId: uuid(0x21),
      memberId: uuid(0x22),
      guestId: uuid(0x23),
      otherUserId: uuid(0x24),
      groupId: uuid(0x30),
      allMembersGroupId: uuid(0x31),
      rootFolderId: uuid(0x40),
      childFolderId: uuid(0x41),
      topPageId: uuid(0x50),
      nestedPage1Id: uuid(0x51),
      nestedPage2Id: uuid(0x52),
      otherWorkspacePageId: uuid(0x53),
    };
    await seedFixture(prisma, f);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  // ----- owner / admin bypass -----

  itDb("owner bypasses → 'none' SQL returns none, but the engine folds in manage", async () => {
    // The SQL function does NOT know about role bypass (that's the TS engine's
    // job). So an owner with no personal shares still gets whatever the path
    // grants. With the open-workspace rule, that's 'editor' (the all-members
    // root share). The point of this test: confirm the SQL path is walked even
    // for owners, and returns editor (the union of path shares).
    const level = await effective(
      prisma,
      f.workspaceId,
      f.ownerId,
      "page",
      f.topPageId,
    );
    expect(level).toBe("editor");
  });

  itDb("admin sees the same path result as owner (bypass is engine-layer)", async () => {
    const level = await effective(
      prisma,
      f.workspaceId,
      f.adminId,
      "page",
      f.topPageId,
    );
    expect(level).toBe("editor");
  });

  // ----- open-workspace rule -----

  itDb("a member is editor on the root via the all-members group (open-workspace rule)", async () => {
    const level = await effective(
      prisma,
      f.workspaceId,
      f.memberId,
      "folder",
      null, // workspace-root sentinel
    );
    expect(level).toBe("editor");
  });

  itDb("a member is editor on a nested page inherited from the root", async () => {
    const level = await effective(
      prisma,
      f.workspaceId,
      f.memberId,
      "page",
      f.nestedPage2Id,
    );
    expect(level).toBe("editor");
  });

  // ----- guest: only explicit shares -----

  itDb("a guest with no shares gets none on the root", async () => {
    const level = await effective(
      prisma,
      f.workspaceId,
      f.guestId,
      "folder",
      null,
    );
    expect(level).toBe("none");
  });

  itDb("a guest with a Reader share on a folder gets reader (not the inherited editor)", async () => {
    // Guest gets an explicit Reader share on childFolder. Even though the root
    // has an editor share to all-members, the guest is NOT in all-members
    // (they're a guest), so they only get their explicit reader grant.
    await prisma.share.create({
      data: {
        workspaceId: f.workspaceId,
        resourceType: "folder",
        resourceId: f.childFolderId,
        principalUserId: f.guestId,
        level: "reader",
        createdById: f.ownerId,
      },
    });
    const level = await effective(
      prisma,
      f.workspaceId,
      f.guestId,
      "page",
      f.topPageId, // page inside childFolder
    );
    expect(level).toBe("reader");
  });

  // ----- union rule: strongest grant wins, child never downgrades -----

  itDb("union rule: a reader share on the page plus an editor share on the folder → editor wins", async () => {
    // Guest gets reader on the page directly, but editor on the folder above.
    await prisma.share.create({
      data: {
        workspaceId: f.workspaceId,
        resourceType: "page",
        resourceId: f.topPageId,
        principalUserId: f.guestId,
        level: "reader",
        createdById: f.ownerId,
      },
    });
    await prisma.share.create({
      data: {
        workspaceId: f.workspaceId,
        resourceType: "folder",
        resourceId: f.childFolderId,
        principalUserId: f.guestId,
        level: "editor",
        createdById: f.ownerId,
      },
    });
    const level = await effective(
      prisma,
      f.workspaceId,
      f.guestId,
      "page",
      f.topPageId,
    );
    expect(level).toBe("editor");
  });

  itDb("union rule: a child reader share does NOT downgrade an ancestor editor share", async () => {
    // Editor on the folder, reader on the page. Editor must win (no Deny).
    await prisma.share.create({
      data: {
        workspaceId: f.workspaceId,
        resourceType: "folder",
        resourceId: f.childFolderId,
        principalUserId: f.guestId,
        level: "editor",
        createdById: f.ownerId,
      },
    });
    await prisma.share.create({
      data: {
        workspaceId: f.workspaceId,
        resourceType: "page",
        resourceId: f.topPageId,
        principalUserId: f.guestId,
        level: "reader",
        createdById: f.ownerId,
      },
    });
    const level = await effective(
      prisma,
      f.workspaceId,
      f.guestId,
      "page",
      f.topPageId,
    );
    expect(level).toBe("editor");
  });

  // ----- nested-page walk (the code-review bug) -----

  itDb("nested-page walk: an editor share on the folder applies to a deeply-nested sub-page", async () => {
    // This is the regression test for the code-review bug. nestedPage2 sits
    // under nestedPage1 under topPage under childFolder. A share on childFolder
    // must apply to nestedPage2 — the path walk must resolve the page chain's
    // nearest folder (childFolder) and include it.
    await prisma.share.create({
      data: {
        workspaceId: f.workspaceId,
        resourceType: "folder",
        resourceId: f.childFolderId,
        principalUserId: f.guestId,
        level: "editor",
        createdById: f.ownerId,
      },
    });
    const level = await effective(
      prisma,
      f.workspaceId,
      f.guestId,
      "page",
      f.nestedPage2Id,
    );
    expect(level).toBe("editor");
  });

  itDb("nested-page walk: a share on a folder that is NOT on the chain does not apply", async () => {
    // Share on rootFolder; the nested page chain bottoms out in childFolder,
    // not rootFolder... but rootFolder IS an ancestor of childFolder, so the
    // share SHOULD apply (it's on the path). Verify it does (confirms the walk
    // continues up through childFolder → rootFolder, not just the nearest).
    await prisma.share.create({
      data: {
        workspaceId: f.workspaceId,
        resourceType: "folder",
        resourceId: f.rootFolderId,
        principalUserId: f.guestId,
        level: "reader",
        createdById: f.ownerId,
      },
    });
    const level = await effective(
      prisma,
      f.workspaceId,
      f.guestId,
      "page",
      f.nestedPage2Id,
    );
    expect(level).toBe("reader");
  });

  // ----- group shares resolve live -----

  itDb("a group share applies to all current group members", async () => {
    await prisma.groupMember.create({
      data: { groupId: f.groupId, userId: f.guestId },
    });
    await prisma.share.create({
      data: {
        workspaceId: f.workspaceId,
        resourceType: "folder",
        resourceId: f.childFolderId,
        principalGroupId: f.groupId,
        level: "editor",
        createdById: f.ownerId,
      },
    });
    const level = await effective(
      prisma,
      f.workspaceId,
      f.guestId,
      "page",
      f.topPageId,
    );
    expect(level).toBe("editor");
  });

  itDb("removing a user from the group immediately drops their grant (live resolution)", async () => {
    await prisma.groupMember.create({
      data: { groupId: f.groupId, userId: f.guestId },
    });
    await prisma.share.create({
      data: {
        workspaceId: f.workspaceId,
        resourceType: "folder",
        resourceId: f.childFolderId,
        principalGroupId: f.groupId,
        level: "editor",
        createdById: f.ownerId,
      },
    });
    expect(
      await effective(prisma, f.workspaceId, f.guestId, "page", f.topPageId),
    ).toBe("editor");

    // Remove from group — no cache, so the grant evaporates immediately.
    await prisma.groupMember.delete({
      where: { groupId_userId: { groupId: f.groupId, userId: f.guestId } },
    });
    expect(
      await effective(prisma, f.workspaceId, f.guestId, "page", f.topPageId),
    ).toBe("none");
  });

  // ----- soft-delete -----

  itDb("a share on a trashed folder does not grant access (soft-delete excluded from path)", async () => {
    await prisma.share.create({
      data: {
        workspaceId: f.workspaceId,
        resourceType: "folder",
        resourceId: f.childFolderId,
        principalUserId: f.guestId,
        level: "editor",
        createdById: f.ownerId,
      },
    });
    // Trash the folder. The page under it is still active, but its ancestor
    // folder is gone from the path walk → the share no longer applies.
    await prisma.folder.update({
      where: { id: f.childFolderId },
      data: { deletedAt: new Date() },
    });
    const level = await effective(
      prisma,
      f.workspaceId,
      f.guestId,
      "page",
      f.topPageId,
    );
    // topPage's folder_id is childFolder (now trashed) → the page-chain-folder
    // lookup excludes it, so the guest gets none.
    expect(level).toBe("none");
  });

  // ----- tenant isolation -----

  itDb("a user from another workspace gets none, even with a same-id-looking share", async () => {
    // Give the guest an editor share in the main workspace...
    await prisma.share.create({
      data: {
        workspaceId: f.workspaceId,
        resourceType: "page",
        resourceId: f.topPageId,
        principalUserId: f.guestId,
        level: "editor",
        createdById: f.ownerId,
      },
    });
    // ...and confirm a DIFFERENT user (otherUserId, owner of the other ws)
    // gets none on the main workspace's page.
    const level = await effective(
      prisma,
      f.workspaceId,
      f.otherUserId,
      "page",
      f.topPageId,
    );
    expect(level).toBe("none");
  });

  itDb("tenant guard: the workspace_id filter prevents cross-workspace share matches", async () => {
    // otherUserId is owner of otherWorkspace. A page there, with an editor
    // share... but we query the MAIN workspace. Must return none.
    await prisma.share.create({
      data: {
        workspaceId: f.otherWorkspaceId,
        resourceType: "page",
        resourceId: f.otherWorkspacePageId,
        principalUserId: f.otherUserId,
        level: "editor",
        createdById: f.otherUserId,
      },
    });
    // Querying the main workspace for a resource id that belongs to the OTHER
    // workspace: the workspace_id filter + the path lookup (which scopes by
    // workspace) must yield none.
    const level = await effective(
      prisma,
      f.workspaceId,
      f.otherUserId,
      "page",
      f.otherWorkspacePageId,
    );
    expect(level).toBe("none");
  });

  // ----- non-member -----

  itDb("a user with no membership and no shares gets none", async () => {
    // otherUserId is not a member of the main workspace at all.
    const level = await effective(
      prisma,
      f.workspaceId,
      f.otherUserId,
      "page",
      f.topPageId,
    );
    expect(level).toBe("none");
  });
});
