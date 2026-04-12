# Nexari OmniHub — AI Creative & Co-Business Plan

> **Status:** Design  
> **Updated:** 2026-04-12  
> **Relates to:** `Docs/Plan/AI_PLATFORM_PLAN.md` · `Docs/Plan/AI_TRAINING_PLAN.md`

---

## Overview

This document covers two AI systems that go beyond the CMS:

1. **AI Creative Engine** — generates images, video, and menu layouts purpose-built for digital signage. Not a generic "text to image" tool. Trained to understand signage constraints, brand rules, and food/retail presentation.

2. **AI Co-Business Partner** — an AI that deeply knows the client's specific business (menu, pricing, season, audience, goals) and acts as a strategic partner: suggesting what to show, when to show it, how to price it, and what's working. Closer to a business consultant than a chatbot.

These two systems feed each other: the Co-Business AI decides *what* to show; the Creative Engine generates *how it looks*.

---

## Table of Contents

**Part A — AI Creative Engine**
1. [What Makes Signage Generation Different](#1-what-makes-signage-generation-different)
2. [Image Generation — Architecture & Pipeline](#2-image-generation--architecture--pipeline)
3. [Menu Board Generation — Specialized System](#3-menu-board-generation--specialized-system)
4. [Video Generation](#4-video-generation)
5. [Layout Intelligence](#5-layout-intelligence)
6. [Training the Creative Engine](#6-training-the-creative-engine)

**Part B — AI Co-Business Partner**
7. [What Is a Co-Business AI?](#7-what-is-a-co-business-ai)
8. [Business Knowledge Model](#8-business-knowledge-model)
9. [Co-Business Capabilities by Industry](#9-co-business-capabilities-by-industry)
10. [Training the Co-Business AI](#10-training-the-co-business-ai)
11. [How the Two Systems Work Together](#11-how-the-two-systems-work-together)
12. [What Needs to Be Built](#12-what-needs-to-be-built)
13. [Phased Rollout](#13-phased-rollout)

---

# Part A — AI Creative Engine

---

## 1. What Makes Signage Generation Different

Generic AI image generation (Midjourney, DALL·E, stock Flux.1) is not optimised for digital signage. The constraints are different:

| Constraint | Generic image AI | Signage-optimised AI |
|---|---|---|
| **Viewing distance** | Made for screens viewed at arm's length | Designed for 2–10 metre viewing distance — larger type, simpler composition, higher contrast |
| **Viewing duration** | Image is studied | Slide shows for 8–15 seconds — message must land in 3 seconds |
| **Brand compliance** | None — generates what looks good | Must use exact brand colors, fonts, logo placement rules |
| **Safe zones** | Not considered | Samsung displays lose 5–8% of edge — critical info must stay inside safe zone |
| **Text legibility** | Text looks fine on a desktop | Text must be readable on a 75" display across a room in ambient light |
| **Content type conventions** | Anything | Menu boards have specific hierarchy (photo → name → description → price); promos have different rules |
| **Output format** | Any resolution | Must match the device resolution and orientation (16:9, 9:16, 32:9 stretch) |
| **Food photography style** | Random | Restaurant clients expect specific food styling that makes food look appetising (warm tones, steam, garnish) |

The AI Creative Engine is trained and prompted with all of these constraints baked in.

---

## 2. Image Generation — Architecture & Pipeline

### 2.1 Model Stack

```
Request arrives (text prompt + brand skin + target resolution + content type)
  │
  ├─ Prompt Builder (LLM)
  │     Converts client's plain text into a structured Flux.1 prompt
  │     Applies brand, content type, and signage constraints automatically
  │
  ├─ Flux.1 Dev (image diffusion model, 18–24 GB VRAM)
  │     Generates base image at target resolution
  │
  ├─ ControlNet (optional, for layout-guided generation)
  │     If a layout template is provided, generation respects composition zones
  │
  ├─ Post-processor (Python + Pillow / ffmpeg)
  │     - Applies brand color overlay / tint correction
  │     - Safe-zone crop/pad
  │     - Adds logo to designated placement
  │     - Checks contrast ratios (WCAG AA)
  │
  ├─ Vision QA model (LLaVA / InternVL, fast pass)
  │     - Confirms content type is correct (food, promo, info board)
  │     - Confirms text-free zones are actually text-free
  │     - Flags if food looks unappetising or content looks off-brand
  │
  └─ Output: finalized image → stored as content item
```

### 2.2 Prompt Builder — The Critical Layer

The client never writes a Flux.1 prompt. They write natural language:

```
Client: "Grilled salmon with seasonal vegetables, $24, for lunch special"
```

The Prompt Builder translates this into a precise generation prompt:

```
Flux.1 prompt:
"Professional food photography of grilled salmon fillet with seasonal roasted vegetables,
warm studio lighting, shallow depth of field, restaurant quality plating, steam rising,
garnished with fresh herbs and lemon wedge, shot on marble surface, warm amber tones,
appetising presentation. Full resolution, no text overlaid. 16:9 aspect ratio.
Background: dark navy (#0b0d11). Foreground area left clear for text overlay."

Negative prompt:
"text, watermarks, logos, plastic-looking food, grey tones, cold lighting,
undersaturated, blurry, amateur photography, cartoon, illustration"
```

The Prompt Builder is a fine-tuned LLM (§6) trained on hundreds of food, retail, and hospitality photography prompts mapped to their ideal signage outputs.

### 2.3 Variant Generation

Every generation produces 3 variants automatically:
- **Photo-realistic** — food photography style, warm tones
- **Illustrated / graphic** — flat design or illustrated, brand colors dominant
- **Minimal / typographic** — strong typography, minimal imagery, elegant

Client selects one. This is faster than iterating on a single prompt.

### 2.4 Reference Image Input

Clients can upload a photo of their actual dish (phone photo is fine):

```
Client uploads phone photo of salmon dish
  │
  ├─ Vision model: "This is a food photo of what appears to be salmon with vegetables"
  ├─ Flux.1 img2img: Enhances the photo to professional food photography quality
  │     - Improves lighting, color grading, background cleanup
  │     - Keeps the actual dish recognizable
  └─ Same post-processing pipeline runs
```

This is extremely valuable for restaurants — their actual food, made to look professional.

---

## 3. Menu Board Generation — Specialized System

Menu boards are the highest-volume generation task and deserve their own specialized pipeline.

### 3.1 Menu Board Data Model

A menu board is not just a pretty image — it has structured data that drives both the design and future updates:

```
MenuBoard {
  layout:        "hero" | "grid" | "list" | "spotlight"
  category:      "Mains" | "Drinks" | "Desserts" | "Specials" | ...
  items: [
    {
      name:         "Grilled Salmon"
      description:  "With seasonal vegetables and lemon butter"
      price:        "$24"
      dietaryFlags: ["GF", "DF"]
      availability: "lunch" | "dinner" | "all-day"
      heroImage:    <generated or uploaded photo>
    },
    ...
  ]
  footer:        "Ask about today's specials"
  validFrom:     "2026-04-01"
  validUntil:    "2026-06-30"
}
```

The board is assembled from this structured data + an HTML/CSS template zone, not generated as a flat image. This means:
- Prices can be updated without regenerating the hero image
- New items can be added without redesigning the whole board
- The same content item updates live on screen when data changes (via HTML5 zone type)

### 3.2 Menu Layout Templates

Pre-built, brand-skinnable HTML/CSS templates for common menu board types:

| Template | Best for | Zones |
|---|---|---|
| **Hero Single** | Daily special, featured dish | Full-screen hero image + name + description + price |
| **Grid 2×2** | Category overview (4 items) | 4 equal cells, each with photo + name + price |
| **Grid 3×1** | Drinks or sides | 3 items side by side |
| **List** | Long menus (8+ items) | Text-heavy, no per-item photos, category headers |
| **Spotlight + List** | Recommended + full menu | Hero image for special + scrollable list below |
| **Happy Hour** | Time-limited promos | Large clock countdown + discount copy + product |
| **Today's Special** | Single changing item | Large hero + prominent price + "Today Only" badge |

Each template accepts the brand skin automatically (primary color, secondary color, font family, logo).

### 3.3 AI-Assisted Template Selection

```
Client: "I need to show my 3 new cocktail specials for Friday night"

AI reasoning:
  - 3 items → Grid 3×1 or Spotlight + List
  - "Cocktails" → drinks category, typically stylised photography
  - "Friday night" → schedule for Friday 6pm–midnight
  - "Specials" → validity window suggestion: this Friday only

AI proposes:
  "I'll use the Grid 3×1 drink template. Could you give me the names and prices? 
   I'll generate a styled image for each."
```

### 3.4 POS Sync — Live Menu Updates

When POS integration is active (§3.6 in `AI_PLATFORM_PLAN.md`), menu boards update automatically:

```
POS update: "Salmon price changed from $24 → $28"
  │
  ├─ Match to content item: "Lunch Specials Board" (contains salmon item)
  ├─ Update price field in the MenuBoard data model
  ├─ Re-render HTML/CSS zone (price text update only — no image regeneration needed)
  └─ Live update pushed to Tizen player (content refresh)
     Total time: < 5 seconds from POS change to screen update
```

---

## 4. Video Generation

### 4.1 Use Cases with Real Value

Video generation has lower ROI than image for most uses. Focus on the cases where it genuinely outperforms static images:

| Use case | Why video wins | Generation approach |
|---|---|---|
| **Ambient atmosphere loops** | Keeps screens feeling "alive" during low-content periods | LTX-Video: fire, rain, nature, city — no text, no branding needed |
| **Product showcase** | Shows a product from multiple angles or in use | LTX-Video img2vid from product photo |
| **Animated promos** | Movement draws attention on a busy screen | CSS animation in HTML5 zone (better performance than video for text + motion) |
| **"Now Serving" / queue displays** | Animated indicators look more polished | CSS animation |
| **Staff highlight reels** | Personal touch, builds loyalty | Slideshow + video composite (ffmpeg) |

### 4.2 Video Generation Pipeline

```
Request: "Create a 15s ambient fire loop for the bar area"
  │
  ├─ LTX-Video (~10 GB VRAM): generate raw 15s 1920×1080 clip
  ├─ ffmpeg post-process:
  │     - Color grade to warm amber tones
  │     - Add subtle brand color vignette (optional)
  │     - Encode to H.264, target bitrate for smooth Tizen playback
  └─ Store as video content item → immediately available in playlist
```

### 4.3 Performance Considerations on Tizen

- Maximum recommended video resolution: 1920×1080 (4K decodes poorly on older Tizen)
- Maximum recommended bitrate: 8 Mbps (higher causes playback stutter on SBB)
- H.264 Baseline/Main profile only (not HEVC on Tizen 4)
- Short loops (10–30s) perform better than long files — Tizen frame buffer limitations
- Always generate multiple bitrate variants for different TV generations

**The AI must know these constraints** and apply them automatically at generation time. A 4K HEVC video that took 5 minutes to generate and fails on 60% of devices is worse than a good 1080p H.264 clip.

---

## 5. Layout Intelligence

### 5.1 What Layout Intelligence Does

Layout Intelligence is a model that looks at a completed slide design and tells you — before it goes live — whether it will actually work as signage.

```
Completed slide submitted for QA:
  │
  ├─ Safe zone check: are any critical elements within 10% edge margin?
  ├─ Contrast check: does text meet WCAG AA contrast against background?
  ├─ Readability simulation: at 4m viewing distance, is the font large enough?
  ├─ Visual hierarchy check: does the eye go to the right place first? (price, name, call-to-action)
  ├─ Brand compliance: are brand colors used correctly? Is logo correctly placed?
  └─ Clutter check: is there too much information for an 8-second display Duration?
```

Each issue has a severity: **block** (don't publish), **warn** (show in review), **suggest** (show as tip).

### 5.2 Readability Simulation

The most common signage mistake: text that looks fine on a laptop is unreadable at viewing distance. The layout intelligence model simulates this:

```
Original slide (viewed at 100%):  font-size: 18px  ← looks fine on screen
Simulated view at 4m distance:    effective size ≈ 8px ← completely illegible

AI flags: "This text will be unreadable at normal viewing distance. Minimum recommended 
size for body text at 4m is 36px. Hero/title text should be 72px or larger."
```

### 5.3 Clutter Score

```
Slide submitted with: headline, 6 menu items, 3 logos, a QR code, and a footer disclaimer

AI response: "This slide contains too much information for 8-second display. 
Research shows viewers can absorb 1 primary message + 2 supporting details in 8s. 
Suggestion: split into 3 slides — one per 2 menu items — or increase duration to 25s."
```

---

## 6. Training the Creative Engine

### 6.1 Image Generation — Prompt Builder Training

The Prompt Builder LLM needs to convert plain client language into high-quality Flux.1 prompts for signage. Train it as follows:

**Training pair format:**
```jsonc
{
  "input": {
    "client_text": "Grilled salmon with vegetables, $24 lunch special",
    "brand_skin": { "primaryColor": "#ff6b35", "secondaryColor": "#2c3e50", "fontFamily": "Montserrat" },
    "content_type": "menu_item",
    "resolution": "1920x1080",
    "template": "hero_single"
  },
  "output": {
    "generation_prompt": "Professional food photography of grilled salmon fillet...",
    "negative_prompt": "text, watermarks, logos, plastic-looking food...",
    "post_process": {
      "dominant_tones": "warm amber",
      "text_overlay_region": "bottom_third",
      "logo_placement": "top_right",
      "safe_zone_padding": 80
    }
  }
}
```

**How to collect training data:**

| Source | Method | Volume |
|---|---|---|
| Professional food photography catalogues | License or creative commons — use image + describe it backwards into a prompt | 500–1000 pairs |
| Restaurant signage examples | Collect real menu boards from restaurants — reverse-engineer what prompt would produce this | 200–300 pairs |
| Client-approved generations | When a client picks a generated variant, store (input → selected output) as positive | Grows organically |
| Client-rejected generations | When all variants are rejected, human writes what was wrong → negative examples | Grows organically |
| Synthetic pairs from 72B model | Use large model to generate "what is the ideal prompt for this signage description?" | 1000+ pairs cheaply |

**Target:** 2000+ prompt pairs before first fine-tune. Quality matters more than quantity — each pair should be reviewed.

### 6.2 Vision QA Model Training

The Vision QA model (LLaVA / InternVL) needs to learn what "good signage" looks like vs "bad signage."

**Training data: binary classification + reason**

```jsonc
{
  "image": "generated_slide_001.jpg",
  "label": "fail",
  "issues": [
    "text_in_safe_zone_violation",
    "low_contrast_text",
    "too_many_elements"
  ],
  "correction_suggestion": "Move price text 80px inward. Increase font size to 48px. Remove footer disclaimer."
}
```

**Where to get labelled examples:**
- Label 500 real signage images (good/bad) — use a simple labelling UI, 30 mins of work
- Use GPT-4o / Gemini Vision (one-time batch call) to pre-label 2000 images cheaply — human spot-checks 10%
- Generate intentionally bad examples (low contrast, cluttered, wrong aspect ratio) — easy to produce synthetically

### 6.3 Menu Board Layout Intelligence Training

Train the menu-board-specific model separately from general image QA. It needs to know menu board conventions:

**What good menu board hierarchy looks like:**
```
TOP AREA:     Category header (large, brand color)
HERO ZONE:    Food photo (right half or top half of slide)
ITEM NAME:    Large (64px+), high contrast, bold
DESCRIPTION:  Smaller (36px), lighter weight, grey or secondary color
PRICE:        Prominent (56px+), brand primary color, always visible
DIETARY:      Small badges (GF, VG, DF) — bottom of item block
```

**Train by example:**
- Collect 300+ real menu board designs — label the hierarchy elements
- Fine-tune a LayoutLM or InternVL model on these to recognize compliant vs non-compliant layouts
- This model runs as the final QA pass on every generated menu board

### 6.4 Video Quality Training

Video generation is harder to train directly (each video takes minutes). Instead:

- Fine-tune the **prompt builder** for video: what LTX-Video prompts produce good 15s ambient loops for signage contexts (fire, nature, abstract motion, food presentation)
- Build a **video QA checklist** (not ML — rule-based): resolution check, bitrate check, duration check, codec check, looping quality (no hard cut at loop point)
- Collect 50 high-quality ambient loop examples per category (fire, rain, nature, city, abstract) — use these as reference comparisons for client-facing quality scoring

---

# Part B — AI Co-Business Partner

---

## 7. What Is a Co-Business AI?

The Co-Business AI is fundamentally different from the CMS Assistant.

| CMS Assistant | Co-Business Partner |
|---|---|
| Answers "how do I use this platform?" | Answers "what should my business do?" |
| Knows the Nexari platform | Knows *this client's specific business* |
| Reactive — responds when asked | Proactive — surfaces insights and suggestions unprompted |
| Short-term task focus | Long-term business strategy focus |
| Same for all clients | Deeply personalised to each org |
| Knows menu titles and prices | Knows which dishes drive the most margin, which promos have worked, what their slow days are |

The vision: a restaurant owner opens the portal at 9am and the Co-Business AI has already:
- Noticed that Saturday traffic was 30% below normal
- Identified that their "Weekend Brunch" screens were offline for 2 hours Saturday morning
- Generated a "make-good" promo for next Saturday
- Drafted a staff reminder slide for the kitchen screen
- Flagged that the seasonal autumn menu starts in 3 weeks and asked if they want to start planning

This is not a chatbot with good FAQ answers. It's a business intelligence layer that acts.

---

## 8. Business Knowledge Model

The Co-Business AI maintains a **Business Profile** per org — a structured knowledge graph of the client's business, built progressively from data they provide and patterns it observes.

### 8.1 Business Profile Structure

```
BusinessProfile {
  // Identity
  businessName:     "Bella Vista Restaurant"
  businessType:     "restaurant" | "cafe" | "bar" | "retail" | "salon" | "gym" | ...
  cuisineType:      "Italian" | "Modern Australian" | "Japanese" | ...  ← restaurant only
  targetAudience:   ["families", "young_professionals", "seniors"]
  pricePoint:       "budget" | "mid_range" | "premium" | "fine_dining"

  // Operations
  openingHours:     { Mon: "11:30-22:00", Tue: "11:30-22:00", ... }
  peakHours:        ["12:00-14:00", "18:30-21:00"]  ← learned from analytics
  slowDays:         ["Monday", "Tuesday"]  ← learned from analytics
  seatingCapacity:  80
  locations:        ["Dining Room (4 screens)", "Bar (2 screens)", "Takeaway Counter (1 screen)"]

  // Menu / Products
  menuCategories:   ["Entrees", "Mains", "Sides", "Desserts", "Cocktails", "Wines"]
  highlightedItems: ["Truffle Pasta", "Wagyu Ribeye", "Tiramisu"]  ← staff-marked or AI-suggested
  seasonalMenu:     { active: true, expiresOn: "2026-06-30" }
  priceRange:       { min: 12, max: 95 }  ← from POS or manually entered

  // Marketing context
  upcomingEvents:   ["Mother's Day (May 11)", "Winter Menu Launch (June 1)"]
  currentPromotions: ["Happy Hour Mon-Fri 4-6pm", "Kids eat free Sundays"]
  socialProfiles:   { instagram: "@bellavistasyd", facebook: "..." }  ← optional

  // AI-observed patterns (built over time)
  contentPerformance: {
    "Truffle Pasta Promo": { impressions: 2840, bestDays: ["Thu", "Fri", "Sat"] }
    "Happy Hour Slide":    { impressions: 1200, bestHours: ["15:30-17:00"] }
  }
  screenDowntimeEvents: [...]  ← from heartbeat logs
  contentFreshnessAlerts: [...]  ← items not updated in N days
}
```

### 8.2 How the Profile Is Built

The profile is not a form the client fills in once. It's built progressively:

| Data source | What it adds to the profile | When |
|---|---|---|
| **Onboarding questions** (AI-guided) | Business type, cuisine, hours, price point, seating | First login |
| **Menu import** (CSV, PDF, POS sync) | Full menu categories and items | Setup |
| **Usage patterns** (observed from platform) | Content play frequency, device uptime, peak activity hours | Continuous |
| **Analytics** (play events) | Which content performs best, on which screens, at what times | Continuous |
| **Client tells the AI** (natural language) | Anything: "next week is our 5th anniversary", "Mondays are really slow" | On demand |
| **POS webhook** (optional) | Sales data per item, transaction volume by hour | If connected |
| **Calendar awareness** | Public holidays, seasons, local events | Automatic via date |

### 8.3 Privacy and Ownership

- The Business Profile belongs entirely to the org — it is their private data
- No cross-org sharing, ever
- Stored encrypted in the `ai_business_profiles` table, scoped by `orgId`
- Org Owner can view, edit, or delete the profile at any time
- Deleting the profile resets the AI to "new client" state

---

## 9. Co-Business Capabilities by Industry

### 9.1 Restaurant & Cafe

**Daily operations:**

```
Monday 8:00am — AI morning summary pushed to Org Owner:
  "Good morning! Here's your week ahead:
  
  📊 Last week: Your Saturday dinner screens drove an estimated 340 impressions 
     of the Wagyu special. Sales were up 12% vs the previous Saturday.
  
  ⚠️  Your 'Autumn Menu' content expires on April 30 (18 days). 
     Want me to start planning the Winter menu slides?
  
  🗓️  This week: ANZAC Day public holiday on Friday. Your normal lunch trade 
     may be lighter — consider scheduling your 'Public Holiday Hours' slide 
     Wednesday through Friday.
  
  💡  Tip: Tuesday has historically been your slowest lunch day. 
     A 2-for-1 cocktails offer shown from 11am–2pm on Tuesdays has driven 
     measurable lift for similar venues. Want me to create a slide for next Tuesday?"
```

**Menu strategy suggestions:**

```
AI: "Your Truffle Pasta promo runs on weekday lunches, but your analytics show it 
     gets 3× more engagement on Thursday and Friday evenings. Want me to add it to 
     your dinner playlist for those days?"

AI: "It's been 3 weeks since you updated your Specials board. Would you like to 
     rotate in a new special? I can suggest options based on seasonal availability 
     and your price point."

AI: "Summer is starting and cold weather drinks tend to decline. Your current 
     cocktails board is winter-themed. Want me to update it with something 
     more refreshing for the season?"
```

**Event planning:**

```
AI: "Mother's Day is in 3 weeks (May 11). Would you like me to:
  1. Create a 'Mother's Day Set Menu' promotional slide
  2. Schedule it to run from May 1 on your Dining Room screens
  3. Design a 'Gift Vouchers Available' slide for the bar screens
  4. Draft social media captions for the same promotions?"
```

### 9.2 Bar & Nightclub

- **Happy hour automation:** AI watches the clock; if happy hour screens aren't scheduled, it flags or auto-updates
- **Weekend event promotion:** "Your event poster hasn't been uploaded yet — the event is in 4 days"
- **Drink menu rotation:** "It's been 8 weeks since your cocktail menu changed. Guests notice — want some new suggestions?"
- **Post-midnight content:** "Your screens are showing the full menu after midnight when you only serve drinks — want me to switch to a drinks-only playlist after 12am?"

### 9.3 Retail Store

- **Seasonal clearance:** "Your winter stock is now in clearance. I can create a 'Up to 50% off' promo series — which categories should it cover?"
- **New arrivals:** "You uploaded 3 new product photos last week. Want me to create a 'New Arrivals' showcase slide?"
- **Opening hours changes:** "Public holiday coming up — do your trading hours change? I can update your hours slide automatically."
- **Slow movers:** "Your 'Accessories' category slide hasn't driven notable engagement in 6 weeks. Want to refresh it or temporarily replace it?"

### 9.4 Gym & Fitness Studio

- **Class schedule display:** Integrated class timetable on lobby screens — AI updates automatically from the booking system
- **Membership drive timing:** "Your January new member drive was successful. February typically drops off — want to run a retention campaign on the gym floor screens?"
- **Instructor spotlights:** "You haven't featured any instructor spotlights in 3 months. These drive class bookings. Want to create one?"

### 9.5 Salon & Beauty

- **Appointment gap prompts:** "Wednesday 2–4pm has had available slots for 3 weeks. A 'Book Today — Last-Minute Availability' slide on your reception screen could help."
- **Service promotion rotation:** "Your hair colour promotions haven't been on screen this month. Feature seasonally — autumn tones are trending."
- **Product launch:** "New product line arrives next week. Want a product launch slide series ready for arrival day?"

---

## 10. Training the Co-Business AI

The Co-Business AI requires a different type of training than the CMS assistant — it needs **business domain knowledge** not just platform knowledge.

### 10.1 The Three Knowledge Layers

```
Layer 1: Business Domain Knowledge (industry-agnostic)
  ├─ How restaurants operate (peak hours, seasonal menus, covers, yield management)
  ├─ How retail operates (stock turns, seasons, promotions calendar, loss leaders)
  ├─ How hospitality marketing works (awareness, trial, retention, loyalty)
  └─ How signage affects customer behaviour (dwell time, impulse, brand recall)

Layer 2: Industry-Specific Knowledge (per business type)
  ├─ Restaurant: menu engineering, food cost, table turns, specials rotation
  ├─ Bar: drink margins, event promotion, responsible service, late-night patterns
  ├─ Retail: seasonal calendar, product lifecycle, clearance timing
  └─ ... per vertical

Layer 3: This Client's Specific Business (per org)
  ├─ Their Business Profile (§8.1)
  ├─ Their historical performance data (analytics, heartbeat)
  └─ Anything they've told the AI directly
```

Layers 1 and 2 are trained into the model via RAG and fine-tuning. Layer 3 is injected dynamically per request.

### 10.2 RAG Corpus for Business Domain Knowledge

Index the following into the Co-Business AI's dedicated RAG corpus (separate from the CMS assistant corpus):

**Business operations knowledge:**
- Restaurant industry: menu engineering guides, seasonal menu planning, happy hour best practices, event promotion calendars, food cost and pricing strategy (high-level, not accounting)
- Retail: seasonal promotions calendar (Christmas, Valentine's, Easter, Mother's Day, EOFY, etc.), clearance timing, new arrival merchandising
- General SMB: slow day strategies, upsell techniques, loyalty program basics, local event marketing

**Signage effectiveness research:**
- Studies on dwell time and content engagement in different venue types
- Research on what makes digital menu boards effective (hierarchy, pricing psychology, photography vs illustrated)
- Seasonal content guidance by industry

**Seasonal calendar (auto-updated):**
- Public holidays (configurable by country/state)
- Retail seasonal calendar (quarterly themes, key shopping events)
- Restaurant seasonal produce calendar (what's in season when)
- Events calendar (major sports, cultural events) — used as context for promos

### 10.3 Fine-Tuning the Co-Business AI

Fine-tune specifically for the quality of **proactive business suggestions** — this is what differentiates it from a search engine.

**Training pair format:**

```jsonc
{
  "business_profile": {
    "type": "restaurant",
    "cuisineType": "Italian",
    "pricePoint": "mid_range",
    "slowDays": ["Monday", "Tuesday"],
    "currentPromotions": ["Happy Hour 4-6pm weekdays"],
    "upcomingEvents": ["Easter long weekend (April 18-21)"],
    "lastContentUpdate": "8 days ago"
  },
  "context": "platform analytics show Tuesday lunch impressions are 40% below Wednesday",
  "ideal_suggestion": "Your Tuesday lunches are consistently quieter. A targeted 'Pasta Tuesday' lunch special shown from 11am on Tuesdays with a $5 discount on pasta dishes has driven measurable traffic for similar Italian venues. Would you like me to create the slide and schedule it for this Tuesday as a trial?"
}
```

**What makes a good suggestion (label your training data by these criteria):**
- ✅ Specific (names a day, a product, a time)
- ✅ Actionable (the AI offers to do something about it)
- ✅ Data-grounded (references actual platform data or known business pattern)
- ✅ Conversational (not a bullet-point report — sounds like a business partner)
- ✅ Appropriately confident — doesn't hedge everything with "might" and "perhaps"
- ❌ Generic ("consider running more promotions")
- ❌ Presumptuous ("your menu strategy is poor")
- ❌ Unactionable on this platform ("you should run social media ads")

### 10.4 Bootstrapping Business Domain Knowledge

The Co-Business AI needs to accumulate business expertise before it can give good advice. Bootstrapping plan:

| Source | Method | Brings in |
|---|---|---|
| **Structured interviews with 5-10 restaurant owners** | Ask them: "what do you wish a business advisor told you? what are the patterns you've learned?" | Real practitioner wisdom, specific to local market |
| **Restaurant and hospitality industry publications** | Export and chunk: restaurant industry reports, menu engineering guides, food cost management articles | Industry benchmarks and best practices |
| **Seasonal calendar construction** | Write a structured document: every month's key events, food/drink trends, and recommended promo themes for each business type | Seasonal intelligence layer |
| **Case studies from the platform** | After 6+ months live: "Bella Vista ran a Truffle Pasta promo on Thursday nights. Sales data showed X. Conclusion: Y" | Real platform evidence for suggestions |
| **Signage effectiveness research** | Academic and industry papers on digital signage ROI, content engagement, menu board design effects on ordering | Scientific grounding for recommendations |

### 10.5 Continuous Business Learning

The Co-Business AI should get smarter about each client's business over time through a memory loop:

```
AI makes suggestion: "Run a Tuesday pasta special"
  │
  Client accepts → slide created → schedule runs
  │
  Analytics: Tuesday impressions +28% next week
  Business Profile update: "Tested Tuesday pasta promo — was effective. Add to seasonal calendar."
  │
  Next time:
  AI: "Last year's Tuesday pasta promo worked well for you. Ready to run it again this winter?"
```

This creates a compounding effect — the AI becomes more effective the longer a client uses it.

---

## 11. How the Two Systems Work Together

The Creative Engine and Co-Business AI form a closed loop:

```
Co-Business AI                          Creative Engine
──────────────                          ────────────────
Observes: Easter long weekend            
  in 4 days, no Easter content running  
  
Suggests: "Create an Easter           → Prompt Builder converts to
  Specials promo for this weekend"       generation prompt
                                         
Client approves                        → Flux.1 generates image
                                         Post-processor applies brand
                                         Vision QA checks quality
                                         Layout Intelligence validates
                                         
Creative Engine outputs finished slide ← Content item created
                                         
Co-Business AI:                        
  Schedules slide to Dining Room        
  screens, Friday–Monday                
  Adds correct priority override        
  (higher than regular menu loop)       
  
  After the weekend:
  Notes impressions data in Business Profile
  "Easter promo generated 240 impressions, 
   above average engagement Friday evening"
  
  Next Easter:
  "Your Easter promo was a success last year.
   Want me to run something similar this year 
   — I already have the template."
```

---

## 12. What Needs to Be Built

### Creative Engine

| Priority | Component | Effort |
|---|---|---|
| P1 | Prompt Builder LLM (fine-tuned on signage prompts) | 3 days |
| P1 | Flux.1 API integration + post-processor pipeline | 2 days |
| P1 | Menu Board data model + HTML/CSS templates (5 layouts) | 4 days |
| P1 | Image variant generation (3 variants per request) | 1 day |
| P2 | Vision QA model (layout + brand + contrast checks) | 3 days |
| P2 | Layout Intelligence (readability simulation, clutter score) | 3 days |
| P2 | Reference image enhancement (phone photo → professional) | 2 days |
| P2 | img2img pipeline (client photo enhancement) | 1 day |
| P3 | Video generation pipeline (LTX-Video + ffmpeg) | 3 days |
| P3 | Video QA checklist (bitrate, codec, loop quality) | 1 day |

### Co-Business AI

| Priority | Component | Effort |
|---|---|---|
| P1 | Business Profile schema + API (CRUD) | 2 days |
| P1 | AI-guided onboarding flow (builds profile on first login) | 2 days |
| P1 | Business domain RAG corpus (seasonal calendar, industry knowledge) | 3 days |
| P1 | Morning digest generation (daily push notification to org owner) | 2 days |
| P2 | Proactive suggestion engine (watches analytics, triggers suggestions) | 4 days |
| P2 | Suggestion feedback loop (accept/reject → updates business profile) | 2 days |
| P2 | Fine-tune on business suggestion training data | 3 days |
| P3 | Event planning module (upcoming events → content planning) | 3 days |
| P3 | Cross-session memory (AI remembers what worked for this client) | 2 days |
| P3 | Industry-specific modules (restaurant, retail, gym, salon) | 2 days each |

---

## 13. Phased Rollout

### Phase A — Creative Foundation (Month 1–2)
- Build Prompt Builder + Flux.1 pipeline
- Build 5 core menu board HTML/CSS templates
- Image variant generation (3 per request)
- AI Studio page in portal

### Phase B — Creative Quality (Month 2–3)
- Vision QA model trained and integrated
- Layout Intelligence (readability + clutter score)
- Reference image enhancement (img2img)
- Video generation (LTX-Video, basic)

### Phase C — Business Intelligence Foundation (Month 3–4)
- Business Profile: schema, API, onboarding flow
- Business domain RAG corpus built (seasonal calendar, industry basics)
- Morning digest (weekly initially, daily in Phase D)

### Phase D — Co-Business Partner (Month 4–6)
- Proactive suggestion engine (analytics-triggered)
- Suggestion acceptance feedback loop
- First fine-tune of Co-Business model
- Event planning module

### Phase E — Deep Personalisation (Month 6+)
- Cross-session memory (AI remembers what worked)
- Industry-specific modules per vertical
- POS correlation analysis (sign → sale correlation)
- Platform-level insights (what works across all similar businesses)

---

*End of document. Best starting point: Prompt Builder + first 5 menu board templates. These immediately deliver visible value — a client creates a professional menu board in 60 seconds instead of hours.*
