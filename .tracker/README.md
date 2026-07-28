# OpenNote — wayfinder tracker (local-markdown)

This repo uses a **local-markdown issue tracker** (one file per issue in `.tracker/issues/`).
The canonical artifact is **[0001 — the map](./issues/0001.md)**.

## Index

| ID | Title | Type | Status | Blocked by |
|----|-------|------|--------|------------|
| [0001](./issues/0001.md) | **MAP** — OpenNote v1 build-ready spec | `wayfinder:map` | open | — |
| [0002](./issues/0002.md) | Permission & sharing model: inheritance, roles, groups, overrides | `grilling` | **closed** | — |
| [0003](./issues/0003.md) | Data model: relational schema for workspaces, groups, folders, pages, attachments, RBAC | `grilling` | **closed** | — |
| [0004](./issues/0004.md) | Real-time layer: Hocuspocus + Yjs persistence, auth hooks, update strategy | `research` | **closed** | — |
| [0005](./issues/0005.md) | Block editor scope: v1 block types, nested-page blocks, slash menu | `grilling` | **closed** | — |
| [0006](./issues/0006.md) | Auth: library choice (Lucia vs Auth.js), identity scope, workspace onboarding | `grilling` | **closed** | — |
| [0007](./issues/0007.md) | Attachments: storage provider, quotas, access control, upload flow | `grilling` | **closed** | — |
| [0008](./issues/0008.md) | Search: Postgres FTS mechanics, freshness, cmd+K scope | `grilling` | **closed** | — |
| [0009](./issues/0009.md) | Monorepo & project structure: packages, apps, tooling, env config | `grilling` | open | — |
| [0010](./issues/0010.md) | Realtime authorization: gating Hocuspocus connections & doc loads | `grilling` | open | — *(unblocked)* |

## Frontier (open, unblocked, unclaimed)

- **0009** Monorepo & project structure
- **0010** Realtime authorization

> All remaining tickets are unblocked — **no blockers left on the map.**

## Conventions

- **Claim** a ticket by adding yourself under `Assignee:` *before* any work.
- **Resolve** by posting a resolution comment in the issue file, closing it (`Status: closed`), and appending a one-line gist + link to the map's **Decisions so far**.
- **Blocking** uses each ticket's `Blocking:` line; a ticket is unblocked when every blocker there is closed.
- One ticket per session (research tickets excepted).
