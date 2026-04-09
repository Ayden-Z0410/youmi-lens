# Youmi Lens � brand & design assets

Design tokens and previews live under **`src/design-system/`** and do not replace the main app styles until you opt in.

## Brand imagery (official references)

These three files match the asset roles you confirmed; they live in-repo for design / documentation (not wired into the main app UI by default).

| # | Role | File |
|---|------|------|
| 1 | **Youmi IP** � character / mascot (visual personality: deep sea blue, light tech, soft presence) | [`docs/assets/brand/youmi-ip-character.png`](./assets/brand/youmi-ip-character.png) |
| 2 | **Corporate logo** � horizontal lockup (symbol + **Youmi Lens** wordmark) | [`docs/assets/brand/youmi-lens-logo-lockup.png`](./assets/brand/youmi-lens-logo-lockup.png) |
| 3 | **App icon** � squircle tile with stylised **Y** (Dock / Store / favicon source art) | [`docs/assets/brand/youmi-lens-app-icon.png`](./assets/brand/youmi-lens-app-icon.png) |

**Usage hints:** IP is strongest for marketing, onboarding, and empty states; the lockup belongs in headers, splash, and �about�; the app icon is for OS chrome and store listings. See [youmi-lens-logo-and-icon-usage.md](./youmi-lens-logo-and-icon-usage.md) for clearance, sizes, and on-brand colour pairs.

## Related documents

| Doc | Purpose |
|-----|---------|
| [youmi-lens-main-shell-spec.md](./youmi-lens-main-shell-spec.md) | Main window IA / layout + shell behaviour |
| [youmi-lens-logo-and-icon-usage.md](./youmi-lens-logo-and-icon-usage.md) | Master / symbol / app icon usage |
| [supabase-tauri-auth.md](./supabase-tauri-auth.md) | Supabase + deep link auth notes |
| [tauri-desktop-phase0.md](./tauri-desktop-phase0.md) | Tauri desktop phase notes |

## Tokens

| File | Role |
|------|------|
| `src/design-system/tokens.ts` | TypeScript tokens (colors, spacing, type, shadows, etc.) |
| `src/design-system/tokens.css` | CSS variables under `.ds-root` + `.ds-btn` / `.ds-card` |
| `src/design-system/theme.ts` | Thin re-exports over `tokens` |

**Rule:** the main `App` still uses `index.css` / `App.css`. **New UI** should use **`className="ds-root"`** plus `--ds-*` or imports from `tokens.ts` so legacy screens are not overwritten globally.

## Dev style guide

In development, open:

`http://localhost:5173/?styleguide=1`

`main.tsx` renders **`StyleGuideApp`** (no `AuthProvider` / main `App`) when **`import.meta.env.DEV`** is true **and** the query string contains **`styleguide=1`**.

Sections: token swatches, button states, **Login** mock (`LoginPreview`), **Main shell** preview (`MainShellPreview` ? `YoumiLensShell`).

## Shell component

| File | Role |
|------|------|
| `src/components/YoumiLensShell.tsx` | Layout shell (placeholders); not wired to product flows |
| `src/branding/youmiLensShell.css` | Shell layout + `yl-*` classes |

`yl-*` tokens are separate from `--ds-*` today; align or bridge them when you integrate the shell into the real app.

## Suggested file map (phase 6)

```
src/design-system/
  tokens.ts
  tokens.css
  theme.ts
  StyleGuideApp.tsx
  index.ts
  previews/
    LoginPreview.tsx
    MainShellPreview.tsx
```
