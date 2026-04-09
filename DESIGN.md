# Youmi Lens DESIGN.md

This project uses a `DESIGN.md` workflow so AI agents can generate UI that stays consistent with the current product language.

Source inspiration: [VoltAgent/awesome-design-md](https://github.com/VoltAgent/awesome-design-md), primarily the `linear.app` profile, adapted for Youmi Lens's current shell and components.

## 1. Visual Theme & Atmosphere

Youmi Lens is a focused, calm productivity app for lecture capture and bilingual summaries.

- Clean, professional UI with low visual noise
- Clear hierarchy for recording status and AI outputs
- Accessibility-first contrast and spacing
- Subtle dark/nav accents, light content surfaces

## 2. Color Palette & Roles

Use semantic roles, not raw colors in prompts.

- `bg.page`: soft neutral page background
- `bg.surface`: cards/modals/panels
- `text.primary`: main readable copy
- `text.muted`: hints, metadata, helper text
- `border.default`: subtle separators
- `brand.primary`: Youmi primary action color
- `state.success`: success badges/messages
- `state.error`: error text and alerts

## 3. Typography Rules

- Font family: system sans stack (`Inter` feel)
- Headings: semibold, tight spacing
- Body: regular, readable line height
- Labels/meta: small uppercase or muted small text
- Keep copy compact and task-oriented

## 4. Component Stylings

### Buttons
- Primary: filled brand button, clear affordance
- Secondary: ghost/outline style for non-destructive actions
- Danger actions must stay visually distinct

### Cards / Panels
- Rounded corners, subtle border
- Use vertical rhythm for dense content (recordings, summaries)
- Avoid heavy shadows; prefer border + surface contrast

### Inputs
- Full-width in forms
- Clear label + helper/error text
- Preserve keyboard-friendly focus states

### Modal Pattern
- Centered dialog
- `max-height` around viewport with internal scrolling
- Background scroll lock while modal is open
- Footer action buttons always reachable

## 5. Layout Principles

- Prioritize recording workflow clarity:
  - left navigation / list
  - center transcript area
  - right summary/actions
- Keep important CTAs above fold when possible
- Prefer progressive disclosure for advanced settings

## 6. Depth & Elevation

- Page < panel < modal hierarchy
- Minimal elevation; avoid dramatic shadow stacks
- Overlays dim background but keep context visible

## 7. Do / Don't

### Do
- Keep defaults product-friendly for normal users
- Hide provider/vendor details in primary UI
- Use concise status messaging for async AI steps

### Don't
- Don't expose technical provider errors directly
- Don't overload main flows with developer-only controls
- Don't introduce inconsistent one-off visual styles

## 8. Responsive Behavior

- Maintain usable recording + summary flows on narrow widths
- Modal content must stay scrollable in short windows
- Ensure action buttons remain reachable on small heights

## 9. Agent Prompt Guide

When asking AI to build/refine UI in this repo, start prompts like:

> Use `DESIGN.md` as the visual source of truth. Keep Youmi Lens style consistent with existing recording workspace, account modal, and summary panels. Preserve semantic color roles and compact productivity layout.

For component tasks:

> Build this component in the Youmi Lens style from `DESIGN.md`, matching existing spacing, border radius, button hierarchy, and muted helper text patterns.

