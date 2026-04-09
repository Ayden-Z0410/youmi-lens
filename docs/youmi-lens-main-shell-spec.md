# Youmi Lens � main window shell spec

Describes the **desktop main window** layout implemented in `src/components/YoumiLensShell.tsx` and `src/branding/youmiLensShell.css` (`.yl-shell` and `--yl-*` tokens).

---

## 1. Information architecture

| Zone | Role |
|------|------|
| **Top bar** | Product logo (Y monogram + **Youmi Lens** wordmark) and account actions (e.g. sign out). |
| **Left sidebar** | Workspace nav (Record / Library / Settings) and **Recent** recordings list. |
| **Main column** | Recording strip (course/title, timer, controls), optional hero/settings blocks, **Transcript** (primary focus). |
| **Right column** | **Summary** + notes; detail when a recording is selected. |

**Principle:** Transcript and recording capture are the **default hero**; the summary column supports the session without competing for the same visual weight.

---

## 2. Layout principles

| Principle | Detail |
|-----------|--------|
| **Transcript first** | Live transcript + recording controls are the **primary** work area. |
| **Clear split** | **Transcript** (primary column) and **Summary** (right) are distinct; scroll independently. |
| **Lecture context** | Course/title row and timer communicate **session context**. |
| **Density** | Use labels, spacing, and cards; avoid merging transcript and summary into one flat block. |

---

## 3. Chrome and branding

| Element | Guidance |
|---------|----------|
| **Logo row** | **Y** monogram + **Youmi Lens** wordmark; do not repeat the logo inside the transcript body. |
| **Youmi / companion** | Optional companion strip or toasts (e.g. small avatar) may sit **below** the transcript; optional copy may reference **Youmi** per brand guidelines. |
| **Navigation** | Sidebar + primary nav; **Record** is the default active section when capturing. |
| **Actions** | Recording controls and **Stop & save** / **Discard** stay in the recording strip. |

---

## 4. UI tokens (CSS)

Variables are defined in `src/branding/youmiLensShell.css` on `.yl-shell` (prefix `--yl-`). Examples:

| Token | Example | Usage |
|-------|---------|--------|
| `--yl-primary` | `#0b1f3b` | Top bar, primary actions |
| `--yl-bg-page` | `#f0f3f8` | Page background |
| `--yl-surface` | `#ffffff` | Cards, panels |
| `--yl-secondary` | `#1e3a5f` | Secondary accents |
| `--yl-highlight` | `#c8d7e8` | Highlights |
| `--yl-accent` | `#3d6a9e` | Links, focus ring |
| `--yl-text` | `#0f172a` | Body text |
| `--yl-text-muted` | `#64748b` | Secondary text |
| Transcript panel | `#fbfcfe` + border | Main transcript area |
| Summary column | Card surface + border | Right column |

| State | Style |
|-------|--------|
| Hover | Lighten background (`#eef2f7` / `#c8d7e8` range) |
| Active | Border `#e2e8f0` or emphasis with `#0b1f3b` where needed |
| Focus | `outline: 2px solid #3d6a9e`; `outline-offset: 2px` |

---

## 5. Implementation

- `YoumiLensShell` is a **layout shell** only: content is passed via **props** (`topBarActions`, `sidebar`, `recordingStrip`, `mainExtra`, `transcript`, `rightPanel`, etc.) from `App.tsx` / `RecordingWorkspace`.
- Prefer **`--yl-*`** inside `.yl-shell` for shell chrome; global `:root` tokens must not accidentally override shell colours.

---

## 6. Checklist

- [ ] `RecordingWorkspace` wraps the main UI in `YoumiLensShell`.
- [ ] Shell tokens (`--yl-*`) are not overridden by global `--text` / `--bg` without intent.
