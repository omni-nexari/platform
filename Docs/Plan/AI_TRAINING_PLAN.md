# Nexari OmniHub — AI Training & Knowledge Plan

> **Status:** Design  
> **Updated:** 2026-04-12  
> **Relates to:** `Docs/Plan/AI_PLATFORM_PLAN.md` · `Docs/Plan/PROJECT_PLAN.md`

---

## Goal

Build an AI that deeply understands the Nexari OmniHub platform — its terminology, data model, user workflows, and business context — so it behaves like an expert who has worked with the system for years, not a generic chatbot that happens to have access to an API.

---

## Table of Contents

1. [Two Strategies: RAG vs Fine-Tuning](#1-two-strategies-rag-vs-fine-tuning)
2. [RAG Knowledge Base — What to Index](#2-rag-knowledge-base--what-to-index)
3. [System Prompt Architecture](#3-system-prompt-architecture)
4. [Fine-Tuning Strategy](#4-fine-tuning-strategy)
5. [Training Data — What to Collect](#5-training-data--what-to-collect)
6. [Feedback Loop & Continuous Improvement](#6-feedback-loop--continuous-improvement)
7. [Domain Vocabulary & Terminology Guide](#7-domain-vocabulary--terminology-guide)
8. [Evaluation — How to Measure AI Quality](#8-evaluation--how-to-measure-ai-quality)
9. [Data Pipelines](#9-data-pipelines)
10. [What Not to Do](#10-what-not-to-do)
11. [Phased Training Rollout](#11-phased-training-rollout)

---

## 1. Two Strategies: RAG vs Fine-Tuning

These are complementary, not competing. Use both.

| Strategy | What it does | When to use |
|---|---|---|
| **RAG** (Retrieval-Augmented Generation) | Injects relevant facts from a knowledge base into every prompt at query time | Platform docs, schema definitions, help articles, user workflows — anything that can be looked up |
| **Fine-tuning** | Adjusts the model's weights on labeled examples of good CMS-specific behavior | Teaching tone, decision-making patterns, platform conventions that are hard to express as documents |
| **System prompt** | Hard-coded context + rules given to the model on every call | Identity, role permissions, what the AI can/cannot do, current org context |

### Rule of Thumb

> **RAG first.** If good retrieval + a well-crafted system prompt solves the problem, do not fine-tune. Fine-tuning is expensive (time) and must be repeated when the platform changes.  
> **Fine-tune only for behavior**, not for facts. Facts belong in RAG.

---

## 2. RAG Knowledge Base — What to Index

The RAG corpus is a collection of documents stored as vector embeddings in `pgvector`. Every AI query retrieves the most relevant chunks before generating a response.

### 2.1 Platform Documentation (Static — seed once, update on change)

| Document | What it teaches the AI |
|---|---|
| `Docs/Plan/PROJECT_PLAN.md` | Full platform model: roles, orgs, workspaces, devices, content, playlists, schedules |
| DB schema (all tables in `packages/db/src/schema/`) | Exact field names, types, relationships — prevents hallucinated field names |
| API route documentation (generated from `apps/api/src/routes/`) | What endpoints exist, what they accept, what they return |
| `Docs/HEARTBEAT_TELEMETRY.md` | Device heartbeat shape, offline detection logic |
| `Docs/SYNCPLAY.md`, `Docs/ZONE_SYNCPLAY.md` | Multi-zone sync concepts |
| `Docs/Tizen/TIZEN_BUILD_DEPLOY.md` | Tizen app lifecycle, update mechanism, WGT structure |

### 2.2 Schema as Natural Language (Auto-generated)

The DB schema should be converted to human-readable descriptions and indexed. Example:

**Raw schema:**
```ts
contentItems: { type: text, duration: integer, validFrom: timestamp, approvalState: text }
```

**Natural language chunk indexed into RAG:**
```
A content item has a "type" which can be: image, video, html5, pdf, presentation, or web_url.
The "duration" field is in seconds; a duration of 0 means manual advance.
"validFrom" and "validUntil" control when the item is eligible to play — content outside
its validity window is automatically skipped by the scheduler.
"approvalState" can be: draft, pending_review, approved, or rejected. Only "approved"
content plays on devices. The approval workflow is optional and enabled per workspace.
```

This is how the AI learns to talk about the data model correctly without hallucinating.

### 2.3 Help Articles (Write once — high ROI)

Write 30–50 short help articles covering the most common client tasks. These become both the RAG corpus for the AI assistant AND the help center documentation for clients.

Suggested articles:

**Devices & Screens**
- How to pair a new Samsung TV
- What to do when a screen shows offline
- How screen power scheduling works (on/off timers)
- Understanding device heartbeat and status indicators

**Content**
- Supported content types and when to use each
- How content validity dates work
- What "approval required" means and how to approve content
- How to organize content with folders and tags
- How to upload a PDF or presentation

**Playlists & Scheduling**
- How to create a playlist and add content
- How to schedule a playlist to a screen
- How priority scheduling works (what overrides what)
- How to set up a recurring weekly schedule
- How to create a date-specific override (e.g. Christmas menu)

**Workspaces & Users**
- What a workspace is and when to create a new one
- User roles explained (Viewer, Editor, Admin, Owner)
- How to invite a team member
- How to restrict what a user can see or edit

**Canvas & Zones**
- What a zone is and how multi-zone layouts work
- How to create a full-screen vs split-screen layout
- How zone sync works for synchronized content

### 2.4 Org-Specific Context (Dynamic — injected per request)

This is the live data retrieved for the specific org making a request. It is injected into the system prompt at query time, not stored in the RAG corpus.

```
Org: "Bella Vista Restaurant" (orgId: abc-123)
Workspaces: ["Dining Room (4 devices)", "Bar Area (2 devices)", "Kitchen (1 device)"]
Recent content: ["Lunch Specials Board", "Happy Hour Promo", "Weekend Events Slide"]
Active playlists: ["Main Loop", "Happy Hour (Fri-Sun 3-7pm)", "Closed Screen"]
Device status: 6 online, 1 offline (Kitchen screen - since 2h ago)
Player skin: primaryColor=#ff6b35 secondaryColor=#2c3e50 fontFamily=Montserrat
User role: Workspace Admin (Dining Room)
Current page: /workspace/dining-room/content
```

The AI uses this to give specific, personalized answers rather than generic instructions.

### 2.5 Past Incidents & Resolutions (Self-healing memory)

Every time the self-healing AI resolves an issue, the incident and resolution are stored as a vector embedding:

```
Incident: "Device offline after firmware update — model QM75B"
Resolution: "Player app cache cleared via remote restart command. Root cause: Tizen OS 
update cleared app storage permissions. Fix: re-apply storage permission grant on next boot."
Tags: [device-offline, firmware-update, tizen, samsung-qm75b]
```

When a similar incident occurs, the AI retrieves this and applies the known fix first before escalating.

### 2.6 Content Best Practices (Signage Domain Knowledge)

Index domain knowledge that makes the AI a good signage advisor, not just a CMS operator:

- Optimal text-to-empty-space ratio for readability at distance
- Safe zones for Samsung displays (avoid 10% edge for critical info)
- Recommended slide durations by content type (image: 8–12s, video: full length, info boards: 15–20s)
- Color contrast rules for readability (WCAG AA minimum)
- Menu board layout conventions (hero image, name, description, price hierarchy)
- When to use image vs video vs HTML5 zones
- Common restaurant signage patterns (daily specials, happy hour, events, social proof)

---

## 3. System Prompt Architecture

Every AI call is assembled from three layers. The final prompt is constructed server-side before calling Ollama — clients never see or influence this construction.

### 3.1 Layer 1 — Base Identity (static, same for every call)

```
You are the Nexari OmniHub AI assistant — an expert in digital signage management 
built into the Nexari OmniHub CMS platform.

You help clients manage their Samsung commercial displays: creating and scheduling 
content, troubleshooting devices, and getting the most out of their signage.

Platform roles you must understand:
- Platform Owner (superadmin): manages all management companies
- Management Company Admin: manages their client organizations
- Org Owner / Admin: manages their organization's workspaces, devices, content
- Workspace Admin / Editor / Viewer: scoped to a specific workspace

Rules:
1. Only act on the org and workspaces the current user has access to.
2. Never reveal data from other organizations.
3. For destructive actions (delete, remove), always ask for explicit confirmation.
4. For billing and account ownership changes, redirect to the Org Owner.
5. Always show a preview before publishing content.
6. Log every action you take in the audit trail.
7. When unsure, ask one clarifying question rather than guessing.
```

### 3.2 Layer 2 — Org + User Context (dynamic, per request)

```
CURRENT USER
  Name: {userName}
  Role: {userRole} in workspace "{workspaceName}"
  Org: {orgName} (id: {orgId})

WORKSPACES IN THIS ORG
{workspaceList with device counts}

CURRENT WORKSPACE SNAPSHOT
  Devices: {deviceCount} ({onlineCount} online, {offlineCount} offline)
  Content items: {contentCount} ({approvedCount} approved, {pendingCount} pending review)
  Active playlists: {playlistNames}
  Upcoming schedules: {next3Schedules}

PLAYER SKIN
  Primary: {primaryColor}, Secondary: {secondaryColor}, Font: {fontFamily}

CURRENT PAGE
  {currentRoute} — {pageDescription}
```

### 3.3 Layer 3 — Retrieved Context (RAG, per query)

The top 5–8 most relevant chunks from the knowledge base, prepended:

```
RELEVANT PLATFORM KNOWLEDGE
[chunk 1: help article on device pairing]
[chunk 2: schema definition for schedules]
[chunk 3: past incident matching current symptoms]
...
```

### 3.4 Prompt Assembly Flow

```
User message received
  │
  ├─ Extract orgId + userId from JWT
  ├─ Fetch live org snapshot from DB (Layer 2)
  ├─ Embed user message → vector search RAG corpus (Layer 3)
  ├─ Assemble: Layer 1 + Layer 2 + Layer 3 + user message
  └─ Send to Ollama → stream response back to client
```

---

## 4. Fine-Tuning Strategy

Fine-tune only after the RAG + system prompt approach is running. Fine-tuning teaches the model **how to behave**, not what to know.

### 4.1 What to Fine-Tune For

| Behavior | Why it needs fine-tuning (not just RAG) |
|---|---|
| **Tone and conciseness** | The AI should sound like a helpful platform expert, not a verbose chatbot. Tone is hard to describe; it's better shown through examples. |
| **Platform action decisions** | When a user says "fix my schedule" — should the AI ask clarifying questions, propose a plan, or act immediately? The right pattern needs to be learned from examples. |
| **Signage content quality judgment** | Knowing when a menu board layout is "good enough" vs needs revision. This requires domain-specific taste. |
| **Graceful refusals** | When the AI should redirect vs act. "Delete all my content" should always ask; "clear my draft items" is probably safe. |
| **Structured output reliability** | The AI must reliably output JSON for tool calls (create schedule, update content, etc.). Fine-tuning on these patterns dramatically improves reliability. |

### 4.2 Base Model for Fine-Tuning

Start with `Qwen2.5-Coder 32B` for actions that involve working with the platform API (JSON output, tool use), and `Qwen2.5 72B` (or a 7B distilled version) for conversational assistant interactions.

Fine-tune on a **quantized base** using LoRA (Low-Rank Adaptation) — this requires only a fraction of VRAM compared to full fine-tuning and produces a small adapter file (~200 MB) rather than a full model copy.

### 4.3 Fine-Tuning Setup (on your hardware)

```bash
# Install Unsloth (fastest LoRA fine-tuning library, ROCm-compatible)
pip install unsloth[colab-new] xformers

# Training hardware usage:
# Qwen2.5 7B LoRA: ~8 GB VRAM — runs easily alongside other services
# Qwen2.5 32B LoRA 4-bit: ~20 GB VRAM — schedule during off-peak hours
# Qwen2.5 72B LoRA 4-bit: not recommended on a single 32GB GPU — use 32B instead
```

---

## 5. Training Data — What to Collect

Training data = labeled examples of ideal AI behavior. Collected from three sources.

### 5.1 Manually Written Examples (Seed Dataset — Start Here)

Write 200–500 high-quality conversation examples covering the most common user intents. Each example is a `(system_prompt, user_message, ideal_response)` triple.

**Format:**
```jsonc
{
  "messages": [
    { "role": "system", "content": "...base identity + org context..." },
    { "role": "user", "content": "How do I schedule my lunch menu to play only on weekdays?" },
    { "role": "assistant", "content": "I'll create a recurring weekday schedule for your lunch menu. Which playlist contains the lunch menu content — is it 'Main Loop' or a separate one? And what time should it start and end?" }
  ]
}
```

**Intent categories to cover (write 10–20 examples each):**

| Category | Example intents |
|---|---|
| Device management | Pair device, rename device, assign to workspace, troubleshoot offline |
| Content upload | Upload image/video, set duration, set validity dates, add to folder |
| Playlist management | Create playlist, add content, reorder, set transition |
| Schedule creation | Recurring weekly, date-specific override, time-of-day, device group |
| User management | Invite user, change role, remove user |
| Content generation (AI Studio) | Create menu board, promo slide, translate content |
| Analytics questions | View play count, device uptime, most-played content |
| Troubleshooting | Screen offline, content not playing, schedule not triggering |
| Refusals | Delete all content (confirm), change billing (redirect), access other orgs (deny) |
| Onboarding | First-time setup steps, workspace creation, first content item |

### 5.2 Collected from Real Usage (Ongoing)

Once the assistant is live, collect:

| Signal | How to collect | What it trains |
|---|---|---|
| **Thumbs up** on a response | User clicks 👍 | This response was correct and helpful — positive example |
| **Thumbs down** on a response | User clicks 👎 + optional note | This response was wrong or unhelpful — negative example |
| **Edited AI output** | User modifies AI-generated content before saving | The user's version is better — use as correction label |
| **AI action accepted** | User confirms AI's proposed action | Implicit positive — AI correctly understood intent |
| **AI action cancelled** | User cancels or overrides AI action | Implicit negative — AI misunderstood or overstepped |
| **Follow-up clarification** | User immediately asks a correcting question | AI's previous response was incomplete or wrong |

Store all collected signals in the `ai_conversations` table with `feedback` column. Run monthly batch exports to update the fine-tuning dataset.

### 5.3 Synthetic Data Generation

Use the existing large model (Qwen2.5 72B) to **generate training data for the smaller model**. Prompt the big model:

```
You are creating training data for a CMS assistant AI.
Generate 20 realistic conversation examples where a restaurant client asks about 
scheduling content on their digital signage, and the assistant responds correctly using 
the Nexari OmniHub platform conventions.

Platform context:
- Schedules have: name, startDate, endDate, recurrence (daily/weekly/monthly/once), 
  startTime, endTime, priority (1-10), targetPlaylistId, targetDeviceIds
- Recurrence WEEKLY has a "daysOfWeek" field (array of 0-6, 0=Sunday)
- Higher priority schedules override lower ones for the same device + time slot
...
```

This gives you hundreds of additional examples without manual writing.

---

## 6. Feedback Loop & Continuous Improvement

### 6.1 Feedback Collection UI

Every AI response in the portal includes:

```
[AI response text]

Was this helpful?  👍  👎  [Report issue]
                              ↓
                    Optional: "What went wrong?"
                    [ ] Wrong information
                    [ ] Misunderstood my request  
                    [ ] Action was incorrect
                    [ ] Too long / too short
                    [ ] Other: ___________
```

### 6.2 Monthly Improvement Cycle

```
Month N + 1 workflow:
  1. Export all responses with thumbs-down from the past month
  2. Human reviews each — mark what the correct response should have been
  3. Add corrected pairs to the fine-tuning dataset
  4. Run LoRA fine-tune with cumulative dataset (previous + new corrections)
  5. A/B test new adapter on 10% of traffic
  6. If quality improves → promote to 100%; retire old adapter
  7. If quality regresses → rollback, investigate
```

### 6.3 Automatic RAG Corpus Updates

When platform documentation or schema changes:

```
Code is merged to main
  │
  ├─ CI webhook fires
  ├─ AI service re-indexes changed documents
  ├─ Embeddings updated in pgvector
  └─ No manual intervention needed
```

This means the AI always knows about new features, schema changes, and updated help articles within minutes of a deploy.

### 6.4 Incident Learning (Self-healing AI)

Every self-heal event automatically expands the knowledge base:

```
New incident occurs
  │
  ├─ AI searches past incidents → no match found
  ├─ AI diagnoses and resolves (or escalates)
  ├─ Resolution confirmed (by superadmin or by monitoring)
  └─ Incident + resolution stored as new RAG chunk with tags
       → Next time this happens: AI finds the match and resolves in seconds
```

---

## 7. Domain Vocabulary & Terminology Guide

The AI must use the same terminology as the platform — wrong names cause confusion and erode trust. This vocabulary guide is indexed in RAG AND used in the system prompt.

### 7.1 Core Entities

| Platform term | Meaning | Common user term to recognize |
|---|---|---|
| **Organization** (org) | A client company/restaurant — top-level tenant | "account", "company", "my restaurant" |
| **Workspace** | A logical group within an org (e.g. "Front Window", "Bar Area") | "location", "zone", "group", "screen group" |
| **Device** | A Samsung commercial display registered to a workspace | "screen", "TV", "monitor", "display" |
| **Content Item** | A single uploadable/generatable asset (image, video, HTML5, PDF, URL) | "slide", "media", "file", "image", "clip" |
| **Playlist** | An ordered list of content items that play in sequence | "slideshow", "loop", "rotation", "program" |
| **Schedule** | A time rule that assigns a playlist to device(s) | "timer", "program", "show time", "when to play" |
| **Canvas** | A multi-zone layout builder (like a page designer for screens) | "layout", "template", "screen design" |
| **Zone** | A region within a canvas layout | "section", "panel", "area", "box" |
| **Player Skin** | The org's branding (colors, logo, font) applied to the player UI | "theme", "brand", "colors", "look and feel" |
| **Heartbeat** | Periodic ping a device sends to confirm it is alive | "ping", "check-in", "connection" |
| **Proof of Play** | Log of what content played on what device at what time | "play log", "report", "history", "audit" |

### 7.2 Roles (exact names matter)

| Exact role name | Scope | Never call it |
|---|---|---|
| Platform Owner | Platform-wide | "super admin", "god mode", "root" |
| Management Company Admin | Management company | "reseller", "partner", "agency admin" |
| Org Owner | Organization | "account owner", "primary user" |
| Org Admin | Organization | "admin", "manager" |
| Workspace Admin | Workspace | "workspace manager" |
| Workspace Editor | Workspace | "contributor", "creator" |
| Workspace Viewer | Workspace | "read-only user", "viewer only" |

### 7.3 Status Values (must be exact when used in queries/API calls)

| Field | Valid values |
|---|---|
| `contentItems.type` | `image`, `video`, `html5`, `pdf`, `presentation`, `web_url` |
| `contentItems.approvalState` | `draft`, `pending_review`, `approved`, `rejected` |
| `contentItems.status` | `processing`, `ready`, `error` |
| `devices.status` | `online`, `offline`, `provisioning` |
| Schedule `recurrence` | `once`, `daily`, `weekly`, `monthly` |

---

## 8. Evaluation — How to Measure AI Quality

Do not release AI features without a measurement framework. Vague "it seems better" is not enough.

### 8.1 Automated Eval Suite

Maintain a test set of 100 question-answer pairs that the AI must answer correctly. Run this suite after every fine-tune and before promoting a new adapter.

**Test categories:**

| Category | Count | Measurement |
|---|---|---|
| Factual platform knowledge | 30 | Exact match on key facts (e.g. "What are the valid values for approvalState?") |
| Workflow intent classification | 20 | Does the AI correctly identify the user's intent (e.g. "wants to create a schedule" vs "wants to update content")? |
| Structured output (tool calls) | 20 | Does the AI produce valid JSON matching the expected schema? |
| Refusal accuracy | 15 | Does the AI correctly refuse/redirect for off-limits actions? |
| Tone & length | 15 | Human-rated 1–5 in monthly review |

### 8.2 Production Metrics (track weekly)

| Metric | Target | Alert if |
|---|---|---|
| Thumbs-up rate | ≥ 85% | < 75% for 3 consecutive days |
| Immediate follow-up clarification rate | ≤ 15% | > 25% (AI answers were unclear/incomplete) |
| Action cancellation rate | ≤ 10% | > 20% (AI proposed wrong actions) |
| Avg response latency | ≤ 3 s | > 6 s |
| RAG retrieval hit rate | ≥ 80% | < 60% (knowledge base may need richer content) |

### 8.3 Qualitative Review (monthly)

A human (superadmin or you) reviews 20 randomly sampled conversations from the past month and rates each on:
1. Correctness — was the information accurate?
2. Relevance — did it actually address what the user asked?
3. Safety — did it stay within permitted actions?
4. Personality — did it sound like a helpful product, not a generic bot?

---

## 9. Data Pipelines

### 9.1 RAG Indexing Pipeline

```
Document changed (file, schema, help article)
  │
  ├─ Watcher detects change (file watch or CI webhook)
  ├─ Chunker: split document into 300–500 token chunks with overlap
  ├─ Embedder: nomic-embed-text → 768-dim vector per chunk
  ├─ pgvector: upsert chunk + embedding (keyed by document path + chunk index)
  └─ Log: "Re-indexed: {document}, {n} chunks, {ms}ms"
```

### 9.2 Training Data Pipeline

```
Monthly batch:
  ├─ Export ai_conversations WHERE feedback = 'negative' AND corrected_response IS NOT NULL
  ├─ Export ai_conversations WHERE feedback = 'positive' (sample 20% to avoid overfitting)
  ├─ Merge with existing training JSONL file
  ├─ Deduplicate + shuffle
  ├─ Run LoRA fine-tune (Unsloth on ROCm, ~4–8 hours for 7B)
  ├─ Evaluate on held-out test set
  └─ If eval passes threshold → tag as release candidate
```

### 9.3 Conversation Storage Schema

```sql
-- Stored in ai_conversations table
{
  id: uuid,
  orgId: uuid,           -- tenant isolation — never joins across orgs
  userId: uuid,
  sessionId: uuid,       -- groups messages in one session
  role: 'user' | 'assistant',
  content: text,         -- the message
  context: jsonb,        -- the system prompt context used (org snapshot, RAG chunks)
  feedback: 'positive' | 'negative' | null,
  feedbackNote: text,    -- optional user note on thumbs-down
  correctedResponse: text, -- human-written correction (if any)
  latencyMs: integer,
  modelVersion: text,    -- which model/adapter was used
  createdAt: timestamp
}
```

---

## 10. What Not to Do

These are common mistakes that produce an AI that seems impressive in demos but fails in production.

| Mistake | Why it fails | What to do instead |
|---|---|---|
| **Training on generic signage tutorials** | The AI learns signage concepts but not YOUR platform's conventions, field names, and workflows | Train only on Nexari OmniHub-specific material |
| **Using big cloud models as the "AI"** | Client data leaves your server; costs scale with usage; you lose the privacy selling point | Local inference only via Ollama + ROCm |
| **Skipping the feedback collection UI** | You have no data to improve the AI over time — it stays frozen at initial quality | Build thumbs up/down on day 1 |
| **Fine-tuning before RAG is working** | Fine-tuning cannot teach the AI current data (prices, device names, schedules) — that must come from RAG | Get RAG + system prompt working first |
| **Letting the AI act without confirmation** | Users accept AI actions without reading them (habit), then complain when something wrong is published | Always preview + confirm before publish |
| **One system prompt for all roles** | A Workspace Viewer should not see the same capabilities as a Platform Owner | Inject role into system prompt; AI must behave according to role |
| **Not versioning model adapters** | If a fine-tune degrades quality, you cannot roll back | Tag every adapter with a version + eval score; keep last 3 versions |
| **Indexing the entire codebase into RAG** | Code is noisy for a CMS assistant; too many tokens, low relevance | Index only documentation, help articles, and schema-as-prose. Keep code out. |

---

## 11. Phased Training Rollout

### Phase 1 — Knowledge Foundation (before AI launches)

- [ ] Write 200 seed training examples across all intent categories (§5.1)
- [ ] Convert all DB schema files to natural-language prose chunks
- [ ] Write the 30–50 help articles (§2.3) — these double as client-facing help center
- [ ] Index all docs into pgvector with nomic-embed-text
- [ ] Write and test the base system prompt + org context assembly (§3)
- [ ] Test RAG retrieval quality with 20 representative queries

### Phase 2 — Live with Feedback (first 30 days after AI assistant launch)

- [ ] Thumbs up/down UI on every assistant response
- [ ] Feedback stored in `ai_conversations` table
- [ ] Weekly monitoring: thumbs-down rate, cancellation rate, latency
- [ ] Identify top 10 failing question types from thumbs-down notes

### Phase 3 — First Fine-Tune (after ~500 feedback samples)

- [ ] Export negative feedback + human corrections
- [ ] Combine with seed dataset
- [ ] LoRA fine-tune on Qwen2.5 7B (fast iteration model, fits in 8 GB VRAM)
- [ ] Run automated eval suite — must pass 85% threshold
- [ ] A/B test on 10% of traffic for 1 week
- [ ] Promote if metrics improve; rollback if not

### Phase 4 — Larger Model Fine-Tune (after 3 months, 2000+ samples)

- [ ] Repeat fine-tune on Qwen2.5 32B (higher capability, needs scheduling)
- [ ] Add synthetic data generation pass (§5.3)
- [ ] Evaluate tone, structured output reliability, refusal accuracy
- [ ] Target: thumbs-up rate ≥ 90%

### Phase 5 — Specialized Models (ongoing)

- [ ] Separate fine-tuned adapter for content generation (describes signage content well)
- [ ] Separate adapter for code agent (trained on platform codebase conventions)
- [ ] Separate adapter for self-healing (trained on incident/resolution pairs)

---

*End of document. Priority action: write the 200 seed examples and the help articles. Everything else depends on these.*
