---
name: "Nexora Warm Editorial"
description: "A warm, high-contrast editorial design system pairing deep crimson burgundy with ivory cream surfaces for Nexora's Social, Shop, and Learn platform."
---

## Overview

Nexora brings together social discovery, curated shopping, and school-connected learning in one warm, tactile space. The visual language balances editorial poise with everyday clarity: generous ivory breathing room, confident serif headlines in deep crimson burgundy, and crisp sans-serif UI copy.

The aesthetic is **Warm Editorial Modernism** — grounded in an 8px spatial grid, soft warm-tinted card surfaces (`#FFF8EE`) over an ivory canvas (`#FFF0DC`), subtle divider lines (`#E8D3B8`), and zero pure white, pure black, or cool greys.

## Colors

The palette is anchored by deep crimson burgundy (`#790B13`) and warm ivory cream (`#FFF0DC`). Supporting tones stay strictly within the warm burgundy-cream spectrum to maintain editorial cohesion and WCAG AA+ contrast across all text and interactive controls.

- **Primary (`#790B13`)**: Headlines, primary CTAs, active indicators, and full-width brand bands (For Schools, Footer).
- **Primary Hover (`#5C0810`)**: Pressed and hover state for primary burgundy buttons and links.
- **Background (`#FFF0DC`)**: Main page canvas and default section background.
- **Surface (`#FFF8EE`)**: Elevated card surface for pillar cards, pricing tiers, and feature containers.
- **On-Surface (`#2A0A0D`)**: Near-black burgundy for primary body copy and card headings.
- **Muted (`#6B4A4D`)**: Secondary copy, captions, and supporting metadata.
- **Outline (`#E8D3B8`)**: 1px card borders, sticky navbar bottom border, and subtle section dividers.

```yaml
colors:
  primary: "#790B13"
  on-primary: "#FFF0DC"
  primary-hover: "#5C0810"
  primary-soft: "#F7E1D3"
  background: "#FFF0DC"
  on-background: "#2A0A0D"
  surface: "#FFF8EE"
  on-surface: "#2A0A0D"
  surface-alt: "#F7E5CE"
  muted: "#6B4A4D"
  outline: "#E8D3B8"
```

## Typography

Headlines use **Playfair Display** for high-contrast editorial authority, paired with **DM Sans** for clean, legible body copy and interface controls at a 16px minimum body floor. Desktop display scales to 64px and section headings to 40px, stepping down cleanly for mobile viewports.

```yaml
typography:
  display-lg:
    fontFamily: "Playfair Display"
    fontSize: 64px
    fontWeight: 700
    lineHeight: 72px
    letterSpacing: -1px
  display-lg-mobile:
    fontFamily: "Playfair Display"
    fontSize: 32px
    fontWeight: 700
    lineHeight: 38px
    letterSpacing: -0.5px
  headline-lg:
    fontFamily: "Playfair Display"
    fontSize: 40px
    fontWeight: 700
    lineHeight: 48px
    letterSpacing: -0.5px
  headline-lg-mobile:
    fontFamily: "Playfair Display"
    fontSize: 28px
    fontWeight: 700
    lineHeight: 34px
    letterSpacing: -0.25px
  headline-md:
    fontFamily: "Playfair Display"
    fontSize: 28px
    fontWeight: 600
    lineHeight: 36px
    letterSpacing: -0.2px
  title-lg:
    fontFamily: "DM Sans"
    fontSize: 20px
    fontWeight: 600
    lineHeight: 28px
    letterSpacing: 0px
  body-lg:
    fontFamily: "DM Sans"
    fontSize: 18px
    fontWeight: 400
    lineHeight: 28px
    letterSpacing: 0px
  body-md:
    fontFamily: "DM Sans"
    fontSize: 16px
    fontWeight: 400
    lineHeight: 26px
    letterSpacing: 0px
  label-lg:
    fontFamily: "DM Sans"
    fontSize: 16px
    fontWeight: 700
    lineHeight: 20px
    letterSpacing: 0px
  label-md:
    fontFamily: "DM Sans"
    fontSize: 14px
    fontWeight: 600
    lineHeight: 18px
    letterSpacing: 0.1px
  label-sm:
    fontFamily: "DM Sans"
    fontSize: 12px
    fontWeight: 600
    lineHeight: 16px
    letterSpacing: 0.4px
```

## Layout & Spacing

The layout uses a **Fixed-Max-Width Grid** (1200px max container, 12 columns with 24px gutters) on desktop and a **Fluid Single-Column Grid** (20px horizontal page margins) on mobile. All spacing follows a strict 8px grid, with 96px vertical section padding on desktop and 56px on mobile.

```yaml
spacing:
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 32px
  2xl: 48px
  section-mobile: 56px
  section-desktop: 96px
```

## Elevation & Depth

Hierarchy relies on warm tonal contrast (`#FFF0DC` canvas vs `#FFF8EE` card surface), crisp `1px` `#E8D3B8` borders, and soft warm-tinted ambient shadows (`rgba(42, 10, 13, 0.06)`). Never use cool grey shadows or heavy drop shadows. Interactive cards lift by `2px` on hover.

## Shapes

Corner radii are soft and consistent: `12px` for all buttons and inputs, `16px` for cards and feature containers, `24px` for device frames and large showcase panels, and `9999px` for badges, icon circles, and toggles.

```yaml
rounded:
  sm: 8px
  DEFAULT: 12px
  md: 12px
  lg: 16px
  xl: 24px
  full: 9999px
```

## Motion & Micro-interaction

Motion is restrained and warm. Interactive controls respond immediately; section content fades and rises softly on scroll; cards lift `2px` on hover. All motion honors `prefers-reduced-motion` and animates only `transform`, `opacity`, and color.

```yaml
motion:
  state-change:
    duration: 150ms
    delay: 0ms
    timingFunction: ease-out
  card-lift:
    duration: 200ms
    delay: 0ms
    timingFunction: cubic-bezier(0.2, 0, 0, 1)
  section-reveal:
    duration: 400ms
    delay: 0ms
    timingFunction: cubic-bezier(0.2, 0, 0, 1)
```

## Voice & Content Strategy

- **Tone**: Confident, warm, and direct. Short sentences that name concrete actions and benefits without hype or buzzwords.
- **Capitalisation**: Sentence case for headlines, navigation links, buttons, and FAQ questions.
- **Terminology**: Always refer to the three pillars as **Social**, **Shop**, and **Learn**. Refer to partner merchants as **partner stores**.
- **Buttons**: Action-oriented verb phrases ("Get the app", "Register your school", "Register for free", "Explore").

## Components

Component implementations live as individual HTML sticker sheet files in
`components/`. Each file contains the canonical, styled HTML components with
`<!-- COMPONENT: name -->` comment markers. Read each file before use.

- **Accordion** → `@components/accordion.html` — `accordion-single`, `accordion-group`
- **Badge** → `@components/badge.html` — `badge-numeric`, `badge-dot`
- **Button** → `@components/button.html` — `button-primary`, `button-icon`, `button-with-icon`
- **Card** → `@components/card.html` — `card-elevated`, `card-action`, `card-interactive`, `card-interactive-2`
- **Typography** → `@components/typography.html` — `typography-display`, `typography-body`, `typography-label`
