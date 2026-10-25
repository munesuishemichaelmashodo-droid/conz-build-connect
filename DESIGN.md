# ConZ design system — "site docket"

ConZ should feel like a well-kept delivery docket on a building site: ruled rows,
stamped statuses, big honest numbers, and one orange instruction at a time. This file
records the system as implemented; the tokens live in `src/styles.css` and the shared
components in `src/components/ds/` and `src/components/ui/`.

Specification: the "ConZ premium UI redesign: discovery and proposal" document
(23 Oct 2026). Branch: `design/site-docket`.

## Principles

1. **One orange action per view.** Solid orange (`bg-primary` / `czButtonClass("primary")`)
   marks the single thing to tap. Selected chips, tabs, links and secondary actions are
   never solid orange.
2. **Status first, detail after.** Operational screens open with where things stand
   and what happens next.
3. **Real numbers in real units.** USD, m³, km, minutes, in tabular figures. Estimates are
   labelled. Nothing is invented: no fake counts, reviews, progress or availability.
4. **Docket, not dashboard.** Facts sit in ruled label/value rows (`DocketPanel`,
   `DocketRow`) inside a few panels, not in a separate rounded card per fact.
5. **Built for a cheap phone in sunlight.** 4.5:1 text contrast, 3:1 control borders,
   44 px tap targets, light pages, no decorative motion.

## Themes

Light is the default. Dark is kept and remembered (`localStorage["conz.theme"]`,
set before first paint by the script in `src/routes/__root.tsx`).

There is ONE token set. The `cz-*` tokens are the source of truth; the shadcn names
(`--background`, `--primary`, `--muted-foreground`…) are aliases of them, so older
screens and shadcn components use the same palette as redesigned screens.

### Colour roles

| Role                   | Token                                    | Light              | Dark               | Notes                                          |
| ---------------------- | ---------------------------------------- | ------------------ | ------------------ | ---------------------------------------------- |
| Page                   | `--cz-bg` / `bg-background`              | #faf8f5            | #0f0e0d            | off-white / off-black                          |
| Panel                  | `--cz-surface` / `bg-card`               | #ffffff            | #171513            |                                                |
| Raised / quiet fill    | `--cz-surface-2` / `bg-muted`            | #f3efea            | #211e1b            | chips, inputs at rest                          |
| Hairline               | `--cz-border` / `border`                 | #e7e1da            | #2a2521            | dividers, panel edges                          |
| Strong hairline        | `--cz-border-strong`                     | #d4ccc3            | #3a332e            |                                                |
| Control border         | `--cz-control` / `--input`               | #8a827c            | #7a7069            | 3:1 for inputs, outline buttons                |
| Text                   | `--cz-text` / `text-foreground`          | #1c1815            | #f6f3ef            |                                                |
| Muted text             | `--cz-muted` / `text-muted-foreground`   | #6b635d            | #a39b95            | ≥ 5:1                                          |
| Faint text             | `--cz-faint`                             | #736b65            | #8f8781            | ≥ 4.5:1 on page and panel                      |
| Brand orange (fill)    | `--cz-amber` / `bg-primary`              | #ff7716            | #ff7716            | text on it is ink #0b0907 (7.5:1), never white |
| Orange as text/outline | `--cz-amber-text`                        | #a84300            | #ffa366            | bright orange on light is only 2.5:1           |
| Orange tint            | `--cz-amber-tint`                        | #fff1e6            | #2a1407            | brand stamp, offer highlight                   |
| Success                | `--cz-green-text` on `--cz-green-tint`   | #1a6f3f on #e3f5ea | #7fe0a6 on #0f2a1b |                                                |
| Warning (not orange)   | `--cz-warn-text` on `--cz-warn-tint`     | #8a5a00 on #fff4d6 | #f2c14e on #2b2108 |                                                |
| Danger                 | `--cz-danger-text` on `--cz-danger-tint` | #b2381f on #fbebe8 | #ff9b8a on #2d1410 |                                                |
| Info                   | `--cz-info-text` on `--cz-info-tint`     | #1f5fa8 on #e7f0fb | #9cc7f5 on #0f2033 |                                                |

Rules:

- `text-cz-amber-text` for orange words and icons; `bg-primary` / `bg-cz-amber` only as
  a fill with ink text.
- Warning, danger, success and info always pair colour with an icon and a word.
- No gradients, no glows. `shadow-lift` is a neutral sheet shadow.

## Type

| Use                        | Face                          | Size / line height                                 |
| -------------------------- | ----------------------------- | -------------------------------------------------- |
| Hero (desktop)             | Barlow Condensed 700          | 56 / 1.05                                          |
| Hero (phone), screen title | Barlow Condensed 700          | 38, 30 / 1.1                                       |
| Section                    | Barlow Condensed 700          | 24 / 1.15                                          |
| Money, big numbers         | Barlow Condensed 700, tabular | 22–40                                              |
| Title                      | Inter 600                     | 20 / 1.3                                           |
| Body                       | Inter 400                     | 16 / 1.5                                           |
| Small                      | Inter 400 / 600               | 14 / 1.45                                          |
| Caption                    | Inter 400                     | 12 / 1.4 (never for anything you must read to act) |

- Classes: `cz-display` (or `font-display`) for Barlow; Inter is the default.
- Four font files only: Inter 400 and 600, Barlow Condensed 600 and 700 (self-hosted,
  `src/lib/fonts.ts`). `font-medium` renders as 400 and `font-bold` as 600.
- Sentence case everywhere. No uppercase tracked labels: they break units (m³ → M³)
  and read as template chrome.
- Numbers that line up (prices, m³, km) use `tabular-nums`.

## Space, shape, depth

| Token         | Value                                                                                                                                                                  |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Spacing       | 4 px base: 4 · 8 · 12 · 16 · 24 · 32 · 48 · 64 (Tailwind 1, 2, 3, 4, 6, 8, 12, 16)                                                                                     |
| Phone gutter  | 16 px (20 px on redesigned screens)                                                                                                                                    |
| Radius        | `rounded-sm` / `rounded-md` = 8 (chips, inputs) · `rounded-lg` / `rounded-xl` = 12 (buttons, inner panels) · `rounded-2xl` / `rounded-3xl` = 20 (sheets, outer panels) |
| Depth (dark)  | a lighter surface per level; no shadows                                                                                                                                |
| Depth (light) | hairline borders; one soft shadow for sheets and dialogs only                                                                                                          |
| Breakpoints   | 480 · 768 (two columns) · 1024 (desktop layouts, admin sidebar) · 1280 (content max 1200)                                                                              |
| Motion        | 150 ms press, 250 ms sheets/dialogs; none when `prefers-reduced-motion`                                                                                                |

## Components

| Component                                                  | Where                              | Rule                                                                                                                                                                                     |
| ---------------------------------------------------------- | ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Button` (`ui/button`)                                     | everywhere                         | variants: `default` (orange fill, one per view) · `outline` (neutral control border) · `secondary` (quiet fill) · `ghost` · `destructive` · `link`. Height 44 (sm), 48 (default, lg 52). |
| `czButtonClass` / `CzButton`                               | redesigned screens                 | `primary` · `secondary` (neutral outline) · `ghost` · `danger` · `success`                                                                                                               |
| `Input`, `Textarea`, `Select`                              | forms                              | 48 px, 16 px text (no zoom on iOS), 3:1 control border, label above, help/error below                                                                                                    |
| `Tabs`                                                     | segmented views                    | 44 px triggers, selected = raised neutral, never orange                                                                                                                                  |
| `ChoiceChips` (`ds/`)                                      | material, load size, filters, sort | selected = raised neutral with a check icon                                                                                                                                              |
| `StatusStamp` (`ds/`)                                      | every status                       | icon + word + tone (`neutral`, `info`, `brand`, `success`, `warning`, `danger`)                                                                                                          |
| `jobStamp()` (`lib/status-stamp`)                          | job lists, headers                 | one vocabulary: Open · Driver chosen · On the way · At your site · Delivered · Cancelled                                                                                                 |
| `DocketPanel` + `DocketRow` (`ds/`)                        | facts                              | header strip (title, reference, stamp), ruled label/value rows                                                                                                                           |
| `MoneyFigure` (`ds/`)                                      | prices                             | tabular display numerals, label, "Estimate" flag where it applies                                                                                                                        |
| `LogoLockup` (`ds/`)                                       | every header                       | one lockup: icon + "Con Z" + optional role label                                                                                                                                         |
| `Notice` (`ds/`)                                           | inline alerts                      | info / success / warning / danger with icon; dismissible only when it is safe to dismiss                                                                                                 |
| `BottomSheet`, `Dialog`, `Drawer`                          | overlays                           | sheet on phones, dialog from 768 px                                                                                                                                                      |
| `LoadPicker` (`ds/load-picker`)                            | homepage, /quote, booking          | one control and one set of limits (`lib/load-size`: 0.25–30 m³, quarter steps under 1 m³, presets 10/15/20)                                                                              |
| `Milestones` (`ds/`)                                       | tracking                           | ticks only steps the data proves (`publicStepsDone`); never predicts the next one                                                                                                        |
| `QuickPrice`                                               | homepage, /quote                   | anonymous price check on `computePublicOffer`; result labelled "Estimate"; map loads on first use                                                                                        |
| Bottom navigation (`CustomerBottomNav`, `DriverBottomNav`) | customer and driver                | four items, labelled icons, 56 px; current tab = ink label + tinted icon well                                                                                                            |
| Admin sidebar + tables (`ds/table`)                        | admin ≥ 1024 px                    | grouped sidebar; sortable columns reorder loaded rows only; cards on phones                                                                                                              |

States every screen designs for: loading (skeleton shaped like the content), empty
(what to do next), error (what went wrong and the fix), offline, long text, disabled
(say why).

## Images

Use only photographs the owner has confirmed are licensed for this use, with the
source recorded next to the file. Never present a stock or generated picture as
ConZ's own trucks, drivers or deliveries. Until a confirmed photo exists, screens
lead with real content (the price check, the job docket) instead of a picture.

## Accessibility and performance gates

- WCAG 2.1 AA: text 4.5:1, controls and focus 3:1, no unnamed icon buttons, visible
  focus (`:focus-visible` ring), tap targets 44 px.
- Budgets: shared JavaScript ≤ 170 KB compressed; hero image ≤ 60 KB at 720 px; ≤ 4 font
  files; no animation that is not feedback.
- Verified per phase with the local screenshot harness (360, 390, 768, 1280 px × light
  and dark) and axe-core.

## Do not

- Put more than one solid orange button in a view, or make a selected state orange.
- Show a number that the backend did not produce (prices, ETAs, progress, counts).
- Use white text on orange, bright orange text on light backgrounds, uppercase labels,
  glows or gradients.
- Change pricing, permissions, PIN, payment or tracking logic while restyling.
