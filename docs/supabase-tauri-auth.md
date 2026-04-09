# Supabase auth in Tauri (magic link + deep link + Google OAuth)

## 1. Why the magic link only "works" in the system browser

1. **Email opens the default browser.** The link targets Supabase Auth, which then redirects to whatever **`emailRedirectTo`** you configured. If that was `http://localhost:5173` or your web origin, the **browser** finishes the flow.
2. **Storage is per app.** Supabase JS persists the session in the **browser's** `localStorage` (WebView storage is separate). The Tauri WebView never sees that redirect, so **`getSession()` stays empty** in the desktop app.
3. **No shared process.** The browser and the Tauri app are different processes; there is no automatic sync.

So: **browser login success does not propagate to Tauri** unless you explicitly pass tokens into the app (e.g. deep link).

## 2. How the deep link closes the loop

1. **`emailRedirectTo`** / **`redirectTo`** is set to a **custom scheme** URL in the desktop app: `lecturecompanion://auth-callback` (see `src/lib/authRedirect.ts`).
2. **Supabase** must allow that URL under **Redirect URLs** in the dashboard.
3. After auth, Supabase redirects to that URL with a **PKCE `code`** in the query (or tokens in the hash, depending on flow), which this app handles in **`applySessionFromSupabaseCallbackUrl`**.
4. **macOS / Windows / Linux** resolve `lecturecompanion://...` to your app via the bundle�s URL scheme (Tauri `plugins.deep-link` in `src-tauri/tauri.conf.json`).
5. **`@tauri-apps/plugin-deep-link`** delivers the full URL to JS (`getCurrent` on cold start, `onOpenUrl` when running).
6. **`applySessionFromSupabaseCallbackUrl`** parses the URL and calls `exchangeCodeForSession` or `setSession`, so the session is stored in the **same WebView** as the app.

## 3. Supabase Dashboard � URL configuration (this repo)

**Authentication ? URL Configuration**

| Setting | Local dev (this repo) | Production |
|--------|------------------------|------------|
| **Site URL** | `http://localhost:5173` | `https://your-deployed-origin` |

**Redirect URLs** � add every origin you use, plus the desktop callback. For this project, include at least:

- `http://localhost:5173`  
  (Vite dev server; `vite.config.ts` uses `strictPort: true` on port **5173**.)
- `http://localhost:5173/**`  
  (Optional wildcard if your dashboard supports it; covers hash/query variants.)
- `http://127.0.0.1:5173`  
  (Optional; use if you open the app via `127.0.0.1` instead of `localhost`.)
- **`lecturecompanion://auth-callback`**  
  (**Required** for Tauri: magic link, Google OAuth, and Apple OAuth when `getAuthRedirectUrl()` returns the custom scheme.)

Add your real **production** HTTPS origin(s) when you deploy the web app.

## 4. Google OAuth � Google Cloud + Supabase

### 4.1 Google Cloud Console

1. **APIs & Services ? OAuth consent screen** � configure app name, support email, scopes (`openid`, `email`, `profile` are typical for Sign in with Google).
2. **APIs & Services ? Credentials ? Create credentials ? OAuth client ID**  
   - Application type: **Web application** (Supabase uses this with its callback).
3. Under **Authorized redirect URIs**, add **exactly** (replace `YOUR_PROJECT_REF` with your Supabase project reference from **Project Settings ? API**):

   `https://YOUR_PROJECT_REF.supabase.co/auth/v1/callback`

   This is where **Google** sends the user **after** Google login; **Supabase** then redirects again to your app�s `redirectTo` (`http://localhost:5173` or `lecturecompanion://auth-callback`).

4. **Authorized JavaScript origins** (if the console requires them for your setup) can include:

   - `https://YOUR_PROJECT_REF.supabase.co`
   - `http://localhost:5173` (for local testing flows that touch the web origin)

5. Copy **Client ID** and **Client Secret**.

### 4.2 Supabase � enable Google

**Authentication ? Providers ? Google**

- Turn **Google** on.
- Paste **Client ID** and **Client Secret** from Google Cloud.
- Save.

Ensure section **3** redirect URLs include both **web** and **`lecturecompanion://auth-callback`**.

### 4.3 App behaviour (this repo)

- **Web:** `getAuthRedirectUrl()` ? `window.location.origin` (e.g. `http://localhost:5173`). `signInWithOAuth` uses the default in-tab redirect.
- **Tauri:** `getAuthRedirectUrl()` ? `lecturecompanion://auth-callback`. `signInWithOAuth` uses **`skipBrowserRedirect: true`** and opens the Supabase authorize URL in the **system browser** via `@tauri-apps/plugin-shell` **`open`**, so after Google + Supabase the OS can open your app with the custom-scheme URL (same deep-link path as magic link).

## 5. Apple OAuth

The same **`redirectTo: getAuthRedirectUrl()`** applies. Enable **Sign in with Apple** in Supabase and configure Apple Developer / Services IDs per Apple�s docs; add the same Supabase redirect URLs as in section **3**.

## 6. macOS scheme registration

- **Development / production builds:** Tauri registers the `lecturecompanion` scheme via the app bundle when you run `tauri dev` or `tauri build`.
- **Single instance:** `tauri-plugin-single-instance` (with `deep-link` feature) avoids a second process when the OS hands off `lecturecompanion://` while the app is already running.
