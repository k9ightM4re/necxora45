# NEXORA — Official Design System Specification (v1.0)

**Identity:** Minimal Architectural Futurism + Editorial Typography + Restrained Glassmorphism + Precise Product Presentation  
**Primary Brand Palette:** Graphite (`#242B35`) · Signal Blue (`#4777DF`) · Soft Amber (`#C49A52`)  
**Default Theme:** Dark (`[data-theme="dark"]`) · **Alternate Theme:** Light (`[data-theme="light"]`)  
**Typography:** Manrope (Headings 500–800) + Inter (UI / Body / Messaging 400–700) + Tabular Figures (`font-variant-numeric: tabular-nums`)

---

## 1. Color Token Architecture & WCAG AA Contrast Audit

### Dark Theme (Default)
| Token | Value | Purpose | Contrast Check |
|---|---|---|---|
| `--nx-bg` | `#101318` | Primary canvas | Base dark ground |
| `--nx-bg-secondary` | `#171C23` | Alternating section / sidebar ground | Subtle depth step |
| `--nx-surface` | `#1D232C` | Cards, panels, incoming message bubbles | Clean elevation |
| `--nx-surface-elevated` | `#242B35` | Graphite structural panels, popovers | Brand Graphite |
| `--nx-primary` | `#4777DF` | Signal Blue highlights, active indicators, links | `5.3:1` vs `#101318` |
| `--nx-primary-hover` | `#3868CE` | Solid primary button fill & hover (`>= 5.2:1` with `#FFFFFF`) | AA Verified (`5.22:1` white text) |
| `--nx-primary-muted` | `rgba(71, 119, 223, 0.14)` | Selected row / active nav tint | Subtle focus |
| `--nx-accent` | `#C49A52` | Soft Amber restrained highlight & agent/verified detail | `7.1:1` vs `#101318` |
| `--nx-accent-muted` | `rgba(196, 154, 82, 0.13)` | Subtle secondary badge surface | Restrained |
| `--nx-text-primary` | `#F2F4F7` | Primary headings & body copy | `16.7:1` vs `#101318` / `12.4:1` vs `#242B35` |
| `--nx-text-secondary` | `#A8B0BB` | Supporting descriptions & secondary labels | `8.5:1` vs `#101318` / `6.1:1` vs `#242B35` |
| `--nx-text-muted` | `#8C96A5` *(base `#77818F` adjusted +1 step for small-text AA on `#242B35`)* | Timestamps, captions, metadata | `>= 4.8:1` across all dark surfaces |
| `--nx-border` | `rgba(255, 255, 255, 0.09)` | Hairline borders & architectural grid lines | Subtle separation |
| `--nx-border-strong` | `rgba(255, 255, 255, 0.15)` | Elevated edges & input focus borders | Crisp framing |

*Note on Primary Button Contrast:* Because `#4777DF` with pure `#FFFFFF` is `4.32:1` (just under `4.5:1`), solid primary CTA buttons use `--nx-primary-fill: #3868CE` (hover `#2F5BB8`) which delivers **`5.22:1` WCAG AA** with `#FFFFFF`, while `--nx-primary: #4777DF` drives icons, links, focus outlines, and active text highlights on dark grounds!

### Light Theme
| Token | Value | Purpose | Contrast Check |
|---|---|---|---|
| `--nx-bg` | `#F5F6F8` | Primary canvas | Soft architectural off-white |
| `--nx-bg-secondary` | `#EBEEF2` | Alternating band / secondary panel | Subtle step |
| `--nx-surface` | `#FFFFFF` | Cards, panels, incoming bubbles | Crisp surface |
| `--nx-surface-elevated` | `#FFFFFF` | Elevated popovers & dialogs | Clean separation |
| `--nx-primary` | `#3868C8` | Primary CTA, links, active nav, outgoing DM bubble | `5.3:1` with `#FFFFFF` |
| `--nx-primary-hover` | `#2D58AD` | Hover primary CTA | `6.7:1` with `#FFFFFF` |
| `--nx-primary-muted` | `rgba(56, 104, 200, 0.09)` | Selected tint | Clean contrast |
| `--nx-accent` | `#A67B38` | Soft Amber editorial highlight | `>= 4.6:1` on `#FFFFFF` (large/UI) |
| `--nx-accent-muted` | `rgba(166, 123, 56, 0.10)` | Soft highlight fill | Subtle detail |
| `--nx-text-primary` | `#202630` | Headings & primary copy | `14.8:1` vs `#FFFFFF` |
| `--nx-text-secondary` | `#596473` | Supporting copy | `5.8:1` vs `#FFFFFF` |
| `--nx-text-muted` | `#697482` *(calibrated from `#828C99` for AA body legibility)* | Metadata & timestamps | `4.65:1` vs `#FFFFFF` |
| `--nx-border` | `rgba(32, 38, 48, 0.09)` | Hairline borders & grid | Crisp light lines |
| `--nx-border-strong` | `rgba(32, 38, 48, 0.15)` | Interactive inputs & active outlines | Clean edges |

---

## 2. Three-Level Glassmorphism System
- **Level 1 — Solid Surfaces:** Main page canvas, feed cards, long prose, message thread history (`background: var(--nx-bg)` or `var(--nx-surface)`).
- **Level 2 — Subtle Glass (`--nx-glass-bg`, `--nx-glass-border`, `--nx-glass-blur`, `--nx-glass-shadow`):** Floating capsule public navbar, hero product preview frame header, selected contextual bars (`backdrop-filter: blur(14px) saturate(130%)`).
- **Level 3 — Floating Glass (`--nx-glass-float-bg`, `--nx-glass-float-shadow`):** Dropdowns, popovers, command palette (`⌘K`), dialogs, floating composer bars. Never nest `backdrop-filter` elements inside each other.

---

## 3. Typography & Fluid Scale
- **Display / Headings:** `'Manrope', -apple-system, BlinkMacSystemFont, sans-serif` (weights `500, 600, 700, 800`), tight tracking (`-0.025em` to `-0.03em`), `text-wrap: balance`.
  - Hero H1: `clamp(2.5rem, 5.2vw, 4.75rem)` (`40px` mobile -> `76px` desktop), `line-height: 1.04`.
  - Section H2: `clamp(2.1rem, 3.6vw, 3.1rem)` (`34px–50px`), `line-height: 1.12`.
- **Interface / Body / Inbox:** `'Inter', -apple-system, BlinkMacSystemFont, sans-serif` (weights `400, 500, 600, 700`).
  - Body: `clamp(0.95rem, 1.1vw, 1.08rem)` (`15–17px`), `line-height: 1.6`.
  - Inbox messages: `14.5px` desktop (`0.906rem`), `line-height: 1.48`, `12px` compact metadata.
- **Loading:** Asynchronous `<link rel="stylesheet">` with `display=swap` + `<link rel="preconnect">`.

---

## 4. Human & AI Identity System
- **Human Identity:** Avatar circle (`32–40px`), Display Name (`Inter 600`), `@username` muted text, optional verified checkmark in Signal Blue, subtle green online status dot only for real online state.
- **AI Agent Identity:** Distinct squared-rounded architectural avatar (`radius: 10px`) with subtle Signal Blue outline, Agent Name, crisp role tag (`Planner`, `Builder`, `Reviewer`, `Analyst`, `Assistant`) paired with explicit `AI Agent` text label (never color-only), and Soft Amber highlight for active/specialized capability state.

---

## 5. Instagram-Inspired Messaging Inbox Spec
- **Desktop Layout:** Clean 2-pane Inbox (`296px–320px` conversation list left + flexible centered active thread) + **on-demand collapsible Info Drawer** (never permanently shrinking the conversation viewport).
- **Conversation Rows:** Compact (`62px` height), circular avatar with presence dot when online, display name, single-line muted preview + relative timestamp, crisp `8px` Signal Blue unread dot.
- **Message Bubbles:**
  - **Incoming:** Solid elevated surface (`--nx-surface-elevated` in dark, `#EBEEF2` in light), `border-radius: 18px 18px 18px 6px`, hairline border.
  - **Outgoing:** Signal Blue fill (`#3868CE` dark / `#3868C8` light) with high-contrast `#FFFFFF` text, `border-radius: 18px 18px 6px 18px`.
  - **Group / Community Channels:** Clean full-width rows preserved for structured team channels while DMs render sleek Instagram-style conversation bubbles with grouped spacing, hover actions (React, Reply, Thread, Pin, Bookmark, Edit/Delete), and compact `Sent` / `Seen` receipts.
- **Mobile Navigation (`<= 900px`):** Native 2-step flow: Conversation List screen -> tap any chat -> Full-screen Active Conversation with explicit `← Inbox` back button in header.
