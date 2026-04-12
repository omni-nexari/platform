# Nexari OmniHub — AI Developer Plan

> **Status:** Design  
> **Updated:** 2026-04-12  
> **Relates to:** `Docs/Plan/AI_PLATFORM_PLAN.md` · `Docs/Plan/AI_TRAINING_PLAN.md` · `Docs/Plan/PROJECT_PLAN.md`

---

## What Is the AI Developer?

The AI Developer is a supervised coding agent that lives inside the Nexari OmniHub platform. It understands the codebase, follows its conventions, and can write real, runnable feature code — delivered as a pull request that a human reviews before anything merges.

It is not a "generate code from scratch" AI. It is an agent that knows **this specific codebase** — the Fastify + Drizzle API patterns, the React portal structure, the Tizen player JS conventions — and writes new code that fits naturally into what already exists.

---

## Table of Contents

1. [What the AI Developer Can Build](#1-what-the-ai-developer-can-build)
2. [Codebase Knowledge — How It Learns the Platform](#2-codebase-knowledge--how-it-learns-the-platform)
3. [Agent Architecture](#3-agent-architecture)
4. [Toolset — What the Agent Can Do](#4-toolset--what-the-agent-can-do)
5. [Workflow — From Request to Pull Request](#5-workflow--from-request-to-pull-request)
6. [Code Conventions the Agent Must Follow](#6-code-conventions-the-agent-must-follow)
7. [Safety Model](#7-safety-model)
8. [Training the Code Agent](#8-training-the-code-agent)
9. [Integration with CI/CD](#9-integration-with-cicd)
10. [Access Model — Who Can Request Features](#10-access-model--who-can-request-features)
11. [What Needs to Be Built](#11-what-needs-to-be-built)
12. [Realistic Expectations](#12-realistic-expectations)

---

## 1. What the AI Developer Can Build

### ✅ Well within scope

| Feature type | Example |
|---|---|
| New React UI component in the portal | "Add a live device count badge to the workspace sidebar" |
| New page in the portal | "Create a dedicated Proof of Play report page with date range filter" |
| New Fastify API route + Drizzle query | "Add a GET /api/v1/content/expiring endpoint returning items expiring in 7 days" |
| New Drizzle table + migration | "Add a `device_notes` table so admins can attach notes to devices" |
| Extend an existing API route | "Add a `search` query param to GET /api/v1/devices" |
| New Tizen player JS module | "Add a QR code overlay widget to the Tizen player" |
| Scheduled background job | "Run a nightly job that marks content as expired if validUntil has passed" |
| Portal widget / dashboard card | "Add a 'Content Expiring Soon' card to the workspace dashboard" |
| DB schema extension | "Add a `displayName` field to the devices table" |
| Variant of existing feature | "Add a 'duplicate schedule' button next to each schedule in the list" |

### ❌ Out of scope (never autonomous)

| Feature type | Reason |
|---|---|
| Auth system changes | Single mistake = all users locked out or security breach |
| JWT / session logic | Same risk profile as above |
| Billing / payment code | Financial liability |
| Permission model changes | Could expose one tenant's data to another |
| Migrations that `DROP` columns or tables | Irreversible data loss |
| Changes to existing migrations | Migration history must be append-only |
| `main` branch direct commits | Policy — all changes via PR only |
| Production deployments | Only CI/CD deploys, triggered by approved merge |

---

## 2. Codebase Knowledge — How It Learns the Platform

The code agent needs deep knowledge of this specific codebase. It gets this from four sources, assembled into its context at request time.

### 2.1 Codebase Index (RAG — code-specific)

A separate RAG corpus (distinct from the CMS assistant's corpus) indexes:

| What is indexed | Why |
|---|---|
| All route files in `apps/api/src/routes/` | Agent learns the exact pattern for a Fastify route: authenticate, check workspace access, query with Drizzle, return typed response |
| All schema files in `packages/db/src/schema/` | Agent knows every table, column name, type, and relationship — never invents fields |
| All page files in `apps/ds/src/pages/` | Agent knows the React page structure, how pages are registered in `App.tsx`, how they use auth, workspace context |
| `apps/ds/src/components/` | Agent reuses existing UI primitives (buttons, modals, tables) rather than inventing new ones |
| `apps/ds/src/lib/` | Agent knows the API client conventions, auth store, workspace hooks |
| `apps/tizen/js/` and `apps/tizen-sbb/js/` | Agent knows the Tizen player module structure |

**Chunking strategy for code:** Index by function/export, not by line range. Each chunk = one exported function, route handler, React component, or schema table. This gives the agent precise, task-relevant context.

### 2.2 Convention Digest (Static Document — Maintained by You)

A plain-English document (`Docs/Plan/CODEBASE_CONVENTIONS.md` — to be written) that teaches the agent the patterns that are hard to infer from code alone:

```markdown
## API Route Conventions
- All routes require `{ onRequest: [app.authenticate] }`
- User extracted as: `const user = req.user as AuthUser`
- AuthUser shape: `{ sub: string; orgId: string; role: string }`
- Workspace access always checked with `checkWorkspaceAccess(workspaceId, user.sub)`
- Return 403 if workspace access denied: `reply.status(403).send({ error: 'Forbidden' })`
- Soft delete: set `deletedAt = now()`, always filter `isNull(deletedAt)` in queries
- All timestamps use `{ withTimezone: true }`
- Import DB entities from `@signage/db` (monorepo package alias)

## React Page Conventions
- Pages are lazy-loaded via React Router in App.tsx
- Workspace pages live in apps/ds/src/pages/workspace/
- Auth is checked via useAuthStore from lib/auth.ts
- API calls use buildApiUrl() from lib/api.ts with fetch + credentials: 'include'
- No direct API calls in components — use custom hooks in lib/

## DB Schema Conventions
- All PKs: uuid().primaryKey().defaultRandom()
- All FKs reference parent id with .references()
- Soft delete: deletedAt timestamp, nullable
- All tables have createdAt + updatedAt with defaultNow()
- Enums stored as text with comment listing valid values
```

### 2.3 Live Codebase Snapshot (Dynamic — per request)

Before starting work on a feature request, the agent fetches:

```
RELEVANT FILES FOR THIS REQUEST:
  apps/api/src/routes/devices.ts      (similar existing route to follow)
  packages/db/src/schema/devices.ts   (table being extended)
  packages/db/migrations/             (last migration file, to know next number)
  apps/ds/src/pages/workspace/DeviceDetailPage.tsx  (page that will use the new API)
```

The agent reads these files in full — not from an index, but live from the filesystem — so it works with the current state of the code when generating its changes.

### 2.4 Recent Change Context

The agent also reads:

```bash
git log --oneline -20    # recent commits — understand direction of work
git diff main            # if working on a branch — see what's already changed
```

---

## 3. Agent Architecture

```
User submits feature request (text)
  │
  ▼
┌─────────────────────────────────────────────────────┐
│  AI Developer Agent (LangGraph stateful workflow)    │
│                                                     │
│  State machine:                                     │
│  CLARIFY → PLAN → RESEARCH → WRITE → TEST → PR     │
│                                                     │
│  LLM: Qwen2.5-Coder 32B (fine-tuned adapter)        │
│  Tools: see §4                                      │
│  Memory: session state + codebase RAG               │
└─────────────────────────────────────────────────────┘
  │
  ▼
Git branch → files written → tests run → PR opened
  │
  ▼
Human reviews PR in GitHub
  │
  ▼
CI pipeline (tests, lint, build) → merge if approved
  │
  ▼
Deploy
```

### 3.1 State Machine Stages

| Stage | What happens | AI waits for human? |
|---|---|---|
| **CLARIFY** | Agent asks 1–3 clarifying questions if the request is ambiguous | Yes — waits for answers |
| **PLAN** | Agent produces a written spec: files to create/edit, DB changes, API changes, UI changes | Yes — human approves plan before code |
| **RESEARCH** | Agent reads all relevant existing files | No — automated |
| **WRITE** | Agent writes all the code | No — automated |
| **TEST** | Agent runs `pnpm test` and `pnpm typecheck` in the affected package | No — automated |
| **PR** | Agent commits to a branch and opens a GitHub PR with summary | No — automated |
| *(Review)* | Human reviews PR, requests changes or approves | Yes — agent is idle |
| *(Revision)* | If changes requested, agent reads comments and revises | No — automated once triggered |

---

## 4. Toolset — What the Agent Can Do

These are the tools the LangGraph agent can invoke. Each tool is a TypeScript function in the AI orchestration layer.

### 4.1 Filesystem Tools

| Tool | Action | Restriction |
|---|---|---|
| `read_file(path)` | Read any file in the workspace | No restriction |
| `list_dir(path)` | List directory contents | No restriction |
| `write_file(path, content)` | Write a file on a git branch | **Branch only — never on `main`** |
| `create_file(path, content)` | Create a new file on a git branch | Branch only |
| `delete_file(path)` | Delete a file on a git branch | Branch only; never migrations |

### 4.2 Git Tools

| Tool | Action | Restriction |
|---|---|---|
| `git_create_branch(name)` | Create a feature branch from latest `main` | Always prefixed `ai-dev/` |
| `git_commit(message)` | Commit staged changes on current branch | Conventional commit format required |
| `git_push()` | Push branch to remote | Only `ai-dev/*` branches |
| `git_open_pr(title, body)` | Open GitHub pull request | Requires test pass first |

### 4.3 Code Execution Tools

| Tool | Action | Restriction |
|---|---|---|
| `run_typecheck(package)` | `pnpm --filter {package} typecheck` | Read stdout/stderr |
| `run_tests(package)` | `pnpm --filter {package} test` | Read stdout/stderr |
| `run_lint(package)` | `pnpm --filter {package} lint` | Read stdout/stderr |
| `generate_migration()` | `pnpm --filter @signage/db drizzle-kit generate` | Only when schema file was changed |

### 4.4 Search Tools

| Tool | Action |
|---|---|
| `search_codebase(query)` | Vector search the code RAG index — find similar existing patterns |
| `grep_code(pattern, path)` | Exact text search in files — find all usages of a symbol |
| `find_schema_table(name)` | Look up a specific Drizzle table definition |

### 4.5 Platform Tools (read-only during development)

| Tool | Action |
|---|---|
| `get_db_schema_summary()` | Returns all table names + column names as plain text |
| `get_api_routes_summary()` | Returns all registered routes as plain text |
| `get_existing_components()` | Returns all exported component names from `apps/ds/src/components/` |

---

## 5. Workflow — From Request to Pull Request

### 5.1 Example: "Add a device notes feature"

```
REQUEST: "I want to be able to attach notes to individual devices — like a text memo 
          visible only to workspace admins"

── CLARIFY stage ────────────────────────────────────────────────────
Agent: "A few quick questions:
  1. Should notes be visible to Workspace Editors too, or Admin+ only?
  2. Should there be a history of past notes, or just the current note?
  3. Should the note appear on the device list or only on the device detail page?"

User: "Admin and above. Just the current note. Device detail page only."

── PLAN stage ───────────────────────────────────────────────────────
Agent proposes:

  DB CHANGES:
    • Add column `notes text` to `devices` table in packages/db/src/schema/devices.ts
    • Generate migration: 0031_device_notes.sql

  API CHANGES:
    • PATCH /api/v1/devices/:id — extend to accept { notes: string }
      (already exists — just add the field to the update handler)

  UI CHANGES:
    • Add "Notes" section to DeviceDetailPage.tsx
      - Textarea pre-filled with current note
      - "Save Note" button (calls PATCH /devices/:id)
      - Only visible to role >= workspace_admin

  TESTS:
    • Unit test: PATCH /devices/:id with notes field saves correctly
    • Unit test: Workspace Editor cannot update notes (403)

[Human approves plan]

── RESEARCH stage ───────────────────────────────────────────────────
Agent reads:
  packages/db/src/schema/devices.ts        ← exact schema to extend
  packages/db/migrations/ (last file)      ← migration numbering
  apps/api/src/routes/devices.ts           ← PATCH route to extend
  apps/ds/src/pages/workspace/DeviceDetailPage.tsx  ← page to add UI to
  apps/ds/src/components/                  ← existing UI components to reuse

── WRITE stage ──────────────────────────────────────────────────────
Agent writes:
  [1] packages/db/src/schema/devices.ts   (adds `notes` column)
  [2] packages/db/migrations/0031_device_notes.sql
  [3] apps/api/src/routes/devices.ts      (extends PATCH handler)
  [4] apps/ds/src/pages/workspace/DeviceDetailPage.tsx  (adds Notes section)
  [5] apps/api/src/routes/devices.test.ts (new test cases)

── TEST stage ───────────────────────────────────────────────────────
  pnpm --filter @signage/db typecheck  → ✅ pass
  pnpm --filter @signage/api typecheck → ✅ pass
  pnpm --filter @signage/api test      → ✅ 2 new tests pass
  pnpm --filter @signage/ds typecheck  → ✅ pass

── PR stage ─────────────────────────────────────────────────────────
Branch: ai-dev/device-notes
PR title: "feat(devices): add notes field to device detail"
PR body:
  ## What
  Adds a text notes field to devices. Visible and editable by Workspace Admin+.
  
  ## Changes
  - DB: new `notes` column on `devices` table (migration 0031)
  - API: PATCH /devices/:id now accepts `notes`
  - UI: Notes textarea in DeviceDetailPage (role-gated)
  
  ## Tests
  - 2 new test cases in devices.test.ts
  - All existing tests pass
  
  ## Review checklist
  - [ ] Migration looks correct
  - [ ] Role check is in the right place
  - [ ] UI placement makes sense
```

---

## 6. Code Conventions the Agent Must Follow

These are injected as hard rules in the agent's system prompt. The agent must follow them exactly — deviating from conventions requires explicit human override.

### 6.1 API Layer

```typescript
// ✅ Correct pattern for a new route handler
app.patch('/:id', { onRequest: [app.authenticate] }, async (req, reply) => {
  const user = req.user as AuthUser;
  const { id } = req.params as { id: string };
  const body = req.body as { notes?: string };

  // 1. Fetch entity
  const device = await db.query.devices.findFirst({
    where: and(eq(devices.id, id), isNull(devices.deletedAt)),
  });
  if (!device) return reply.status(404).send({ error: 'Not found' });

  // 2. Check workspace access
  const member = await checkWorkspaceAccess(device.workspaceId, user.sub);
  if (!member) return reply.status(403).send({ error: 'Forbidden' });

  // 3. Role check if needed
  if (!['workspace_admin', 'org_admin', 'org_owner'].includes(member.role)) {
    return reply.status(403).send({ error: 'Insufficient permissions' });
  }

  // 4. Update
  const [updated] = await db.update(devices)
    .set({ notes: body.notes, updatedAt: new Date() })
    .where(eq(devices.id, id))
    .returning();

  return reply.send(updated);
});
```

### 6.2 DB Schema

```typescript
// ✅ New column — append at end of table definition, before soft delete fields
export const devices = pgTable('devices', {
  // ... existing fields ...
  notes: text('notes'),              // ← new field added here
  // soft delete always last
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
```

### 6.3 React Pages

```typescript
// ✅ API calls use buildApiUrl + fetch with credentials
const res = await fetch(buildApiUrl(`/devices/${deviceId}`), {
  method: 'PATCH',
  credentials: 'include',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ notes }),
});
if (!res.ok) throw new Error('Failed to save note');

// ✅ Role check in UI — use member.role from workspace context
{(member.role === 'workspace_admin' || member.role === 'org_admin' || member.role === 'org_owner') && (
  <NotesSection deviceId={device.id} initialNotes={device.notes} />
)}
```

### 6.4 Imports

```typescript
// ✅ DB imports always from monorepo package alias
import { db, devices, workspaceMembers } from '@signage/db';
import { eq, and, isNull } from 'drizzle-orm';

// ❌ Never import from relative paths across packages
import { db } from '../../../packages/db/src/index.js';
```

### 6.5 Migration Files

```sql
-- ✅ Additive only — no DROP, no ALTER COLUMN (changing type)
-- File: migrations/0031_device_notes.sql
ALTER TABLE devices ADD COLUMN IF NOT EXISTS notes text;
```

---

## 7. Safety Model

### 7.1 Hard Rules (cannot be overridden by any user request)

1. **Never write to `main` directly** — all changes on `ai-dev/*` branch
2. **Never modify existing migration files** — append-only
3. **Never write `DROP TABLE`, `DROP COLUMN`, `TRUNCATE`** in any migration
4. **Never modify auth, JWT, or session files**
5. **Never modify permission-checking logic** (the `checkWorkspaceAccess` function and equivalent)
6. **Must pass typecheck and tests before opening PR** — agent cannot open a PR with failing checks
7. **Plan must be approved before WRITE stage** — agent never writes code without a human signing off on the plan

### 7.2 GitHub Branch Protection Requirements

Configure on the GitHub repo before enabling the agent:

```
Branch: main
Settings:
  ✅ Require pull request reviews before merging (minimum 1)
  ✅ Require status checks to pass: typecheck, test, lint
  ✅ Require branches to be up to date before merging
  ✅ Restrict who can push to matching branches  (block ai-dev/* from pushing to main directly)
  ✅ Do not allow bypassing the above settings
```

Without this, the safety model is advisory only rather than enforced.

### 7.3 What Happens If Tests Fail

```
TEST stage fails
  │
  ├─ Agent reads the error output
  ├─ Attempts to fix (max 3 attempts)
  │
  ├─ Fix succeeds → continue to PR stage
  │
  └─ Fix fails after 3 attempts →
        Agent stops, posts failure report to requester:
        "I could not get the tests to pass. Here is what I tried and the remaining error.
         Please review and either clarify the requirements or resolve manually."
        Branch remains open for human inspection
```

---

## 8. Training the Code Agent

The code agent uses a **separate fine-tuned LoRA adapter** from the CMS assistant. It is trained specifically for code generation in this codebase.

### 8.1 Training Data for the Code Agent

**Source 1: Existing codebase as input/output pairs**

Take every existing route, page, and schema addition as an implicit training example:
```
Input:  "Add a GET route that lists all playlists for a workspace, filtered by search, with assigned tags"
Output: [the actual apps/api/src/routes/playlists.ts GET handler]
```

Write 100–200 such reconstructions. The agent learns: given a feature description in English, produce code matching the exact conventions of this codebase.

**Source 2: PR descriptions as natural language spec**

If the team writes good PR descriptions, each PR becomes a training pair:
```
Input (PR title + body): "feat(devices): add grouping by location"
Output (diff): [the actual code changes in the PR]
```

Set up a script that extracts merged PRs from GitHub and converts them to training pairs automatically.

**Source 3: Synthetic pairs from the large model**

Use Qwen2.5 72B to generate additional feature descriptions + correct implementations, given the codebase conventions as context. Manually review before adding to the training set.

### 8.2 Evaluation for Code Quality

The code agent's eval suite tests different things than the assistant:

| Test | Method |
|---|---|
| Follows auth pattern | Generated route always has `app.authenticate` and `checkWorkspaceAccess` |
| Uses correct imports | Generated code imports from `@signage/db`, not relative paths |
| Migration is additive | Generated migration never contains `DROP` or destructive `ALTER` |
| TypeScript compiles | Run `tsc --noEmit` on generated output |
| Tests pass | Generated test cases run green |
| No invented field names | All field names used in generated code exist in the schema |

---

## 9. Integration with CI/CD

The AI Developer plugs into the existing CI pipeline with no changes needed to the pipeline itself. It just opens PRs like a human would.

```
ai-dev/feature-branch pushed
  │
  ├─ GitHub Actions triggers on pull_request:
  │     ✅ pnpm typecheck (all packages)
  │     ✅ pnpm test (all packages)
  │     ✅ pnpm lint (all packages)
  │     ✅ pnpm build (dry run)
  │
  ├─ All checks must pass before PR can be merged (branch protection)
  │
  ├─ Human reviewer:
  │     - Reviews code changes
  │     - Reviews migration (if any)
  │     - Checks role logic is correct
  │     - Approves or requests revision
  │
  └─ Merge to main → existing deploy pipeline fires
```

### 9.1 PR Template for AI-Generated PRs

AI-opened PRs automatically use a structured template that helps human reviewers focus on the right things:

```markdown
## AI Developer — Feature Request #{{id}}

**Requested by:** {{username}} ({{role}})
**Request:** {{original_request_text}}

## What Changed
{{agent_generated_summary}}

## Files Modified
{{file_list_with_brief_description}}

## DB Migration
{{migration_filename}} — {{migration_description}}
- [ ] Migration is additive only (no DROP/destructive ALTER)
- [ ] Migration is idempotent (uses IF NOT EXISTS / IF EXISTS)

## Human Review Checklist
- [ ] Auth and workspace access checks are correct
- [ ] Role permissions are applied at the right level
- [ ] No cross-tenant data access possible
- [ ] Error responses use correct HTTP status codes
- [ ] UI change is appropriate for the role that sees it
- [ ] Tests cover the happy path and at least one error case
```

---

## 10. Access Model — Who Can Request Features

| Role | Can request features? | Scope | Review required? |
|---|---|---|---|
| Platform Owner | ✅ Yes | Platform-wide features | Human PR review |
| Management Company Admin | ✅ Yes | Features for their client orgs | Human PR review |
| Org Owner / Admin | 🔶 Limited | UI/UX requests only — no API or DB changes | Management admin approves request first |
| Workspace roles | ❌ No | Not exposed | — |

Feature requests are submitted through the `management/ManagementAIPage.tsx` or `superadmin/PlatformAIPage.tsx` portal pages (to be built). Each request has a status: `pending_plan` → `plan_approved` → `coding` → `pr_open` → `merged` / `rejected`.

Management Company Admins can request features for their clients, review the plan, and track the PR status — all from within the portal.

---

## 11. What Needs to Be Built

| Priority | Component | Effort | Notes |
|---|---|---|---|
| P1 | Code RAG indexer (index routes, schema, components) | 2 days | Separate from CMS assistant RAG |
| P1 | Convention digest document (`CODEBASE_CONVENTIONS.md`) | 1 day | Write manually — high leverage |
| P1 | LangGraph agent skeleton (state machine + tool definitions) | 3 days | CLARIFY → PLAN → RESEARCH → WRITE → TEST → PR |
| P2 | Filesystem tools (read/write scoped to branch) | 2 days | Must enforce branch-only writes |
| P2 | Git tools (branch, commit, push, PR via GitHub API) | 2 days | Use `@octokit/rest` |
| P2 | Code execution tools (typecheck, test, lint, migration gen) | 1 day | Shell exec in isolated Docker container |
| P2 | Feature request DB table + API route | 1 day | Track request status |
| P3 | Management AI page (submit request, track status) | 2 days | Portal UI |
| P3 | Fine-tune code agent on platform conventions | 3 days | After seed training data is written |
| P3 | PR template + GitHub branch protection config | 0.5 day | Enforce safety model |
| P4 | Revision loop (agent reads PR review comments + revises) | 3 days | LangGraph revision node |

---

## 12. Realistic Expectations

| Expectation | Reality |
|---|---|
| "AI writes perfect code first time" | ~70–80% of well-scoped features will compile and pass tests on first attempt after fine-tuning. The other 20–30% need one revision pass. Complex features need more rounds. |
| "AI can build any feature" | Well-scoped, self-contained additions work well. Anything touching global state, auth, or cross-package architecture needs human collaboration. |
| "No developer needed once AI Developer is running" | Wrong. You need someone to review PRs, write the convention digest, maintain the training data, and design architecture. The AI is the speed multiplier, not the replacement. |
| "Clients can request any feature directly" | Org-level clients get a "feature request" form, but a Management Admin reviews it before the agent even starts. This prevents frivolous or conflicting requests. |
| "Training data is a one-time effort" | The codebase evolves, conventions change. Re-index code RAG on every significant merge. Re-fine-tune every 3–6 months or after major refactors. |

---

## Quick Start Order

1. Write `Docs/Plan/CODEBASE_CONVENTIONS.md` (the convention digest — §2.2)
2. Build the code RAG indexer and index the current codebase
3. Write 100 seed training pairs from existing routes + pages
4. Build the LangGraph agent with CLARIFY → PLAN → PR stages (skip automated WRITE at first — human writes code based on agent's plan)
5. Fine-tune on seed data, run eval
6. Enable automated WRITE stage once quality threshold is met

---

*End of document. First action: write `CODEBASE_CONVENTIONS.md` — this single document is the foundation everything else builds on.*
