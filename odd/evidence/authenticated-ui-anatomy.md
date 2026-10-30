# Authenticated UI anatomy (captured 2026-10-15, user-authorized session)

Method: `claude-in-chrome` on the user's own logged-in Chrome tabs. Only design tokens, geometry and DOM structure were read with `getComputedStyle` / `getBoundingClientRect`. No contact names, messages, e-mails, workspace ids or account data are recorded here.

## Coverage (honest)

| Platform | Result |
| --- | --- |
| respond.io (trial workspace, dark theme, 1920x855 viewport) | Read: global design tokens, left rail, Inbox shell (views sidebar + chat list + empty conversation pane), modal, buttons, cards. |
| respond.io Inbox with conversations, contact inspector, message bubbles | NOT observed: the trial workspace has no channels and no conversations (empty state). |
| respond.io Workflows canvas, Contacts, Lifecycle board | NOT observed: the browser tab group was dissolved before navigating there. |
| respond.io Kanban | Respond has no Kanban pipeline; Lifecycle stages are a sidebar list. Nothing to copy for our Kanban. |
| manychat | NOT observed: the extension returned "Permission denied for this action on this domain" for `app.manychat.com` (needs a site permission grant by the user). |
| mercately | Skipped by the user's decision. |

## Design system

respond.io ships its own "DLS" (design language system): CSS custom properties `--dls-*` (HSL triplets), Tailwind with the `dls:` prefix, Vuetify 3 underneath (`v-col`, `v-overlay`), font `Inter, sans-serif`, 18px line icons. Base `font-size: 16px` on body, but UI text is 14px, labels 12px.

### Dark theme palette (computed on `:root`, converted HSL -> hex)

Surfaces
- `bg-neutral` / `bg-navigation-drawer` `#101113` (rail, app background)
- `bg-foreground-1` `#222225` (panels: views sidebar, chat list)
- `bg-foreground-2` `#2f2f32` (cards, `bg-gray`)
- `bg-foreground-3` `#3e3e41` (hover, `bg-gray-darker`, modal base `rgb(61,61,64)`)
- `bg-foreground-4` `#525256` (pressed)
- `bg-navigation` / `bg-info` `#353c45` (selected row)
- `bg-nav-hover` `#464e59`, `bg-nav-active` `#0058f0`
- `bg-blue-on-hover` `#2c3a58`, `bg-respond-ai` `#312f6a`, `bg-overlay` `#00000066`

Borders
- `border-default` `rgba(182,188,195,0.16)` (all 1px separators), `border-focused` `#bdd6ff3d`, `border-selected` `#6ba4ff`, `border-strong` `#a4a4a8`

Text
- `text-primary` `#cfd3d8`, `text-secondary` `#97a0aa`, `text-tertiary` `#626f7f`, `text-disabled` `#525256`, `text-link` `#4287ff`, `text-selected` `#6ba4ff`

Semantic
- primary `#6ba4ff` (hover `#94bbff`, pressed `#bdd6ff`), danger `#ff5f57`, success `#51d271`, warning `#ffa024`, purple `#c076e5`, Respond AI `#938fff`
- tags: blue `#0049c7`, green `#12451f`, orange `#804600`, purple `#711d9a`, red `#751600`, yellow `#856a00`, grey `#525256`, indigo `#464e59`
- icons: primary `#cfd3d8`, secondary `#808b99`, tertiary `#7a7a7f`, selected `#6ba4ff`

### Light theme (partial, from `:root` HSL; the dark theme was the only one rendered)
`bg-neutral` `#ffffff`, `bg-navigation-drawer`/`bg-blue` `#f0f6ff`, `bg-gray` `#f2f2f3`, `bg-gray-darker` `#e5e5e7`, `bg-gray-pressed` `#cfd0d3`-ish (hsl 240 2% 81%), `bg-avatar`/`bg-info` `#e5efff`, `bg-nav-active` hsl(218 100% 55%), `bg-tooltip` hsl(240 2% 25%). Remaining light tokens were not captured.

## Geometry (px, viewport 1920x855)

| Element | Measured |
| --- | --- |
| Left rail | 48 wide, bg `#101113`, `border-right: 1px solid rgba(182,188,195,.16)` |
| Rail item | about 46x36, radius 8, icon color `#6ba4ff` when active |
| Workspace avatar button (rail top) | 32x32, radius 8, bg `#2f2f32`, at (8,16) |
| Top promo banner | about 52 high, bg `#353c45`-like, 14px text; buttons 28 high |
| Views sidebar | 214 wide (x=48..262), padded 8px, `border-right: 1px solid` default border |
| Sidebar title "Inbox" | 16px / 600 / `#cfd3d8` |
| Sidebar nav row | 198x32, `padding: 0 8px`, radius 8, icon 18x18, label 14px; active row bg `#353c45` + label weight 600 `#cfd3d8`; idle icon `#808b99` |
| Section header ("Lifecycle", "Team Inbox") | 32 high row, label 12px / 600 / `#97a0aa`, collapse chevron at right, "+" for create |
| Lifecycle rows | same 32px rows, leading emoji, 14px text |
| Chat list panel | 299 wide (x=263..562), bg `#222225`, `border-right: 1px solid` default border |
| List tab bar | 44 high; tabs "Chats" / "Calls" 16px / 600; active `#6ba4ff` with underline indicator |
| List filter row | 40 high, `padding: 4px 8px`; sort dropdown 14px/400 `#cfd3d8` ("Open, Newest"), toggle "Unreplied" 12px |
| Empty list text | 12px, `#97a0aa`, centered |
| Conversation pane | remaining width, empty-state illustration + title + primary CTA |
| Primary button | 28 high, radius 8, 14px / 500, bg `#6ba4ff`, text `#000` |
| Secondary (outline) button | 28 high, radius 8, 14px / 500, text `#cfd3d8`, `border: 1px solid rgba(182,188,195,.16)` |
| Card (onboarding accordion row) | 56 high, bg `#2f2f32`, `border: 1px solid rgba(182,188,195,.16)`, radius 8, 14px text |
| Modal | 480x465, bg `rgb(61,61,64)`, radius 8, overlay `rgba(0,0,0,.4)` |
| Title in content | 16px / 600 |

## Structure (DOM hierarchy, Inbox)

```
app shell
 ├─ promo banner (full width, 2 actions)
 └─ row
     ├─ rail 48px (workspace avatar, nav icons, bottom: search, help, notifications, user avatar)
     ├─ views sidebar 214px: title + search/collapse icons
     │    ├─ views: All, Mine, Collaborations, Unassigned, Incoming Calls, Create AI Agent
     │    ├─ section "Lifecycle" (collapsible): stage rows with emoji
     │    ├─ section "Team Inbox" (+ create)
     │    └─ section "Custom Inbox" (+ create)
     ├─ chat list 299px: tabs (Chats | Calls) + icons (filters, search); filter row; list (virtualized)
     └─ conversation pane (+ contact inspector when a chat is open; NOT observed)
```

## What we apply to our app

1. Retune the zinc scale and accent to these exact hex values in dark mode (`#101113`, `#222225`, `#2f2f32`, `#3e3e41`, text `#cfd3d8` / `#97a0aa` / `#626f7f`, primary `#6ba4ff`).
2. 14px base UI text, 12px labels, 8px radius, 28px buttons, 32px nav rows, 18px icons, 48px rail, 214px views sidebar, ~300px list, 1px borders `rgba(182,188,195,.16)`, selected row `#353c45`.
3. Inbox gets the views sidebar (views + Lifecycle section with counts) and the list header/filter row structure.

Not copied: Respond's proprietary assets, illustrations, copy or brand. Only measured geometry and color values are used as design tokens.

## Second extraction attempt (2026-10-15)

What was readable in the user's session:
- respond.io **Inbox**: still the empty trial state (no conversations), so message bubbles, event pills, composer and contact inspector could NOT be measured.
- respond.io **Workflows**: the workspace has no workflow, and opening the canvas requires creating one (a change to the user's account, not done). Only the list/empty page was read:
  - page header 49 high with title 16px/600 `#cfd3d8`, search field left, split primary button "Add Workflow" right (32 high);
  - empty state: title 18.4px/500 white, helper 14px `#757575`, buttons 32 high radius 8: outline blue (`1px solid #6ba4ff`, text `#6ba4ff`, 14px/500) and solid primary (`#6ba4ff`, text `#000`).
- **ManyChat** tab was sitting on a Stripe checkout (`checkout.stripe.com`, live session). It was not read, scripted or interacted with. No flow-builder data exists from ManyChat.

Consequence: the Inbox composer/inspector, workflow canvas and ManyChat node styling in our app remain our own design (only inheriting the measured tokens above). Re-run this extraction after opening a real conversation, a workflow in draft and the ManyChat flow builder.
