# CONTEXT — OpenNote

A glossary of the OpenNote domain. Devoid of implementation detail; just the
canonical meaning of each term. Updated as terms are resolved.

> Scope of this file: the *ubiquitous language*. Schema, libraries, and
> mechanics live in the wayfinder tickets (`.tracker/issues/`) and ADRs.

## Core entities

- **User** — a global identity (one account, potentially a member of many
  Workspaces). Owns credentials and a profile. Identity scope: **global**
  (decided in ticket 0002's resolution; confirm in ticket 0006).

- **Workspace** — the tenant boundary. Everything (Folders, Pages, Attachments,
  Groups, Shares) belongs to exactly one Workspace. Has exactly one Owner.

- **Workspace Member** — a User's participation in a Workspace under a Role.
  A User can be a Member of many Workspaces, with a different Role in each.

## Roles (workspace-global, per member)

A strict capability ladder. Listed weakest → strongest.

- **Guest** — a Member whose access is *entirely* defined by per-resource
  Shares. Sees only explicitly-shared resources; cannot browse the Workspace
  tree. Invited from outside the Workspace via a Share on a Folder or Page.
- **Member** — the default Role for joined users. By the "open workspace"
  rule, is effectively **Editor** on every resource (via the implicit
  *all-members* group share on the Workspace root).
- **Admin** — manage Workspace settings, members, and Groups. Cannot delete
  the Workspace or transfer ownership.
- **Owner** — one or more per Workspace. Everything Admin can do, plus delete
  the Workspace and transfer ownership. The Workspace's principal of last
  resort.

> Owner/Admin **bypass** the Share model entirely — they have full manage on
> every resource.

## Permission levels (the per-resource axis)

Granted by a **Share** to a principal (User or Group) on a Folder or Page.
Strongest grant wins (see *Effective permission* below).

- **Reader** — view a resource; in the realtime layer, connects but cannot
  produce updates.
- **Commenter** — Reader plus the ability to comment. **Reserved in v1**;
  comments are post-v1, so Commenter behaves as Reader until then.
- **Editor** — full edit on the resource.

> There is no "Full Access / reshare" level in v1. Only Owner/Admin can create
> Shares.

## Shares & inheritance

- **Share** — a grant of a Permission level on a Folder or Page to a
  principal (a User or a Group). The atomic unit of the access model.
- **Principal** — the target of a Share: either a **User** (direct grant) or a
  **Group** (grant to all current Group Members).
- **Group** — a named set of Users, scoped to one Workspace. Many-to-many with
  Users. A Share may target a Group; membership is evaluated **live** at
  check time (not cached).
- **All-members group** — an auto-maintained Group containing every non-Guest
  Member of the Workspace. The Workspace root carries an implicit **Editor**
  Share to this group — the mechanism behind the "open workspace" rule.
- **Effective permission** — the result of the permission algorithm for a
  given User on a given resource. See the ticket-0002 resolution for the
  precise rule; in short, the **maximum** (strongest) Permission level granted
  anywhere on the path from the Workspace root down to the resource, across
  direct + Group Shares, with Owner/Admin bypassing entirely.
- **Union (inheritance rule)** — Shares only ever *upgrade*; a Share on a
  child never downgrades a stronger Share on an ancestor. There is **no
  Deny** concept — to revoke access, delete the Share, remove the User from
  the Group, or lower their Role.

## Resources

- **Folder** — a container for Folders and Pages. Nestable (self-referential
  parent). Belongs to a Workspace. Can be Shared.
- **Page** — a single document; its body is a Yjs doc. Lives in a Folder
  and/or nested under a parent Page. Can be Shared. The unit of realtime
  editing.
- **Attachment** — a file uploaded against a Page (image or other), stored in
  S3-compatible storage; rendered as an inline block. Subject to the Page's
  effective permission via short-lived signed URLs.

## Out of v1 (noted for clarity, decided out of scope)

- **Public link / "anyone with the link"** — no anonymous access path in v1.
- **Deny / blocklist** — allowlist-only model.
- **Reshare / Full Access level** — only Owner/Admin create Shares.
- **Comments** — Commenter level reserved but inactive.
