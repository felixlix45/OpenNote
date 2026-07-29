/**
 * @opennote/db — dev seed script (ticket 0009).
 *
 * Creates a workspace, an owner user, the all-members group, and a sample
 * page — enough for `pnpm dev` to boot into a non-empty state. Idempotent:
 * safe to re-run.
 *
 * 🔒 This is DEV ONLY. The seed creates a user with a known credential via
 * Better Auth's password hashing — it must never run against a production DB.
 * Guarded by a NODE_ENV check.
 */
import { PrismaClient } from "../src/generated/client/index.js";
import { randomBytes, scrypt } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt);

if (process.env.NODE_ENV === "production") {
  throw new Error("Seed script refuses to run in production (it creates known creds).");
}

/**
 * Hash a password the same way Better Auth does (@better-auth/utils/password):
 * scrypt with N=16384, r=16, p=1, dkLen=64, format "salt:key" (both hex).
 * Replicated here with node:crypto to avoid a workspace dep cycle (auth→db).
 */
async function hashPasswordDev(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const key = (await scryptAsync(password.normalize("NFKC"), salt, 64, {
    N: 16384,
    r: 16,
    p: 1,
    maxmem: 128 * 16384 * 16 * 2,
  })) as Buffer;
  return `${salt}:${key.toString("hex")}`;
}

const prisma = new PrismaClient();

async function main() {
  const ownerEmail = "owner@example.com";
  const ownerPassword = "opennote123";
  let owner = await prisma.user.findUnique({ where: { email: ownerEmail } });
  if (!owner) {
    owner = await prisma.user.create({
      data: { email: ownerEmail, name: "OpenNote Owner", emailVerified: true },
    });
  }

  // Create a Better Auth credential account so the seeded owner can log in
  // (owner@example.com / opennote123). Better Auth uses @better-auth/utils/password
  // (Node scrypt) — import directly to avoid a workspace dep cycle (auth→db).
  // Idempotent: skip if a credential already exists.
  const existingAcct = await prisma.account.findFirst({
    where: { userId: owner.id, providerId: "credential" },
  });
  if (!existingAcct) {
    const hash = await hashPasswordDev(ownerPassword);
    await prisma.account.create({
      data: {
        userId: owner.id,
        providerId: "credential",
        accountId: owner.id,
        password: hash,
      },
    });
    console.log(`[seed] owner login: ${ownerEmail} / ${ownerPassword}`);
  }

  const workspaceSlug = "opennote";
  let workspace = await prisma.workspace.findUnique({
    where: { slug: workspaceSlug },
  });
  if (!workspace) {
    workspace = await prisma.workspace.create({
      data: {
        name: "OpenNote",
        slug: workspaceSlug,
        createdById: owner.id,
        ownerId: owner.id,
      },
    });
  }

  // All-members group — MUST exist before members are inserted so the
  // keep_all_members_in_sync trigger populates group_members for non-guest
  // roles (the trigger no-ops if the group isn't seeded yet).
  // Lookup by (workspaceId, isAllMembers=true); uniqueness is a partial index,
  // not a Prisma @@unique, so upsert-by-compound-name is unavailable.
  let allMembers = await prisma.group.findFirst({
    where: { workspaceId: workspace.id, isAllMembers: true },
  });
  if (!allMembers) {
    allMembers = await prisma.group.create({
      data: { workspaceId: workspace.id, name: "All Members", isAllMembers: true },
    });
  }

  // Owner membership (idempotent). The trigger adds the owner to all-members;
  // the explicit groupMember upsert below is belt-and-suspenders.
  await prisma.workspaceMember.upsert({
    where: { workspaceId_userId: { workspaceId: workspace.id, userId: owner.id } },
    update: { role: "owner" },
    create: { workspaceId: workspace.id, userId: owner.id, role: "owner" },
  });
  await prisma.groupMember.upsert({
    where: { groupId_userId: { groupId: allMembers.id, userId: owner.id } },
    update: {},
    create: { groupId: allMembers.id, userId: owner.id },
  });

  // Implicit all-members → Editor share on the workspace root (sentinel).
  // The sentinel's resource_id is NULL; Postgres treats NULL ≠ NULL in the
  // composite unique, so upsert-by-unique can't match it. Use findFirst +
  // create-if-missing instead.
  const existingRootShare = await prisma.share.findFirst({
    where: {
      workspaceId: workspace.id,
      resourceType: "folder",
      resourceId: null,
      principalGroupId: allMembers.id,
    },
  });
  if (!existingRootShare) {
    await prisma.share.create({
      data: {
        workspaceId: workspace.id,
        resourceType: "folder",
        resourceId: null,
        principalGroupId: allMembers.id,
        level: "editor",
        createdById: owner.id,
      },
    });
  }

  // A root folder for the workspace (pages need exactly one tree parent — the
  // CHECK (folder_id IS NULL) <> (parent_page_id IS NULL) forbids a parentless
  // page). The workspace root sentinel (resource_id NULL) is for *shares*,
  // not for content placement.
  const rootFolder = await prisma.folder.findFirst({
    where: { workspaceId: workspace.id, parentId: null, name: "Getting Started" },
  });
  const folder =
    rootFolder ??
    (await prisma.folder.create({
      data: {
        workspaceId: workspace.id,
        parentId: null,
        name: "Getting Started",
        createdById: owner.id,
      },
    }));

  // A sample page in the root folder.
  const existingPage = await prisma.page.findFirst({
    where: { workspaceId: workspace.id, title: "Welcome to OpenNote" },
  });
  if (!existingPage) {
    await prisma.page.create({
      data: {
        workspaceId: workspace.id,
        folderId: folder.id,
        parentPageId: null, // top-level page in a folder (exactly-one-parent)
        title: "Welcome to OpenNote",
        bodyText: "This is the first page. The block editor is live.",
        createdById: owner.id,
      },
    });
  }

  console.log(`[seed] workspace=${workspace.slug} owner=${owner.email}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
