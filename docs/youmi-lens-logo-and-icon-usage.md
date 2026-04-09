# Youmi Lens � Logo, app icon & brand imagery

This document ties **three reference image types** (IP character, corporate logo, app icon) to **product usage**: master lockup, symbol-only mark, and platform icons.

**Reference files (PNG) in this repo:**

| Asset | Role | File |
|--------|------|------|
| Youmi IP | Brand character / mascot | [`docs/assets/brand/youmi-ip-character.png`](./assets/brand/youmi-ip-character.png) |
| Corporate logo | Horizontal lockup (symbol + *Youmi Lens* wordmark) | [`docs/assets/brand/youmi-lens-logo-lockup.png`](./assets/brand/youmi-lens-logo-lockup.png) |
| App icon | Squircle tile, stylised **Y** on deep blue | [`docs/assets/brand/youmi-lens-app-icon.png`](./assets/brand/youmi-lens-app-icon.png) |

Also see [brand-guidelines.md](./brand-guidelines.md) for tokens and the dev style guide.

---

## 1. Three product roles (not three separate brands)

| # | Name | What it is | Typical use |
|---|------|------------|--------------|
| **1** | **Master logo** | **Y symbol + *Youmi Lens* wordmark** (lockup) | Web header, splash, PDF, deck cover |
| **2** | **Symbol only** | **Y** without wordmark | Favicon, small badges, in-app mark when space is tight |
| **3** | **App icon** | **Symbol on branded background** for OS / Dock / Store | `.icns`, `.ico`, Tauri `src-tauri/icons/*` |

All three share the **same Y DNA**: deep sea blue, restrained, light-tech; avoid inventing alternate marks.

---

## 2. Symbol & master logo

- Prefer **vector** (SVG) for web; export **PNG @1x / @2x** where needed.
- **Minimum readable size:** about **24px** height for the symbol in app contexts; below that, prefer **app icon** or simplified symbol rules.
- Do **not** stretch, skew, recolour arbitrarily, or add effects that break the **Y** silhouette.

Below **16px**, use **app icon** or **symbol-only** guidelines rather than the full master lockup.

---

## 3. App icon vs master artwork

### 3.1 Relationship

- The icon **inherits** the **Y** from the master symbol; it is **not** a new logo.
- **Padding:** keep **clear space** (often ~8�16px at 1024px) between the symbol edge and the icon bounding box.
- **Background:** usually **deep blue** (aligned with UI `--yl-primary` / brand); **Y** reads in **light** or **metallic** treatment.

### 3.2 Platform rules (summary)

| Topic | Guidance |
|--------|----------|
| **Legibility** | On Dock, **symbol + background** must read at small sizes; avoid **thin** strokes. |
| **Stroke / weight** | Prefer **~2px** equivalent at 1024px down to 32px. |
| **Contrast** | **Symbol** on **dark** background: pair with **#F8FAFC** (or similar) for **WCAG AA** where text sits on the same colour. |
| **On-light** | Store / slides: use **#F5F7FA** (or similar) background **or** symbol on **dark** tile; do not let the symbol disappear. |

### 3.3 Shape

- **macOS / iOS:** follow **squircle** / superellipse when the platform requires it.
- **Safe area:** symbol **~10�12%** inset from the icon edge unless the brand template says otherwise.

---

## 4. App icon production checklist

1. Start from **master symbol** or **approved** icon asset � **do not** redraw from memory.
2. Export **1024�1024** and then **512 / 256 / 128 / 64 / 32 / 16** as needed.
3. **Roundness** / **mask** should match **Dock** / **macOS** / **Tauri** (`tauri icon` or Xcode asset pipeline).
4. **Padding:** symbol **~8�10%** inset is a common starting point; adjust if the Y feels clipped.
5. **Wordmark** does **not** belong inside the **app icon** (symbol only).

---

## 5. Logo lockup (master)

- **Web header:** cap height often **~120px** max; keep **symbol + wordmark** ratio as in the official lockup.
- **Spacing:** gap between symbol and wordmark follows brand template (e.g. **~0.25�** symbol width).
- **Do not** rotate, outline, or add **drop shadow** unless the brand kit allows a specific variant.
- **Do not** translate **Youmi Lens** or replace the wordmark with ad hoc type.

### 5.1 Youmi (parent) co-branding

- If **Youmi** appears alongside the master logo, follow **parent** guidelines for **size** and **clear space** (e.g. Youmi not smaller than **1/3** of the logo height).

---

## 6. Quality checklist

Before shipping:

- [ ] **Y** is recognisable; **no** accidental mirroring or clipping.
- [ ] **Colour** matches **deep sea** / approved palette.
- [ ] **Contrast** is acceptable on **dark** and **light** contexts.
- [ ] **App icon** works at **small** sizes (Dock / taskbar).
- [ ] **UI** uses **approved** assets (no random screenshots of the logo).
- [ ] **Tauri / desktop** builds include **icons** generated from the **1024** master.

---

## 7. Engineering notes

- **Tauri:** `src-tauri/icons/*` � regenerate with **`npx tauri icon <1024.png>`** from a **1024px** source.
- **Shell / marketing:** prefer **SVG** + **@2x PNG** for crisp headers.

---

**Note:** This file is the **single source** for humans + AI agents; **update** it when marketing ships new **official** PNG/SVG/PDF.
