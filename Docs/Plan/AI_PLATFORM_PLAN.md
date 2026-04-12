# Nexari OmniHub — AI Platform Plan

> **Status:** Vision / Design  
> **Updated:** 2026-04-12  
> **Relates to:** `Docs/Plan/PROJECT_PLAN.md` · `Docs/Tizen/TIZEN_BUILD_DEPLOY.md`

---

## Short Answer: Yes — With the Right Architecture

Your hardware is genuinely capable of running everything described below locally, without paying per-token to OpenAI or Anthropic. The key is engineering the right guardrails so AI acts as an accelerator rather than a liability.

---

## Table of Contents

1. [AI Server Hardware Assessment](#1-ai-server-hardware-assessment)
2. [AI Capabilities Map](#2-ai-capabilities-map)
3. [Layer 1 — AI Content Creation Studio](#3-layer-1--ai-content-creation-studio)
4. [Layer 2 — AI CMS Assistant (Client-Facing)](#4-layer-2--ai-cms-assistant-client-facing)
5. [Layer 3 — AI System Monitor & Self-Healing](#5-layer-3--ai-system-monitor--self-healing)
6. [Layer 4 — AI Feature Builder (Supervised Code Agent)](#6-layer-4--ai-feature-builder-supervised-code-agent)
7. [Layer 5 — AI Business Intelligence (Restaurant / SMB)](#7-layer-5--ai-business-intelligence-restaurant--smb)
8. [Architecture Overview](#8-architecture-overview)
9. [Local AI Model Stack](#9-local-ai-model-stack)
10. [Integration with Existing Platform](#10-integration-with-existing-platform)
11. [What Needs to Be Built](#11-what-needs-to-be-built)
12. [Phased Rollout](#12-phased-rollout)
13. [Honest Constraints](#13-honest-constraints)

---

## 1. AI Server Hardware Assessment

| Component | Spec | AI Relevance |
|-----------|------|-------------|
| **CPU** | Intel Core Ultra 9 285K (8P + 16E cores, built-in NPU) | Fast pre/post-processing; NPU offloads lightweight inference (embeddings, classification) without touching GPU |
| **RAM** | 64 GB DDR5 | Allows large model weight offloading from VRAM to system RAM; enables hybrid CPU+GPU inference for very large models |
| **GPU** | AMD RX 9700 — 32 GB VRAM | **Key asset.** 32 GB VRAM is rare at this price point. Fits Llama 3.3 70B at Q4 (~38 GB split GPU+RAM), Qwen2.5 72B, full Flux.1 Dev image model, CogVideoX video generation — all locally |
| **Storage** | 4 TB NVMe | Comfortably holds: model weights (≤ 500 GB for full stack), platform DB, media assets, video outputs, build artifacts |
| **Network** | Local LAN | All client traffic, signage TV connections, and AI inference stay on-premise — zero cloud dependency for core operations |

### What This Hardware Can Run Locally (All Private)

| Model | Purpose | VRAM | Fits? |
|-------|---------|------|-------|
| **Qwen2.5 72B Q4** | General assistant, business logic, content writing | ~38 GB (GPU+RAM split) | ✅ hybrid |
| **Qwen2.5-Coder 32B Q4** | Code generation, feature building agent | ~18 GB | ✅ GPU-only |
| **LLaVA / InternVL 26B** | Image understanding, content review | ~14 GB | ✅ |
| **Flux.1 Dev** | Image generation (menu boards, promo art) | ~24 GB | ✅ |
| **LTX-Video / CogVideoX-5B** | Short video loop generation | ~10–14 GB | ✅ |
| **Whisper Large v3** | Voice input, transcription | ~3 GB | ✅ |
| **BGE-M3 / nomic-embed** | Embeddings, semantic search, RAG | ~1 GB | ✅ |

> **Note:** AMD ROCm (the GPU compute stack for AI on AMD) is fully supported for inference via `ollama`, `llama.cpp`, and `vllm` as of 2026. Performance is 85–95% of equivalent NVIDIA hardware for inference workloads.

---

## 2. AI Capabilities Map

```
┌─────────────────────────────────────────────────────────┐
│                  Nexari OmniHub AI                       │
├──────────────┬──────────────┬──────────────┬────────────┤
│  Layer 1     │  Layer 2     │  Layer 3     │  Layer 4   │
│  Content     │  CMS         │  System      │  Feature   │
│  Studio      │  Assistant   │  Monitor     │  Builder   │
│              │              │  & Self-Heal │  (Agent)   │
├──────────────┴──────────────┴──────────────┴────────────┤
│                   Layer 5 — Business AI                  │
│         (Restaurant · Retail · SMB intelligence)         │
└─────────────────────────────────────────────────────────┘
                            │
                ┌───────────┴───────────┐
                │  Local AI Inference   │
                │  Ollama / vLLM        │
                │  AMD RX 9700 32GB     │
                └───────────────────────┘
```

---

## 3. Layer 1 — AI Content Creation Studio

**What it does:** Generates ready-to-display signage content from simple text prompts — no design skills needed from the client.

### 3.1 Menu Board Generation

```
Client types: "Lunch special: Grilled salmon with seasonal vegetables, $24"
AI produces:
  → Hero image (Flux.1 image generation)
  → Styled menu card layout (HTML/CSS zone template)
  → Price & description formatted to brand colors
  → Multiple variants (photos, illustrated, minimal)
Client picks one → published to signage in < 60 seconds
```

### 3.2 Promotional Content

```
Client: "Create a weekend happy hour promo, 3pm–7pm, 50% off cocktails"
AI produces:
  → Animated promo slide (CSS animation or video loop)
  → Scheduled automatically for Friday–Sunday 2:45–7:15pm
  → Variants: energetic, elegant, sport bar style
```

### 3.3 Video Loop Generation

- Short ambient loops (10–30 seconds): fire, nature, brand motion graphics
- Product showcase loops from product photos
- Text-on-video promos (LTX-Video + ffmpeg composite)

### 3.4 Content Workflow

```
Client input (text / voice / image)
  │
  ├─ AI Intent Parser (LLM) → understands what type of content is needed
  ├─ Image generator (Flux.1) → generates artwork
  ├─ Layout engine → maps to existing zone template
  ├─ Brand skin applied → org colors, logo, fonts from player-skin API
  ├─ Preview rendered → shown in portal canvas editor
  └─ Client approves → content item saved, published to playlist/schedule
```

### 3.5 Branding Guard

The AI is always given the org's brand skin (colors, logo, font) as a constraint. It cannot generate content that violates the org's branding — same skin contract used by the Tizen player (Section 8 of the Tizen plan).

### 3.6 POS / Menu System Integration

For restaurants using Square, Toast, or Clover — a webhook pushes price and item changes directly into the platform. The AI maps the updated menu data to matching content items and regenerates affected slides automatically.

```
Price change detected in POS (Square webhook)
  │
  ├─ AI identifies affected menu board content items
  ├─ Updates price/description fields
  ├─ Regenerates image if layout change needed
  └─ Publishes silently or queues for client approval (configurable)
```

Supported POS systems (via webhook): Square, Toast, Clover  
Manual fallback: CSV / JSON upload for unsupported systems

### 3.7 Multi-Language Content

The AI translates any content item to a selected language on request — useful for bilingual menus, multilingual promos, and diverse markets without duplicating work.

```
Client: "Translate my lunch specials board to Spanish"
AI:
  → Translates all text fields
  → Adjusts layout if text length changes significantly
  → Creates a new content item variant (original preserved)
  → Client can schedule both variants by language / time zone
```

### 3.8 AI Content Moderation Gate

Before any AI-generated content is published to a live screen, a fast vision model checks it for:
- Brand compliance (colors, logo placement, typography)
- Appropriateness for a public display
- Layout integrity (text not clipped, contrast readable at signage scale)

If the check fails, the content is held for client review rather than auto-published. This is critical as management companies scale to dozens of clients generating content autonomously.

---

## 4. Layer 2 — AI CMS Assistant (Client-Facing)

**What it does:** A chat interface embedded in the portal that understands the client's account, devices, content, and schedules. Replaces much of the "how do I..." support burden.

### 4.1 Navigation Assistant

```
Client: "How do I add a new screen to my restaurant?"
AI: "I can do that for you. Which workspace — Dining Room or Bar? I'll walk you through it."
     → Highlights relevant UI elements
     → Can pre-fill forms on the client's behalf
     → Logs action in audit trail
```

### 4.2 Content Assistant

```
Client: "My Tuesday lunch menu changed — the salmon is now $28"
AI:
  → Finds the existing salmon menu board content item
  → Updates the price
  → Asks "Would you like me to regenerate the image too?"
  → Publishes update
```

### 4.3 Schedule Assistant

```
Client: "Turn off all screens after 10pm"
AI:
  → Creates an on/off timer schedule for all devices in the workspace
  → Confirms: "Done. All 5 screens in Dining Room will power off at 10 PM daily."
```

### 4.4 What the Assistant Can Act On (Permitted Actions)

| Action | AI autonomy | Guardrail |
|---|---|---|
| Answer questions | Full | None needed |
| Create/edit content drafts | Full | Shows preview, client confirms publish |
| Update prices, text in existing content | Full | Audit log entry |
| Create/modify schedules | Full | Confirms before saving |
| Add/remove devices from playlists | Full | Confirms |
| Delete content / devices | Never autonomous | Always requires explicit user button click |
| Billing / account changes | Never | Redirects to org owner |
| Access other orgs' data | Never | Strict tenant isolation enforced at API |

### 4.5 AI Onboarding Flow

When a new org registers, the AI guides them through first-time setup before they ever reach the main dashboard.

```
New org registered
  │
  ├─ Step 1: "Name your first workspace (e.g. Dining Room, Front Window)"
  ├─ Step 2: "Pair your first screen — scan the code or enter the device PIN"
  ├─ Step 3: "Let's create your first content item — what would you like to show?"
  │           → AI Studio opens, generates a starter menu board or promo
  ├─ Step 4: "Assign it to your screen and set a schedule"
  └─ Done: "Your first screen is live." → Onboarding complete, dashboard opens
```

This directly reduces time-to-first-impression (the moment a client's screen shows real content) and prevents the empty-state abandonment common in CMS products.

---

## 5. Layer 3 — AI System Monitor & Self-Healing

**What it does:** Monitors the platform, detects anomalies, diagnoses root causes, and applies safe fixes automatically — escalating to a human for anything risky.

### 5.1 What It Monitors

| Signal | Source | AI action |
|---|---|---|
| Device offline > 5 min | Heartbeat telemetry | Auto-diagnose: network? power? player crash? Notify management |
| Content not rendering | Player error logs | Identify corrupt file; re-fetch from storage |
| API error rate spike | Fastify request logs | Identify failing route; check DB connection; auto-restart if safe |
| Disk usage > 80% | OS metrics | Auto-purge orphaned uploads > 30 days; alert if still critical |
| Build failure | CI webhook | Parse build log; identify cert expiry, missing dep, or WGT size issue; post fix suggestion |
| DB slow queries | Postgres `pg_stat_statements` | Identify query; suggest index; auto-apply if low-risk |

### 5.2 Self-Healing Decision Tree

```
Anomaly detected
  │
  ├─ Known pattern + safe fix (restart service, re-fetch file, clear cache)?
  │     → Apply fix automatically
  │     → Log: "AI self-healed: reason, action taken, timestamp"
  │     → Notify superadmin via platform notification
  │
  ├─ Unknown pattern or medium risk (DB migration, code change)?
  │     → Diagnose and write a human-readable incident report
  │     → Post fix PLAN to superadmin (do not execute)
  │     → Superadmin reviews and approves/rejects
  │
  └─ Critical / destructive risk?
        → Alert immediately, take no action
        → Provide full context for human response
```

### 5.3 Proactive Health Checks

- Daily: cert expiry check (`.p12`, SSL, Let's Encrypt)
- Daily: storage quota trends per org
- Weekly: dependency audit (`npm audit`)
- Weekly: DB size growth rate

### 5.4 Incident Memory

The AI keeps a vector-indexed log of all past incidents and resolutions. When a new anomaly occurs it first checks: "has this happened before, and what fixed it?" This improves speed and accuracy of future auto-healing.

---

## 6. Layer 4 — AI Feature Builder (Supervised Code Agent)

**What it does:** A client or management admin describes a feature they want. The AI writes the code, tests it in isolation, and submits it for human review before it ever touches production.

### 6.1 How It Works

```
Management admin: "My restaurant clients need a daily specials countdown timer widget"
  │
  ├─ AI: Clarifies requirements (chat)
  ├─ AI: Designs the feature (component spec)
  ├─ AI: Writes the code:
  │       - React component in apps/ds/src/
  │       - API route if needed in apps/api/src/routes/
  │       - DB migration if needed
  │       - Tizen player JS module if needed
  ├─ AI: Runs local tests (unit + integration)
  ├─ AI: Creates a git branch + pull request
  ├─ Human: Reviews PR in GitHub — approves or requests changes
  └─ CI: Normal pipeline — build, test, deploy
```

### 6.2 What the Agent Can Build

| Feature type | Autonomous? | Notes |
|---|---|---|
| New UI component (no data) | ✅ | Safe — isolated component |
| New API route + DB query | ✅ with review | PR required before merge |
| New DB table / migration | ✅ with review | Drizzle migration reviewed before run |
| Tizen player JS module | ✅ with review | Test in `apps/tizen` only |
| Auth changes / permission model | ❌ Never | Too high risk |
| Billing / payment code | ❌ Never | Too high risk |
| Deleting existing features | ❌ Never | Requires explicit human decision |

### 6.3 Agent Constraints

- Works only in a sandboxed git branch — never directly on `main`
- Cannot deploy — only CI/CD can deploy after human PR approval
- All generated code is fully visible to the reviewer before anything runs
- Cannot access client data during code generation — uses fixtures/seeds only
- **Requires GitHub branch protection rules on `main`** — required reviews, passing status checks, no force-push. Without this guardrail the entire safety model breaks.

### 6.4 Realistic Expectation

This layer is **powerful but not magic**. It works best for:
- Well-scoped, self-contained features ("add a countdown timer")
- Variations on existing patterns already in the codebase
- Connecting existing systems in new ways

It is **not** a replacement for a developer on complex architecture decisions. Think of it as a very fast junior dev that always needs code review.

---

## 7. Layer 5 — AI Business Intelligence (Restaurant / SMB)

**What it does:** Connects the signage data the platform already collects (play events, device uptime, engagement times) with client business context (menu, hours, sales patterns) to give genuinely useful business advice.

### 7.1 Restaurant-Specific Intelligence

| Insight | Data source | Example |
|---|---|---|
| Best-performing menu items (screen time vs order correlation) | Play events + POS webhook (optional) | "Salmon promo shown 240x; salmon orders up 18% on days it played" |
| Optimal display time for lunch specials | Schedule history + foot traffic patterns | "Your lunch specials board has highest engagement 11:30am–12:15pm on weekdays" |
| Screen downtime cost estimate | Device heartbeat logs | "Screen 3 was offline 4.2 hours this week. Estimated impact: ~62 missed impressions" |
| Content freshness alerts | Content item `updatedAt` | "Your 'Today's Soup' slide hasn't changed in 14 days — want me to update it?" |

### 7.2 General SMB Intelligence

- **Announcement drafting:** "Write a social-media-ready caption for the same promo on screen"
- **Staff communication:** "Post a shift reminder to the back-of-house screen"
- **Seasonal planning:** "Suggest content themes for the next 4 weeks based on upcoming holidays"

### 7.3 Weekly AI Digest

Every Monday morning, each org owner receives an automated digest (in-portal notification + optional email):

| Section | Content |
|---|---|
| Screen health | Uptime % per device last 7 days; any offline incidents |
| Top content | Most-displayed content items; engagement time estimates |
| Freshness warnings | Content items not updated in > 7 days |
| Suggested actions | "Your Happy Hour promo played 0 times this week — schedule it?" |
| Upcoming | Holidays / events in the next 2 weeks with suggested content themes |

No dashboard visit required — the AI surfaces the important things proactively.

### 7.4 What It Cannot Do (Scope Limits)

- Cannot access real financial/POS data unless explicitly integrated via webhook
- Cannot make purchasing decisions on behalf of the business
- Cannot access data from other orgs (hard tenant isolation)
- Insights are advisory — never auto-publish based on predictions alone

---

## 8. Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                   Ubuntu Home AI Server                      │
│                                                             │
│  ┌─────────────────────────┐  ┌──────────────────────────┐  │
│  │  Nexari OmniHub CMS     │  │  AI Inference Stack      │  │
│  │  (existing platform)    │  │                          │  │
│  │  - Fastify API          │◄─►  Ollama / vLLM           │  │
│  │  - React Portal (DS)    │  │  - Qwen2.5 72B (chat)    │  │
│  │  - Tizen WGT builder    │  │  - Qwen2.5-Coder 32B     │  │
│  │  - Postgres + Drizzle   │  │  - Flux.1 (images)       │  │
│  │  - Redis                │  │  - LTX-Video (video)     │  │
│  │  - Nginx (static/proxy) │  │  - BGE-M3 (embeddings)   │  │
│  └─────────────────────────┘  └──────────────────────────┘  │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  AI Orchestration Layer (new)                        │    │
│  │  - LangGraph workflow engine                         │    │
│  │  - Tool/function call router                         │    │
│  │  - RAG knowledge base (pgvector)                     │    │
│  │  - Audit log for all AI actions                      │    │
│  │  - Sandbox for code agent (isolated Docker)          │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                             │
│  AMD RX 9700 32GB VRAM — all inference local & private      │
└─────────────────────────────────────────────────────────────┘
          │                              │
    Samsung TVs                   Client browsers
    (Tizen/SSSP)                  (portal + chat UI)
```

### 8.1 Key Services

| Service | Port | Purpose |
|---|---|---|
| Fastify API | 3000 | Existing CMS API + new AI gateway routes |
| Ollama | 11434 | Local LLM inference (LAN only, not exposed externally) |
| LangGraph | (in-process) | AI workflow orchestration (content gen pipelines, monitor triggers) |
| pgvector | (Postgres extension) | Embedding storage for RAG (help docs, past incidents, org context) |
| ComfyUI | 7860 | Image generation API (wraps Flux.1) |
| Nginx | 80/443 | Reverse proxy — portal, API, signage static files, AI endpoints |

---

## 9. Local AI Model Stack

### 9.1 Recommended Model Set (fits in 32GB VRAM with smart scheduling)

| Role | Model | VRAM | Loaded when |
|---|---|---|---|
| General assistant + business AI | `qwen2.5:72b-instruct-q4_K_M` | ~22 GB (GPU) + ~16 GB (RAM) | On demand, kept warm |
| Code generation agent | `qwen2.5-coder:32b-instruct-q4_K_M` | ~18 GB | On demand |
| Image generation | Flux.1 Dev (FP8) | ~18 GB | On demand |
| Video generation | LTX-Video | ~10 GB | Batch queue |
| Vision / content review | `llava:34b-v1.6-q4_K_M` | ~18 GB | On demand |
| Embeddings (always on) | `nomic-embed-text` | ~0.5 GB | Always loaded |

> GPU VRAM is shared via Ollama's model scheduling — only one large model is fully resident at a time. The orchestration layer queues requests accordingly.

### 9.2 AMD ROCm Setup

```bash
# Ubuntu 22.04 / 24.04 + ROCm 6.x
sudo apt install rocm-dev rocm-libs
# Ollama has native ROCm support from v0.3+
curl -fsSL https://ollama.com/install.sh | sh
# Verify GPU detected
ollama run qwen2.5:72b
```

---

## 10. Integration with Existing Platform

### 10.1 New API Routes (in `apps/api/src/routes/`)

```
POST /api/v1/ai/chat                      → CMS assistant chat (per-org context)
POST /api/v1/ai/generate/image            → image generation (Flux.1 via Ollama)
POST /api/v1/ai/generate/content          → full menu board / promo generation
POST /api/v1/ai/generate/video            → video loop generation (queued)
GET  /api/v1/ai/insights/:orgId           → business intelligence for org
POST /api/v1/ai/agent/feature-request     → supervised code agent (superadmin only)
POST /api/v1/ai/monitor/webhook           → internal: monitor triggers
```

### 10.2 New Portal Pages (in `apps/ds/src/pages/`)

| Page | Who sees it | Purpose |
|---|---|---|
| `workspace/AIStudioPage.tsx` | Org users | Content creation studio — generate menu boards, promos, video loops |
| `workspace/AIAssistantWidget.tsx` | All users | Floating chat widget on every page |
| `workspace/BusinessInsightsPage.tsx` | Org owners | Restaurant/SMB business intelligence dashboard |
| `management/ManagementAIPage.tsx` | Management admin | Feature request to agent, AI usage stats |
| `superadmin/PlatformAIPage.tsx` | Superadmin | Monitor dashboard, self-heal log, code agent review queue |

### 10.3 DB Extensions

- `pgvector` extension on Postgres (already running on the same server) — for embeddings/RAG
- New table: `ai_conversations` — per-org chat history (tenant-isolated)
- New table: `ai_content_jobs` — generation job queue with status
- New table: `ai_incidents` — self-heal log
- New table: `ai_feature_requests` — code agent request + PR link

### 10.4 Tenant Isolation

**Critical:** Every AI call is scoped to an `orgId`. The LLM is given only that org's context (their content, devices, schedules, player skin). No cross-org data ever enters a prompt.

---

## 11. What Needs to Be Built

Ordered by value and dependency:

| Priority | Feature | Effort | Dependencies |
|---|---|---|---|
| P1 | Local Ollama + model setup on Ubuntu server | 1 day | Hardware up |
| P1 | AI chat API route + tenant context injection | 2 days | P1 above |
| P1 | AI assistant widget in portal | 3 days | API route |
| P2 | AI image generation (Flux.1) + content studio page | 3 days | Ollama image model |
| P2 | Menu board / promo generation template engine | 3 days | Image gen |
| P2 | AI content moderation gate | 2 days | Image gen |
| P2 | Multi-language content translation | 1 day | AI chat API |
| P2 | POS webhook integration (Square, Toast, Clover) | 3 days | Content studio |
| P2 | pgvector setup + RAG for help docs | 2 days | Ollama embeddings |
| P3 | System monitor + self-heal log | 3 days | AI chat API |
| P3 | Business insights API + page | 3 days | Play event data |
| P3 | AI onboarding flow | 2 days | AI assistant widget |
| P3 | Weekly AI digest (notification + email) | 2 days | Business insights |
| P4 | Video loop generation (queue-based) | 4 days | LTX-Video setup |
| P4 | Code agent (sandboxed) | 5 days | Everything above |

---

## 12. Phased Rollout

### Phase A — AI Foundation (Month 1)
- Ubuntu server provisioned with Ollama + ROCm
- Models downloaded and tested
- AI chat API route with org context
- Assistant chat widget in portal (navigation help + FAQ)
- AI onboarding flow for new org registration

### Phase B — Content AI (Month 2)
- Image generation in portal (AI Studio page)
- Menu board + promo generation flows
- Brand skin always applied to outputs
- AI content moderation gate (auto-check before publish)
- Multi-language content translation
- POS webhook integration (Square, Toast, Clover)
- Video loop queue (basic)

### Phase C — Smart Platform (Month 3)
- System monitor + self-heal log
- Business insights page (play events + engagement data)
- Proactive content freshness alerts
- Weekly AI digest (in-portal notification + email)

### Phase D — Agent (Month 4+)
- Code agent for feature requests (superadmin-gated)
- Feature request queue + PR review workflow
- Agent expanding its own capabilities with approval

---

## 13. Honest Constraints

| Concern | Reality |
|---|---|
| **"AI can fully program any feature"** | AI can write well-scoped features reliably. Complex architecture changes still need human judgment. Think: AI writes the first draft, human reviews and refines. |
| **"AI can auto-fix any bug"** | AI can handle known patterns (restart service, re-fetch file, clear stale cache). It cannot reliably auto-fix logic bugs in application code without risking new bugs. Human approval required for code changes. |
| **"Always-on AI is expensive"** | No cloud costs — everything runs locally on your hardware. Electricity is the only cost. Inference is fast: chat responses ~2–5 seconds, images ~15–30 seconds, video ~2–5 minutes. |
| **"AMD GPU won't work well"** | ROCm support in 2026 is solid for inference workloads. Ollama, llama.cpp, and ComfyUI all support ROCm natively. Minor rough edges for training (not relevant here). |
| **"This will slow down the CMS"** | AI inference runs on the GPU in a separate process. The CMS API (CPU + Postgres) is unaffected. Nginx routes AI requests to the inference stack separately. |
| **"Client data privacy"** | All inference is local. No client data leaves the server. This is a major competitive advantage: you can offer "private AI" as a selling point. |

---

*End of document. Start with Phase A — get Ollama running and the chat widget in the portal.*
