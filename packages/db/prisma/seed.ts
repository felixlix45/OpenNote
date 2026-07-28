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
import { PrismaClient } from "../src/generated/client/client.js";

if (process.env.NODE_ENV === "production") {
  throw new Error("Seed script refuses to run in production (it creates known creds).");
}

const prisma = new PrismaClient();

async function main() {
  const ownerEmail = "owner@example.com";
  let owner = await prisma.user.findUnique({ where: { email: ownerEmail } });
  if (!owner) {
    owner = await prisma.user.create({
      data: { email: ownerEmail, name: "OpenNote Owner", emailVerified: new Date() },
    });
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
  const allMembers = await prisma.group.upsert({
    where: { workspaceId_isAllMembers: { workspaceId: workspace.id, isAllMembers: true } },
    update: {},
    create: { workspaceId: workspace.id, name: "All Members", isAllMembers: true },
  });

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

  // A sample page at the workspace root.
  const existingPage = await prisma.page.findFirst({
    where: { workspaceId: workspace.id, title: "Welcome to OpenNote" },
  });
  if (!existingPage) {
    await prisma.page.create({
      data: {
        workspaceId: workspace.id,
        folderId: null,
        parentPageId: null,
        title: "Welcome to OpenNote",
        bodyText: "This is the first page. The block editor lands next.",
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
