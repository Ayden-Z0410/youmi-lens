import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
  type ChangeEvent,
  type MouseEvent,
  type MutableRefObject,
  type ReactNode,
} from 'react'
import { flushSync } from 'react-dom'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCenter,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragCancelEvent,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { useAuth } from './useAuth'
import { useRecorder, LIVE_WHISPER_SLICE_MS } from './hooks/useRecorder'
import {
  deleteRecordingLocal,
  getAllRecordingsLocalWithBlobs,
  getRecordingDetailLocal,
  getRecordingWithBlob,
  listRecordingsLocal,
  saveRecordingLocal,
  updateRecordingLocal,
} from './lib/db'
import { buildLocalBackupZip, importLocalBackupZip } from './lib/localBackup'
import { getSupabase, isSupabaseConfigured } from './lib/supabase'
import { summarizeRecording, transcribeRecording, translateLiveCaption } from './lib/aiClient'
import { getAiApiBase } from './lib/ai/apiBase'
import {
  hostedRecordingAiStatusLabel,
  liveCaptionBlockedMessage,
  recordingTooLargeUserMessage,
  userFacingGenericProcessingFailure,
  userFacingHostedJobFailure,
  userFacingSummarizeFailure,
  userFacingTranscribeFailure,
} from './lib/aiUserFacing'
import {
  getAiSourceSnapshot,
  getByokApiKey,
  getByokProvider,
  subscribeAiSource,
  usesYoumiHosted,
} from './lib/ai/aiSource'
import { BYOK_PROVIDER_CAPABILITIES } from './lib/ai/providers/types'
import { showDeveloperAiCredentialsUi } from './lib/productAi'
import {
  hostedHealthFromApiJson,
  isHostedAiConfigured,
  isHostedLiveCaptionsPipelineReady,
  isStubAiEnabled,
  type HostedHealthSnapshot,
} from './lib/ai/runtimeMode'
import { requestHostedRecordingAi } from './lib/recordingsAiJob'
import {
  fetchProfile,
  markFirstShellSeen,
  profileNeedsUsernameOnboarding,
  upsertProfileUsername,
  type UserProfileRow,
} from './lib/userProfile'
import { AccountSettingsModal } from './components/AccountSettingsModal'
import { RecordingAudioPlayer } from './components/RecordingAudioPlayer'
import { OnboardingUsername } from './components/OnboardingUsername'
import { whisperLanguageHint } from './lib/whisperLang'
import { AsyncTimeoutError, withTimeout } from './lib/asyncTimeout'
import {
  capturePhaseLabel,
  initialRecordingFlow,
  isCapturePipelinePhase,
  recordingFlowReducer,
  stopSaveButtonLabel,
} from './lib/recordingFlow'
import {
  aiOutcomeToRecent,
  type RecentAiOutcome,
  type RecentCaptureOutcome,
} from './lib/recentOutcomes'
import {
  ledgerClear,
  ledgerMarkDbCommitted,
  ledgerMarkUploaded,
  releaseTabSaveLock,
  tryAcquireTabSaveLock,
} from './lib/saveIdempotency'
import { nextRecentCaptureForNewSave } from './lib/recentCapturePolicy'
import {
  SaveRecordingRemoteError,
  deleteRecordingRemote,
  downloadRecordingBlob,
  getRecordingDetail,
  getRecordingMeta,
  insertLectureRecordingRow,
  lectureAudioStoragePath,
  listRecordings,
  updateRecordingAi,
  uploadLectureAudio,
} from './lib/recordingsRepo'
import { transcribeHostedLiveCaptionChunk } from './lib/liveCaptionHostedTranscribe'
import { transcribeHostedLiveRealtime } from './lib/liveCaptionRealtime'
import { LiveEngine } from './lib/liveEngine/engine'
import { normCaptionSpaces, sanitizeEnglishForZhTranslate } from './lib/liveCaptionSanitize'
import { canonicalizeLectureTranscript } from './lib/transcriptCanonical'
import { youmiLiveLog } from './lib/youmiLiveDebug'
import type { Recording, RecordingDetail } from './types'
import { YoumiLensShell } from './components/YoumiLensShell'
import { YoumiLensMonogramY } from './branding/YoumiLensMonogramY'
import { designTokens } from './design-system/tokens'
import './design-system/tokens.css'
import './App.css'

const KEY_LIVE_LANG = 'lc_live_lang'
const KEY_TRANSLATE = 'lc_translate_target'
const LC_USE_LOCAL_KEY = 'lc_use_local_without_cloud'

type LiveTranslateTarget = 'zh' | 'en' | 'off'
const MAX_WHISPER_BYTES = 25 * 1024 * 1024

const SAVE_UPLOAD_TIMEOUT_MS = 180_000
const SAVE_DB_TIMEOUT_MS = 45_000
const SAVE_LIST_TIMEOUT_MS = 30_000
const SAVE_META_TIMEOUT_MS = 20_000
const AI_DOWNLOAD_TIMEOUT_MS = 120_000
const AI_TRANSCRIBE_TIMEOUT_MS = 420_000
const AI_SUMMARIZE_TIMEOUT_MS = 180_000
const AI_PERSIST_TIMEOUT_MS = 45_000
/** Stop polling after-class Youmi AI job status after this (server Paraformer max ~10m + margin). */
const HOSTED_AI_POLL_MAX_MS = 12 * 60 * 1000

async function getRecordingMetaWithRetry(
  supabase: NonNullable<ReturnType<typeof getSupabase>>,
  userId: string,
  id: string,
  attempts = 5,
  delayMs = 400,
): Promise<{ id: string; storage_path: string; title: string } | null> {
  for (let i = 0; i < attempts; i++) {
    const m = await getRecordingMeta(supabase, userId, id)
    if (m) return m
    if (i < attempts - 1) {
      await new Promise((r) => window.setTimeout(r, delayMs))
    }
  }
  return null
}

/** BCP-47 tags — spoken language for captions (passed to the speech pipeline as a hint). */
const LIVE_LANG_OPTIONS: { value: string; label: string }[] = [
  { value: 'en-US', label: 'English (US)' },
  { value: 'en-GB', label: 'English (UK)' },
  { value: 'zh-CN', label: 'Chinese (Mandarin, simplified)' },
  { value: 'zh-TW', label: 'Chinese (Traditional)' },
  { value: 'ja-JP', label: 'Japanese' },
  { value: 'ko-KR', label: 'Korean' },
]

const LIVE_WHISPER_SLICE_SEC = LIVE_WHISPER_SLICE_MS / 1000

/** Live caption chunk failures: never flash a global red error if captions are already streaming. */
const LIVE_CHUNK_SOFT_STREAK = 4
const LIVE_CHUNK_FATAL_STREAK = 8
/** Default on for hosted builds; set `VITE_USE_LIVE_ENGINE_V2=false` to force legacy slice path. */
const USE_LIVE_ENGINE_V2 = import.meta.env.VITE_USE_LIVE_ENGINE_V2 !== 'false'

/** Trial builds: hide route/engine labels in UI. Dev still shows unless trial or set false explicitly. */
const VITE_TRIAL_BUILD = import.meta.env.VITE_TRIAL_BUILD === 'true'
const VITE_DEBUG_LIVE = import.meta.env.VITE_DEBUG_LIVE === 'true'
/** Console + window.__YL_LIVE_ROUTE__ only when debugging; off for trial and production. */
const LIVE_ROUTE_DIAG_ENABLED =
  !VITE_TRIAL_BUILD && (import.meta.env.DEV || VITE_DEBUG_LIVE)
/** On-screen “Route: …” line for engineers (hidden in trial/public builds). */
const SHOW_LIVE_ROUTE_DEBUG_UI = LIVE_ROUTE_DIAG_ENABLED

function liveRouteDiagLog(...args: unknown[]) {
  if (!LIVE_ROUTE_DIAG_ENABLED) return
  console.info(...args)
}

const LIVE_CAPTIONS_USER_EXPECTATION_EN =
  'Original captions appear first, followed by translation. Captions are generated in segments as you record.'

type LiveRouteState =
  | 'legacy'
  | 'v2_waiting_session'
  | 'v2_blocked_pipeline'
  | 'v2_starting'
  | 'v2_streaming'
  | 'v2_error'

function spokenLanguageLabel(value: string): string {
  return LIVE_LANG_OPTIONS.find((o) => o.value === value)?.label ?? value
}

function formatClock(totalSec: number): string {
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

function segmentSeq(segmentId: string): number {
  // Matches both legacy "seg-N" (batch path) and "stream-N" (DashScope streaming path).
  const m = /^(?:seg|stream)-(\d+)$/.exec(segmentId)
  if (!m) return Number.MAX_SAFE_INTEGER
  return Number(m[1])
}

/** Tokens for overlap: Latin words + short CJK runs (no pure startsWith-only). */
function v2RoughTokens(s: string): string[] {
  const t = s.toLowerCase().trim()
  const out: string[] = []
  for (const w of t.split(/[^a-z0-9]+/)) {
    if (w.length > 1) out.push(w)
  }
  for (const m of t.match(/[\u4e00-\u9fff]{1,14}/g) || []) {
    out.push(m)
  }
  return out
}

function v2LexicalOverlapRatio(a: string, b: string): number {
  const ta = v2RoughTokens(a)
  const tb = v2RoughTokens(b)
  if (ta.length === 0 || tb.length === 0) return 0
  const sa = new Set(ta)
  const sb = new Set(tb)
  let inter = 0
  for (const x of sb) {
    if (sa.has(x)) inter += 1
  }
  return inter / Math.min(sa.size, sb.size)
}

function v2LcpRatio(a: string, b: string): number {
  const p = a.trim().toLowerCase().replace(/\s+/g, ' ')
  const n = b.trim().toLowerCase().replace(/\s+/g, ' ')
  const max = Math.min(p.length, n.length)
  if (max === 0) return 0
  let i = 0
  while (i < max && p[i] === n[i]) i += 1
  return i / max
}

/**
 * True if `next` is a revision / paraphrase of `prev` (same semantic chunk), not a new sentence.
 * Used to avoid polluting committed history with many near-duplicates when ASR/VAD flushes often.
 */
function v2IsSameSemanticChunk(prev: string, next: string): boolean {
  const p = prev.trim()
  const n = next.trim()
  if (!p || !n) return false
  if (p === n) return true
  const pl = p.toLowerCase()
  const nl = n.toLowerCase()
  if (pl === nl) return true
  if (nl.startsWith(pl) || pl.startsWith(nl)) return true
  const compactP = pl.replace(/\s+/g, '')
  const compactN = nl.replace(/\s+/g, '')
  const minCompact = Math.min(compactP.length, compactN.length)
  if (minCompact < 8) {
    return compactN.startsWith(compactP) || compactP.startsWith(compactN)
  }
  const ov = v2LexicalOverlapRatio(p, n)
  if (ov >= 0.5) {
    const maxL = Math.max(p.length, n.length)
    const minL = Math.min(p.length, n.length)
    // Avoid merging a short name/phrase into a much longer unrelated sentence that merely repeats an entity.
    if (maxL > 55 && minL > 0 && maxL / minL > 3.2 && !nl.startsWith(pl) && !pl.startsWith(nl)) {
      return false
    }
    return true
  }
  if (minCompact >= 14 && v2LcpRatio(pl, nl) >= 0.55) return true
  return false
}

function v2PickRicherRevision(prev: string, next: string): string {
  const p = prev.trim()
  const n = next.trim()
  if (!p) return n
  if (!n) return p
  if (n.startsWith(p) || p.startsWith(n)) return n.length >= p.length ? n : p
  return n.length >= p.length ? n : p
}

/** Append to committed chunk list, or replace last chunk when semantically the same utterance. */
function v2MergeChunkIntoHistory(chunks: string[], incoming: string) {
  const t = incoming.trim()
  if (!t) return
  if (chunks.length === 0) {
    chunks.push(t)
    return
  }
  const last = chunks[chunks.length - 1]!
  if (v2IsSameSemanticChunk(last, t)) {
    chunks[chunks.length - 1] = v2PickRicherRevision(last, t)
    return
  }
  chunks.push(t)
}

function v2SyncCommittedStringsFromChunks(
  enChunks: string[],
  zhChunks: string[],
  committedEnRef: { current: string },
  zhFullRef: { current: string },
) {
  committedEnRef.current = enChunks.join(' ').trim()
  zhFullRef.current = zhChunks.join(' ').trim()
}

/** Black-line display: hide last committed chunk when gray draft is the same utterance (revision / extension). */
function v2CommittedForBlackDisplay(chunks: readonly string[], draft: string): string {
  const d = draft.trim()
  if (chunks.length === 0) return ''
  const last = chunks[chunks.length - 1]!
  if (d && v2IsSameSemanticChunk(last, d)) return chunks.slice(0, -1).join(' ').trim()
  return chunks.join(' ').trim()
}

function v2WindowCaptionWords(full: string, maxWords = 150): string {
  const t = full.trim()
  if (!t) return ''
  const words = t.split(/\s+/)
  return words.length > maxWords ? words.slice(-maxWords).join(' ') : t
}

/** Full transcript for save: merge last chunk with draft when semantic duplicate (no "chunk + same chunk"). */
function v2JoinForPersist(chunks: readonly string[], draft: string): string {
  const ch = [...chunks]
  const d = draft.trim()
  if (ch.length === 0) return d
  if (!d) return ch.join(' ').trim()
  const last = ch[ch.length - 1]!
  if (v2IsSameSemanticChunk(last, d)) {
    ch[ch.length - 1] = v2PickRicherRevision(last, d)
    return ch.join(' ').trim()
  }
  return `${ch.join(' ')} ${d}`.trim()
}

/** After this much quiet time, move the open utterance from draft → committed (black). */
const V2_UTTERANCE_IDLE_FLUSH_MS = 1000

/** English gray line: phrase-level display (avoid token-by-token React updates). */
const V2_EN_PHRASE_MIN_CHARS = 7
const V2_EN_PHRASE_MAX_WAIT_MS = 140
const V2_EN_PHRASE_STALE_MIN_DELTA = 2
const V2_EN_PHRASE_FIRST_MIN_CHARS = 4
const V2_EN_PHRASE_FIRST_WAIT_MS = 70
const V2_EN_PHRASE_TICK_MS = 50

function v2EnEndsPhraseBoundary(s: string): boolean {
  const t = s.trimEnd()
  return /[.!?,;:\u2026]\s*$/.test(t)
}

type LibraryDropId = string | 'unfiled'

function toDragTranslate(transform: { x: number; y: number } | null | undefined): string | undefined {
  if (!transform) return undefined
  return `translate3d(${Math.round(transform.x)}px, ${Math.round(transform.y)}px, 0)`
}

function DraggableLectureItem({
  recordingId,
  selected,
  dragging,
  onRowClick,
  suppressItemClickRef,
  children,
}: {
  recordingId: string
  selected: boolean
  dragging: boolean
  onRowClick: (e: MouseEvent<HTMLButtonElement>) => void
  suppressItemClickRef: MutableRefObject<boolean>
  children: ReactNode
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `lecture:${recordingId}`,
    data: { kind: 'lecture', recordingId },
  })

  return (
    <button
      ref={setNodeRef}
      type="button"
      {...listeners}
      {...attributes}
      className={`rec-item ${selected ? 'active' : ''}${dragging || isDragging ? ' is-dragging' : ''}`}
      style={{ transform: toDragTranslate(transform), touchAction: 'none' }}
      onClick={(e) => {
        if (suppressItemClickRef.current) return
        onRowClick(e)
      }}
    >
      {children}
    </button>
  )
}

function DroppableLibraryTarget({
  dropId,
  className,
  activeDropId,
  children,
}: {
  dropId: LibraryDropId
  className: string
  activeDropId: LibraryDropId | null
  children: ReactNode
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `drop:${dropId}`,
    data: { kind: 'library-drop', dropId },
  })

  return (
    <div ref={setNodeRef} className={`${className} ${isOver || activeDropId === dropId ? 'is-drop-target' : ''}`}>
      {children}
    </div>
  )
}

function readForceLocalPreference(): boolean {
  try {
    return localStorage.getItem(LC_USE_LOCAL_KEY) === '1'
  } catch {
    return false
  }
}

function LoginScreen({ auth }: { auth: ReturnType<typeof useAuth> }) {
  const [email, setEmail] = useState('')
  const [emailBusy, setEmailBusy] = useState(false)
  const [emailHint, setEmailHint] = useState<string | null>(null)
  const [emailErr, setEmailErr] = useState<string | null>(null)
  const t = designTokens
  const px = (n: number) => `${n}px`

  const sendMagicLink = async () => {
    setEmailErr(null)
    setEmailHint(null)
    setEmailBusy(true)
    try {
      const { error } = await auth.signInWithEmailOtp(email)
      if (error) setEmailErr(error)
      else
        setEmailHint(
          'Email sent. Check your inbox or spam folder and open the link to sign in.',
        )
    } catch (e) {
      setEmailErr(e instanceof Error ? e.message : 'Request failed')
    } finally {
      setEmailBusy(false)
    }
  }

  return (
    <div
      className="ds-root login-screen"
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: px(t.spacing[8]),
        boxSizing: 'border-box',
      }}
    >
      <header
        style={{
          marginBottom: px(t.spacing[8]),
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: px(t.spacing[4]),
        }}
      >
        <YoumiLensMonogramY size={32} color={t.colors.primary} aria-hidden />
        <span
          style={{
            fontSize: t.fontSize.xl,
            fontWeight: 600,
            letterSpacing: '-0.035em',
            color: t.colors.primary,
          }}
        >
          Youmi Lens
        </span>
      </header>

      <div style={{ width: '100%', maxWidth: 400, position: 'relative', zIndex: 1 }}>
        <div
          className="ds-card login-screen__card"
          style={{
            padding: `${px(t.spacing[6])} ${px(t.spacing[8])}`,
            border: `1px solid ${t.colors.border}`,
            background: t.colors.surface,
          }}
        >
          <h1
            style={{
              margin: `0 0 ${px(t.spacing[3])}`,
              fontSize: t.fontSize.md,
              fontWeight: 600,
              color: t.colors.text,
              letterSpacing: '-0.02em',
            }}
          >
            Sign in to sync recordings
          </h1>
          <p
            style={{
              margin: `0 0 ${px(t.spacing[4])}`,
              fontSize: t.fontSize.sm,
              color: t.colors.textMuted,
              lineHeight: t.lineHeight.relaxed,
            }}
          >
            Recordings are stored in your Supabase project and tied to your account. Sign in on any device
            with the same account to access them.
          </p>

          <label
            htmlFor="login-email"
            style={{
              display: 'block',
              fontSize: t.fontSize.sm,
              fontWeight: 600,
              color: t.colors.text,
              marginBottom: px(t.spacing[2]),
            }}
          >
            Email
          </label>
          <input
            id="login-email"
            type="email"
            className="login-screen__email-input"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            style={{
              width: '100%',
              boxSizing: 'border-box',
              padding: `${px(t.spacing[3])} ${px(t.spacing[4])}`,
              borderRadius: t.radii.lg,
              border: `1px solid ${t.colors.border}`,
              fontSize: t.fontSize.base,
              marginBottom: px(t.spacing[3]),
              background: t.colors.surface,
              color: t.colors.text,
              caretColor: t.colors.accent,
            }}
          />
          <button
            type="button"
            className="ds-btn ds-btn--primary"
            style={{ width: '100%' }}
            disabled={emailBusy || !email.trim()}
            onClick={() => void sendMagicLink()}
          >
            {emailBusy ? 'Sending…' : 'Send sign-in link'}
          </button>
          {emailHint && (
            <p style={{ marginTop: px(t.spacing[3]), fontSize: t.fontSize.sm, color: t.colors.textMuted }}>
              {emailHint}
            </p>
          )}
          {emailErr && (
            <p style={{ marginTop: px(t.spacing[2]), color: t.colors.danger, fontSize: t.fontSize.sm }}>
              {emailErr}
            </p>
          )}
        </div>
      </div>

      {/*
        Dev note (not shown in UI): local-only mode — clear VITE_SUPABASE_ANON_KEY in .env, restart dev server,
        pick local mode on the setup screen. Optional: show in UI only when import.meta.env.DEV if needed.
      */}
    </div>
  )
}

function CloudSetupSplash({ onUseLocal }: { onUseLocal: () => void }) {
  return (
    <div className="app narrow">
      <header className="hero">
        <p className="eyebrow">Youmi Lens</p>
        <h1>Save recordings with an account (recommended)</h1>
        <p className="lede">
          After you sign in, recordings and transcripts live in your Supabase project. Use the same account on
          any browser or machine. You only need to do the steps below once.
        </p>
      </header>
      <section className="panel">
        <h2>1. Create a Supabase project</h2>
        <p className="hint small">
          Open{' '}
          <a href="https://supabase.com/dashboard" target="_blank" rel="noreferrer">
            supabase.com/dashboard
          </a>{' '}
          and create a project. In <strong>Project Settings → API</strong>, copy the <code>Project URL</code> and{' '}
          <code>anon public</code> key.
        </p>
        <h2>2. Enable email sign-in (optional but recommended)</h2>
        <p className="hint small">
          In <strong>Authentication → Providers</strong>, turn on <strong>Email</strong> (magic link).
        </p>
        <h2>3. Configure this repo&apos;s <code>.env</code></h2>
        <pre
          className="scroll subtle"
          style={{
            padding: '0.75rem 1rem',
            borderRadius: 8,
            border: '1px solid var(--border)',
            overflow: 'auto',
            fontSize: '0.85rem',
          }}
        >
          {`VITE_SUPABASE_URL=https://xxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbG...`}
        </pre>
        <p className="hint small">
          Save the file, then run <code>npm run dev</code> again so Vite picks up the variables.
        </p>
        <button type="button" className="btn primary wide" onClick={() => window.location.reload()}>
          I&apos;ve configured it — reload
        </button>
      </section>
      <section className="panel">
        <h2>Local-only (no sign-in)</h2>
        <p className="hint small">
          Data stays in this browser&apos;s IndexedDB only. You may lose it if you switch browsers or clear site
          data. Use ZIP backup on this page, or add Supabase later and reload.
        </p>
        <button type="button" className="btn secondary wide" onClick={onUseLocal}>
          Continue in local mode
        </button>
      </section>
    </div>
  )
}

export default function App() {
  const auth = useAuth()
  const supabase = getSupabase()
  const cloudReady = isSupabaseConfigured()
  const [forceLocalWithoutCloud, setForceLocalWithoutCloud] = useState(readForceLocalPreference)

  const authUiGateLogged = useRef<string>('')
  useEffect(() => {
    let gate: string
    let detail: Record<string, unknown>
    if (!cloudReady) {
      gate = 'cloud-setup-or-local'
      detail = { screen: gate, cloudReady: false }
    } else if (auth.loading) {
      gate = 'loading-session'
      detail = { screen: gate, loading: true }
    } else if (!auth.session || !auth.user || !supabase) {
      gate = 'login'
      detail = {
        screen: gate,
        hasSession: Boolean(auth.session),
        hasUser: Boolean(auth.user),
        hasSupabaseClient: Boolean(supabase),
      }
    } else {
      gate = 'recording-workspace'
      detail = { screen: gate, userIdPrefix: auth.user.id.slice(0, 8) }
    }
    if (authUiGateLogged.current !== gate) {
      authUiGateLogged.current = gate
      console.info('[lc-auth ui] render gate', detail)
    }
  }, [cloudReady, auth.loading, auth.session, auth.user, supabase])

  if (!cloudReady) {
    if (!forceLocalWithoutCloud) {
      return (
        <CloudSetupSplash
          onUseLocal={() => {
            try {
              localStorage.setItem(LC_USE_LOCAL_KEY, '1')
            } catch {
              /* ignore */
            }
            setForceLocalWithoutCloud(true)
          }}
        />
      )
    }
    return (
      <RecordingWorkspace
        localOnly
        userLabel="Local mode: recordings stay in this browser (IndexedDB)"
        onReloadAfterCloudEnv
      />
    )
  }

  if (auth.loading) {
    return (
      <div className="app narrow">
        <p className="muted">Loading session…</p>
      </div>
    )
  }

  if (!auth.session || !auth.user || !supabase) {
    return <LoginScreen auth={auth} />
  }

  return (
    <AuthenticatedApp
      key={auth.user.id}
      supabase={supabase}
      userId={auth.user.id}
      userEmail={auth.user.email ?? null}
      userLabel={auth.user.email ?? auth.user.user_metadata?.full_name ?? 'Account'}
      onSignOut={() => void auth.signOut()}
    />
  )
}

function AuthenticatedApp({
  supabase,
  userId,
  userEmail,
  userLabel,
  onSignOut,
}: {
  supabase: NonNullable<ReturnType<typeof getSupabase>>
  userId: string
  userEmail: string | null
  userLabel: string
  onSignOut: () => void
}) {
  const [profile, setProfile] = useState<UserProfileRow | null>(null)
  const [profileLoading, setProfileLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    void fetchProfile(supabase, userId).then((row) => {
      if (!cancelled) {
        setProfile(row)
        setProfileLoading(false)
      }
    })
    return () => {
      cancelled = true
    }
  }, [supabase, userId])

  const welcomeLine = useMemo(() => {
    if (!profile || profileNeedsUsernameOnboarding(profile)) return undefined
    const name = profile.username!.trim()
    return profile.first_shell_seen_at ? `Welcome back, ${name}` : `Welcome, ${name}`
  }, [profile])

  useEffect(() => {
    if (!profile || profileNeedsUsernameOnboarding(profile)) return
    if (profile.first_shell_seen_at) return
    void markFirstShellSeen(supabase, userId).then(() => {
      void fetchProfile(supabase, userId).then(setProfile)
    })
  }, [profile, supabase, userId])

  if (profileLoading) {
    return (
      <div className="app narrow">
        <p className="muted">Loading profile…</p>
      </div>
    )
  }

  if (profileNeedsUsernameOnboarding(profile)) {
    return (
      <OnboardingUsername
        key={userId}
        userId={userId}
        supabase={supabase}
        initialUsername={profile?.username ?? null}
        onSubmit={async (username, phone) => {
          const { error } = await upsertProfileUsername(supabase, userId, { username, phone })
          if (!error) {
            const row = await fetchProfile(supabase, userId)
            setProfile(row)
          }
          return { error }
        }}
      />
    )
  }

  return (
    <RecordingWorkspace
      supabase={supabase}
      userId={userId}
      userLabel={userLabel}
      userEmail={userEmail}
      profileRow={profile}
      onProfileRowChange={setProfile}
      onSignOut={onSignOut}
      welcomeLine={
        welcomeLine ??
        (profile?.username?.trim() ? `Welcome, ${profile.username.trim()}` : 'Welcome')
      }
    />
  )
}

function recentCaptureHeadline(c: RecentCaptureOutcome): string {
  if (!c) return ''
  if (c.kind === 'success') return 'Saved'
  if (c.kind === 'list_refresh_warn') return 'Saved (list refresh issue)'
  if (c.kind === 'failure') {
    if (c.outcome === 'storage_failed') return 'Upload failed'
    if (c.outcome === 'storage_ok_db_failed') return 'Uploaded; database write failed'
    if (c.outcome === 'db_ok_verify_failed') return 'Saved; verification read failed'
    if (c.outcome === 'local_failed') return 'Local save failed'
    return 'Save incomplete'
  }
  return ''
}

function recentAiHeadline(c: RecentAiOutcome): string {
  if (!c) return ''
  if (c.kind === 'success') return 'Transcription and summaries ready'
  if (c.kind === 'transcribe_failed') return 'Recording saved; transcription failed'
  if (c.kind === 'summarize_failed') return 'Recording saved; summarization failed (transcript kept)'
  if (c.kind === 'persist_failed') return 'Recording saved; failed to save transcript/summaries'
  return 'Processing incomplete'
}

/** Collapsible transcript/summary body; remount with key to reset open state per recording. */
function CollapsibleResultBlock({
  title,
  status,
  children,
}: {
  title: string
  status?: string
  children: ReactNode
}) {
  const [open, setOpen] = useState(true)
  return (
    <div className={`result-collapsible ${open ? 'is-open' : ''}`}>
      <button
        type="button"
        className="result-collapsible__header"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <span className="result-collapsible__header-main">
          <span className="result-collapsible__chevron" aria-hidden>
            ▸
          </span>
          <span className="result-collapsible__title">{title}</span>
        </span>
        {status ? <span className="result-collapsible__status">{status}</span> : null}
      </button>
      {open ? <div className="result-collapsible__body">{children}</div> : null}
    </div>
  )
}

function RecordingWorkspace({
  localOnly = false,
  supabase,
  userId,
  userLabel,
  userEmail = null,
  profileRow = null,
  onProfileRowChange,
  onSignOut,
  onReloadAfterCloudEnv,
  welcomeLine,
}: {
  localOnly?: boolean
  supabase?: NonNullable<ReturnType<typeof getSupabase>>
  userId?: string
  userLabel: string
  /** Cloud: signed-in email for account panel (readonly). */
  userEmail?: string | null
  /** Cloud: current profile row for account panel. */
  profileRow?: UserProfileRow | null
  onProfileRowChange?: (row: UserProfileRow | null) => void
  onSignOut?: () => void
  /** After user adds Supabase to .env, reload to switch to login + cloud. */
  onReloadAfterCloudEnv?: boolean
  /** Top bar welcome; cloud mode only */
  welcomeLine?: string
}) {
  const devCredentialsUi = showDeveloperAiCredentialsUi()
  const aiStoreTick = useSyncExternalStore(
    subscribeAiSource,
    getAiSourceSnapshot,
    getAiSourceSnapshot,
  )
  void aiStoreTick
  const usesHosted = usesYoumiHosted()
  const byokKey = getByokApiKey().trim()
  const byokReady = !usesHosted && byokKey.length > 0
  const byokProvider = getByokProvider()
  const byokTranscribeOk = BYOK_PROVIDER_CAPABILITIES[byokProvider].transcribe
  const [hostedHealth, setHostedHealth] = useState<HostedHealthSnapshot | null>(null)
  const [hostedHealthUnreachable, setHostedHealthUnreachable] = useState(false)
  const hostedConfigured = isHostedAiConfigured(hostedHealth)
  const stubMode = isStubAiEnabled(hostedHealth)
  /** Cloud Youmi: health not fetched yet — treat pipeline as available until /health proves otherwise (avoids dead UI on login). */
  const optimisticCloudYoumiHealthLoading = !localOnly && usesHosted && hostedHealth === null
  /** Lecture processing + summaries (separate from live chunk pipeline). */
  const postClassAiEnabled = usesHosted
    ? optimisticCloudYoumiHealthLoading || hostedConfigured || stubMode
    : byokReady
  /** Live captions only: hosted stub/liveCaptions capability, or BYOK with speech-to-text. */
  const liveCaptionsPipelineEnabled = usesHosted
    ? optimisticCloudYoumiHealthLoading
      ? true
      : isHostedLiveCaptionsPipelineReady(hostedHealth)
    : byokReady && byokTranscribeOk
  const hostedUnavailableMessage =
    hostedHealthUnreachable
      ? 'Local AI server is not running. Start it with `npm run dev` (or `npm run dev:server`) and reload.'
      : !localOnly && usesHosted && hostedHealth !== null && !hostedConfigured && !stubMode
      ? 'Youmi AI is not available on this device yet.'
      : null

  const refreshHostedHealth = useCallback(async () => {
    if (localOnly) return
    try {
      const r = await fetch(`${getAiApiBase()}/health`)
      const j = (await r.json()) as unknown
      setHostedHealth(hostedHealthFromApiJson(j))
      setHostedHealthUnreachable(false)
    } catch {
      setHostedHealth(null)
      setHostedHealthUnreachable(!localOnly && usesHosted)
    }
  }, [localOnly, usesHosted])

  /** Mount + whenever AI source snapshot changes: re-fetch /health so Youmi/BYOK switches see fresh capability. */
  useEffect(() => {
    if (localOnly) return
    let cancelled = false
    void (async () => {
      try {
        const r = await fetch(`${getAiApiBase()}/health`)
        const j = (await r.json()) as unknown
        if (!cancelled) {
          setHostedHealth(hostedHealthFromApiJson(j))
          setHostedHealthUnreachable(false)
        }
      } catch {
        if (!cancelled) {
          setHostedHealth(null)
          setHostedHealthUnreachable(!localOnly && usesHosted)
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [localOnly, aiStoreTick])

  const onLiveAudioChunkRef = useRef<((blob: Blob, mime: string) => void) | null>(null)
  const onLivePcmChunkRef = useRef<((buffer: ArrayBuffer, sampleRate: number) => void) | null>(null)
  /** Cloud live captions: one Storage prefix per recording session (before recording row exists). */
  const liveCaptionSessionIdRef = useRef<string | null>(null)
  const liveChunkIndexRef = useRef(0)
    /** Youmi hosted live captions: batch a few ~3s slices, tuned for lower latency with stable output. */
  const youmiLiveBatchPartsRef = useRef<Blob[]>([])
  const youmiLiveBatchBytesRef = useRef(0)
  const youmiLiveBatchMimeRef = useRef<string>('')
  const youmiLiveBatchStartedAtRef = useRef<number | null>(null)
  const youmiLiveBatchFlushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** Warm-up: first one/two batches flush earlier to reduce first-caption latency. */
  const youmiLiveWarmupBatchesSentRef = useRef(0)
  /** Avoid stale closure: timer uses the latest queue fn. */
  const youmiLiveQueueTranscribeRef = useRef<
    ((blob: Blob, mime: string, reason: string) => void) | null
  >(null)
  const liveTranscribeQueueRef = useRef<Array<{ seq: number; blob: Blob; mime: string; reason: string }>>([])
  const liveTranscribeInFlightRef = useRef(0)
  const liveTranscribeSeqIssuedRef = useRef(0)
  const liveTranscribeSeqCommitRef = useRef(0)
  const liveTranscribePiecesRef = useRef(new Map<number, string>())
  const resetLiveTranscribeRuntime = useCallback(() => {
    liveTranscribeQueueRef.current = []
    liveTranscribeInFlightRef.current = 0
    liveTranscribeSeqIssuedRef.current = 0
    liveTranscribeSeqCommitRef.current = 0
    liveTranscribePiecesRef.current.clear()
  }, [])
  /** When hosted post-class job is queued/transcribing/summarizing — for max poll duration. */
  const hostedAiPollStartedAtRef = useRef<number | null>(null)
  /** Local A/B: set `VITE_EXPERIMENT_SKIP_YOUMI_LIVE_SLICE=true` to disable only the live slice loop in Youmi AI mode (main track unchanged). */
  const experimentSkipYoumiLiveSlice =
    import.meta.env.VITE_EXPERIMENT_SKIP_YOUMI_LIVE_SLICE === 'true'
  const recorder = useRecorder({
    onLiveAudioChunkRef,
    onPcmChunkRef: onLivePcmChunkRef,
    // Skip the MediaRecorder blob-slice cycle when PCM streaming drives the live engine (v2 path).
    experimentalSkipLiveSlice: (USE_LIVE_ENGINE_V2 && usesHosted) || (experimentSkipYoumiLiveSlice && usesHosted),
  })

  const [flow, dispatchFlow] = useReducer(recordingFlowReducer, initialRecordingFlow)
  const [recentCapture, setRecentCapture] = useState<RecentCaptureOutcome>(null)
  const [recentAi, setRecentAi] = useState<RecentAiOutcome>(null)

  /** In-flight capture only; terminal outcomes use `recentCapture` / `recentAi`. */
  const saveOrFinishBusy = isCapturePipelinePhase(flow.phase) || flow.phase === 'stopping'

  const liveCaptionSessionActive =
    recorder.status === 'recording' || recorder.status === 'paused'
  const useLiveEngineV2 = USE_LIVE_ENGINE_V2 && usesHosted
  const [liveRouteState, setLiveRouteState] = useState<LiveRouteState>('legacy')

  const liveCaptionSessionSurface = useMemo(() => {
    if (!liveCaptionSessionActive) return null
    if (liveCaptionsPipelineEnabled) return null
    if (usesHosted && hostedHealth === null) return null

    if (usesHosted) {
      if (!hostedConfigured && !stubMode) {
        return { tier: 'fatal' as const, text: 'Youmi AI setup is not available yet.' }
      }
      if ((hostedConfigured || stubMode) && !stubMode && hostedHealth?.liveCaptions !== true) {
        return {
          tier: 'info' as const,
          text: 'Live captions are not available for Youmi AI in this environment yet. Recording continues — use Generate transcript & summaries after class for the full transcript.',
        }
      }
    } else {
      if (!byokReady) {
        return {
          tier: 'fatal' as const,
          text: liveCaptionBlockedMessage(false, devCredentialsUi, false),
        }
      }
      if (!byokTranscribeOk) {
        return {
          tier: 'info' as const,
          text: 'Your advanced connection type does not support speech-to-text for live captions. Change the connection type in Account or switch to Youmi AI.',
        }
      }
    }
    return null
  }, [
    liveCaptionSessionActive,
    liveCaptionsPipelineEnabled,
    usesHosted,
    hostedHealth,
    hostedConfigured,
    stubMode,
    byokReady,
    byokTranscribeOk,
    devCredentialsUi,
  ])

  const [liveLang, setLiveLang] = useState(() => {
    if (typeof localStorage === 'undefined') return 'en-US'
    return localStorage.getItem(KEY_LIVE_LANG) || 'en-US'
  })

  const [translateTarget, setTranslateTarget] = useState<LiveTranslateTarget>(() => {
    if (typeof localStorage === 'undefined') return 'zh'
    const s = localStorage.getItem(KEY_TRANSLATE)
    if (s === 'zh' || s === 'en' || s === 'off') return s
    const lang = localStorage.getItem(KEY_LIVE_LANG) || 'en-US'
    return lang.startsWith('zh') ? 'en' : 'zh'
  })

  const [secondaryCaption, setSecondaryCaption] = useState('')
  const [secondaryCaptionDraft, setSecondaryCaptionDraft] = useState('')
  const onFinalPhraseRef = useRef<((phrase: string) => void) | null>(null)
  const onDraftPhraseRef = useRef<((phrase: string) => void) | null>(null)
  const liveEngineRef = useRef<LiveEngine | null>(null)
  /** Committed English (black / history only) — never mutated by interim refinements. */
  const v2CommittedEnRef = useRef('')
  /** Chunk list backing `v2CommittedEnRef` — merged for semantic de-duplication on flush. */
  const v2CommittedEnChunksRef = useRef<string[]>([])
  /** Chunk list backing `secondaryCaptionFullRef` for zh committed history. */
  const v2CommittedZhChunksRef = useRef<string[]>([])
  /** Single open English utterance (gray) — replaced by interims/finals until flush. */
  const v2CurrentEnUtteranceRef = useRef('')
  /** Single open Chinese utterance (gray), aligned to the same logical utterance as EN. */
  const v2CurrentZhUtteranceRef = useRef('')
  /** `segmentSeq(segmentId)` for the utterance currently in the draft slots; -1 = none. */
  const v2OpenUtteranceSeqRef = useRef(-1)
  const v2UtteranceIdleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** Per segmentId: last applied en_interim rev (drops duplicate/out-of-order within segment only). */
  const v2LastEnInterimRevBySegRef = useRef(new Map<string, number>())
  /** Per segmentId: last applied zh_interim rev (drops stale/out-of-order interim translations). */
  const v2LastZhInterimRevBySegRef = useRef(new Map<string, number>())
  /** Latest English draft text (ref mirror for save path). */
  const v2EnDraftTextRef = useRef('')
  const v2EnDraftRafRef = useRef<number | null>(null)
  const v2ZhDraftTextRef = useRef('')
  const v2ZhDraftRafRef = useRef<number | null>(null)
  // Tracks segments whose zh_final has already committed. Used to discard in-flight
  // stale zh_interim translations that resolve after zh_final for the same segment.
  const v2FinalizedZhSegIds = useRef(new Set<string>())
  /** Gray EN phrase display: last segmentId we applied phrase state for. */
  const v2EnPhraseLastSegmentIdRef = useRef('')
  /** Length of `v2EnDraftTextRef` last pushed to `primaryCaptionDraft`. */
  const v2EnPhraseDisplayedLenRef = useRef(0)
  const v2EnPhraseLastFlushAtRef = useRef(0)
  const v2EnPhraseTickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** Last raw EN string passed to `setPrimaryCaptionDraft` (what the user actually sees in gray). */
  const v2EnGrayVisibleRef = useRef('')
  /** Buffered zh_interim until gray EN (sanitized) covers the translation source. */
  const v2PendingZhInterimRef = useRef<{
    segmentId: string
    sourceEn: string
    text: string
    rev: number
  } | null>(null)
  /** Sanitized EN final text per segment — must match zh_final.sourceEn before committing ZH. */
  const v2LastEnFinalSanitizedBySegRef = useRef(new Map<string, string>())

  // Retained for future use (paragraph block separation, currently disabled).
  const lastFinalTimestampRef = useRef(0)

  const [primaryCaption, setPrimaryCaption] = useState('')
  const [primaryCaptionDraft, setPrimaryCaptionDraft] = useState('')
  const primaryCaptionRef = useRef('')
  /** Full zh transcript for live v2 (state is windowed to 150 words). */
  const secondaryCaptionFullRef = useRef('')
  /** Session-level banners are derived in `liveCaptionSessionSurface`; this is only for per-chunk issues. */
  const [liveCaptionChunkNotice, setLiveCaptionChunkNotice] = useState<{
    kind: 'soft' | 'fatal'
    message: string
  } | null>(null)
  const liveChunkFailStreakRef = useRef(0)
  const [liveCaptionPendingSlices, setLiveCaptionPendingSlices] = useState(0)
  const v2PushCountRef = useRef(0)
  const [accountSettingsOpen, setAccountSettingsOpen] = useState(false)

  useEffect(() => {
    if (!LIVE_ROUTE_DIAG_ENABLED) return
    const snapshot = {
      USE_LIVE_ENGINE_V2,
      useLiveEngineV2,
      usesHosted,
      liveCaptionsPipelineEnabled,
      recorderStatus: recorder.status,
    }
    liveRouteDiagLog('[LiveEngine][diag] route snapshot', JSON.stringify(snapshot))
    ;(window as unknown as { __YL_LIVE_ROUTE__?: unknown }).__YL_LIVE_ROUTE__ = snapshot
  }, [useLiveEngineV2, usesHosted, liveCaptionsPipelineEnabled, recorder.status])

  /** LiveEngine v2 only: hearing / drafting / refining so the panel never feels "stuck on spinner". */
  const liveV2CaptionPhase = useMemo(() => {
    if (!useLiveEngineV2) return null
    if (recorder.status === 'paused') return 'paused' as const
    if (recorder.status !== 'recording') return null
    const hasDraft = Boolean(primaryCaptionDraft.trim())
    const hasFinal = Boolean(primaryCaption.trim())
    // Streaming mode: derive phase from caption text state (no pending-slice counter needed).
    // "hearing"  = recording active, nothing shown yet — first words in flight
    // "drafting" = interim text visible and updating in real-time
    // "refining" = sentence finalized, waiting for next sentence
    if (!hasDraft && !hasFinal) return 'hearing' as const
    if (hasDraft) return 'drafting' as const
    return 'refining' as const
  }, [
    useLiveEngineV2,
    recorder.status,
    primaryCaptionDraft,
    primaryCaption,
  ])
  const persistTranslateTarget = useCallback((value: LiveTranslateTarget) => {
    setTranslateTarget(value)
    localStorage.setItem(KEY_TRANSLATE, value)
  }, [])

  const prevRecorderStatusRef = useRef(recorder.status)
  useEffect(() => {
    if (prevRecorderStatusRef.current === 'idle' && recorder.status === 'recording') {
      liveChunkFailStreakRef.current = 0
      setLiveCaptionChunkNotice(null)
    }
    prevRecorderStatusRef.current = recorder.status
  }, [recorder.status])

  useEffect(() => {
    if (liveCaptionsPipelineEnabled) setLiveCaptionChunkNotice(null)
  }, [liveCaptionsPipelineEnabled])

  useEffect(() => {
    setSecondaryCaption('')
    setSecondaryCaptionDraft('')
    secondaryCaptionFullRef.current = ''
    v2CommittedZhChunksRef.current = []
    v2CurrentZhUtteranceRef.current = ''
  }, [translateTarget])

  useEffect(() => {
    if (liveCaptionSessionActive) return
    // Session ended: ensure batching timer cannot fire later.
    if (youmiLiveBatchFlushTimerRef.current) {
      clearTimeout(youmiLiveBatchFlushTimerRef.current)
      youmiLiveBatchFlushTimerRef.current = null
    }
    youmiLiveQueueTranscribeRef.current = null
  }, [liveCaptionSessionActive])

  useLayoutEffect(() => {
    if (useLiveEngineV2) {
      setLiveRouteState(liveCaptionSessionActive ? 'v2_starting' : 'v2_waiting_session')
      liveRouteDiagLog(
        '[LiveEngine][diag] v2 branch selected; legacy chunk handler detached',
        JSON.stringify({ liveCaptionSessionActive }),
      )
      onLiveAudioChunkRef.current = null
      return
    }
    setLiveRouteState('legacy')
    liveRouteDiagLog('[LiveEngine][diag] legacy branch selected')
    if (!liveCaptionSessionActive) {
      onLiveAudioChunkRef.current = null
      resetLiveTranscribeRuntime()
      return
    }

    const langHint = whisperLanguageHint(liveLang)

    const YOU_MI_LIVE_BATCH_TARGET_SLICES = 1
    const YOU_MI_LIVE_BATCH_MAX_WAIT_MS = 2_600
    const YOU_MI_LIVE_WARMUP_MAX_BATCHES = 2

    const currentYoumiTargetSlices = () => {
      return YOU_MI_LIVE_BATCH_TARGET_SLICES
    }

    const currentYoumiMaxWaitMs = () => {
      const n = youmiLiveWarmupBatchesSentRef.current
      if (n <= 0) return 1400
      if (n === 1) return 1900
      return YOU_MI_LIVE_BATCH_MAX_WAIT_MS
    }

    const clearYoumiBatchTimer = (reason: string) => {
      const t = youmiLiveBatchFlushTimerRef.current
      if (!t) return
      clearTimeout(t)
      youmiLiveBatchFlushTimerRef.current = null
      youmiLiveLog('emit', 'Youmi live batch timer cleared', { reason })
    }

    const flushYoumiBatchIfReady = (opts: {
      reason: 'target_reached' | 'timer_fired'
    }): { blob: Blob; mime: string; bufferedSlices: number; bufferedBytes: number } | null => {
      const parts = youmiLiveBatchPartsRef.current
      if (!parts.length) return null
      const startedAt = youmiLiveBatchStartedAtRef.current
      const ageMs = startedAt ? Date.now() - startedAt : 0
      const targetSlices = currentYoumiTargetSlices()
      const maxWaitMs = currentYoumiMaxWaitMs()
      const readyByCount = parts.length >= targetSlices
      const readyByAge = startedAt !== null && ageMs >= maxWaitMs
      if (opts.reason === 'target_reached' && !readyByCount) {
        youmiLiveLog('emit', 'flush skipped (target not reached)', {
          bufferedSlices: parts.length,
          bufferedBytes: youmiLiveBatchBytesRef.current,
          targetSlices,
          warmupBatchesSent: youmiLiveWarmupBatchesSentRef.current,
        })
        return null
      }
      if (opts.reason === 'timer_fired' && !readyByAge) {
        youmiLiveLog('emit', 'flush skipped (timer fired too early?)', {
          bufferedSlices: parts.length,
          bufferedBytes: youmiLiveBatchBytesRef.current,
          ageMs,
          maxWaitMs,
          warmupBatchesSent: youmiLiveWarmupBatchesSentRef.current,
        })
        return null
      }
      const mt = youmiLiveBatchMimeRef.current || 'audio/webm'
      const bufferedSlices = parts.length
      const bufferedBytes = youmiLiveBatchBytesRef.current
      const out = new Blob(parts, { type: mt })
      youmiLiveBatchPartsRef.current = []
      youmiLiveBatchBytesRef.current = 0
      youmiLiveBatchMimeRef.current = ''
      youmiLiveBatchStartedAtRef.current = null
      clearYoumiBatchTimer('flush')
      return { blob: out, mime: mt, bufferedSlices, bufferedBytes }
    }

    const resetYoumiBatch = (reason: string) => {
      youmiLiveBatchPartsRef.current = []
      youmiLiveBatchBytesRef.current = 0
      youmiLiveBatchMimeRef.current = ''
      youmiLiveBatchStartedAtRef.current = null
      clearYoumiBatchTimer(`reset:${reason}`)
    }

    const commitReadyPieces = () => {
      let appended = ''
      let committedCount = 0
      while (true) {
        const seq = liveTranscribeSeqCommitRef.current
        const piece = liveTranscribePiecesRef.current.get(seq)
        if (typeof piece === 'undefined') break
        liveTranscribePiecesRef.current.delete(seq)
        liveTranscribeSeqCommitRef.current = seq + 1
        committedCount += 1
        if (!piece) continue
        appended = appended ? `${appended} ${piece}` : piece
      }
      if (committedCount > 0) {
        // Draft is for immediate feedback; clear it once ordered pieces are committed.
        setPrimaryCaptionDraft('')
      }
      if (!appended) return
      youmiLiveLog('E', 'appending to primary line', {
        pieceLen: appended.length,
        preview: appended.slice(0, 120),
      })
      setPrimaryCaption((prev) => {
        const next = prev ? `${prev} ${appended}` : appended
        primaryCaptionRef.current = next
        return next
      })
      onFinalPhraseRef.current?.(appended)
    }

    const isYoumiHostedSession =
      usesHosted && !stubMode && !localOnly && Boolean(supabase) && Boolean(userId)
    const MAX_LIVE_TRANSCRIBE_CONCURRENCY = isYoumiHostedSession ? 3 : 1

    const drainTranscribeQueue = () => {
      while (
        liveTranscribeInFlightRef.current < MAX_LIVE_TRANSCRIBE_CONCURRENCY &&
        liveTranscribeQueueRef.current.length > 0
      ) {
        const item = liveTranscribeQueueRef.current.shift()
        if (!item) break
        const { seq, blob, mime, reason } = item
        liveTranscribeInFlightRef.current += 1
        void (async () => {
          const ext = mime.includes('webm') ? 'webm' : mime.includes('mp4') ? 'm4a' : 'webm'
          try {
            let t: string
            if (stubMode) {
              t = await transcribeRecording(blob, `live.${ext}`, {
                language: langHint,
              })
            } else if (usesHosted && !localOnly && supabase && userId) {
              if (blob.size > 10_000) {
                try {
                  const draftSliceBytes = Math.max(6000, Math.floor(blob.size * 0.52))
                  const draftBlob = blob.slice(0, draftSliceBytes, mime)
                  const draftText = (await transcribeHostedLiveRealtime(draftBlob, mime, 'draft')).trim()
                  if (draftText) {
                    setPrimaryCaptionDraft(draftText)
                    onDraftPhraseRef.current?.(draftText)
                  }
                } catch (e) {
                  youmiLiveLog('srv', 'realtime draft ws failed; continue final path', {
                    message: e instanceof Error ? e.message : String(e),
                  })
                }
              }

              try {
                t = await transcribeHostedLiveRealtime(blob, mime, 'final')
              } catch (e) {
                youmiLiveLog('srv', 'realtime final ws failed; fallback to live-transcribe-url', {
                  message: e instanceof Error ? e.message : String(e),
                })
                const { data: sess } = await supabase.auth.getSession()
                const tok = sess.session?.access_token
                if (!tok) throw new Error('Sign in again to use live captions.')
                const chunkIdx = liveChunkIndexRef.current++
                const sid = liveCaptionSessionIdRef.current
                if (!sid) throw new Error('Live caption session not ready.')
                youmiLiveLog('srv', 'sending hosted live chunk to server', {
                  chunkIndex: chunkIdx,
                  bytes: blob.size,
                  mime,
                  seq,
                  reason,
                })
                t = await transcribeHostedLiveCaptionChunk({
                  supabase,
                  accessToken: tok,
                  userId,
                  sessionId: sid,
                  chunkIndex: chunkIdx,
                  blob,
                  mime,
                  filename: `live.${ext}`,
                })
              }
            } else {
              t = await transcribeRecording(blob, `live.${ext}`, {
                language: langHint,
              })
            }
            const piece = t.trim()
            liveChunkFailStreakRef.current = 0
            setLiveCaptionChunkNotice(null)
            if (piece) {
              // Draft-first: show quickly even before ordered commit catches up.
              setPrimaryCaptionDraft(piece)
              onDraftPhraseRef.current?.(piece)
            }
            liveTranscribePiecesRef.current.set(seq, piece)
            commitReadyPieces()
            if (!piece) {
              youmiLiveLog(
                'D',
                'transcribe returned empty string; primary not updated this chunk',
                { seq, reason },
              )
            }
          } catch (e) {
            youmiLiveLog('fail', 'chunk pipeline threw', {
              message: e instanceof Error ? e.message : String(e),
              seq,
              reason,
            })
            const hasPrimary = primaryCaptionRef.current.trim().length > 0
            liveChunkFailStreakRef.current += 1
            const streak = liveChunkFailStreakRef.current
            liveTranscribePiecesRef.current.set(seq, '')
            commitReadyPieces()
            if (hasPrimary) {
              if (streak >= LIVE_CHUNK_SOFT_STREAK) {
                setLiveCaptionChunkNotice({
                  kind: 'soft',
                  message:
                    'A few caption lines could not be updated. Recording continues — captions may skip a phrase.',
                })
              }
            } else if (streak >= LIVE_CHUNK_FATAL_STREAK) {
              const msg = e instanceof Error ? e.message : ''
              const looksLikeHostedSetup = /not available yet|setup is not available/i.test(msg)
              setLiveCaptionChunkNotice({
                kind: 'fatal',
                message:
                  usesHosted && looksLikeHostedSetup
                    ? 'Youmi AI setup is not available yet.'
                    : usesHosted
                      ? 'Live captions could not start with Youmi AI. Check your connection or try again after class with Generate transcript & summaries.'
                      : 'Live captions could not start. Check Account settings or your connection.',
              })
            }
          } finally {
            liveTranscribeInFlightRef.current = Math.max(0, liveTranscribeInFlightRef.current - 1)
            setLiveCaptionPendingSlices((n) => Math.max(0, n - 1))
            drainTranscribeQueue()
          }
        })()
      }
    }

    const queueLiveTranscribe = (blob: Blob, mime: string, reason: string) => {
      const ext = mime.includes('webm') ? 'webm' : mime.includes('mp4') ? 'm4a' : 'webm'
      youmiLiveLog('emit', 'batch->transcribe queued', {
        reason,
        bytes: blob.size,
        mime,
        ext,
      })
      const seq = liveTranscribeSeqIssuedRef.current++
      setLiveCaptionPendingSlices((n) => n + 1)
      liveTranscribeQueueRef.current.push({ seq, blob, mime, reason })
      drainTranscribeQueue()
    }
    // Keep the latest queue fn for any timer-fired flush.
    youmiLiveQueueTranscribeRef.current = queueLiveTranscribe

    onLiveAudioChunkRef.current = (blob, mime) => {
      if (!liveCaptionsPipelineEnabled) {
        youmiLiveLog('A', 'chunk handler skipped (pipeline not enabled)', {
          liveCaptionsPipelineEnabled: false,
        })
        return
      }

      const isYoumiHostedLive =
        usesHosted && !stubMode && !localOnly && Boolean(supabase) && Boolean(userId)

      if (isYoumiHostedLive) {
        if (!youmiLiveBatchStartedAtRef.current) youmiLiveBatchStartedAtRef.current = Date.now()
        youmiLiveBatchPartsRef.current.push(blob)
        youmiLiveBatchBytesRef.current += blob.size
        if (!youmiLiveBatchMimeRef.current) youmiLiveBatchMimeRef.current = mime
        const targetSlices = currentYoumiTargetSlices()
        const maxWaitMs = currentYoumiMaxWaitMs()

        youmiLiveLog('emit', 'Youmi live slice buffered (batching enabled)', {
          sliceBytes: blob.size,
          sliceMime: mime,
          bufferedSlices: youmiLiveBatchPartsRef.current.length,
          bufferedBytes: youmiLiveBatchBytesRef.current,
          targetSlices,
          maxWaitMs,
          warmupBatchesSent: youmiLiveWarmupBatchesSentRef.current,
        })

        if (!youmiLiveBatchFlushTimerRef.current) {
          youmiLiveLog('emit', 'Youmi live batch timer armed', {
            maxWaitMs,
            bufferedSlices: youmiLiveBatchPartsRef.current.length,
            bufferedBytes: youmiLiveBatchBytesRef.current,
            targetSlices,
            warmupBatchesSent: youmiLiveWarmupBatchesSentRef.current,
          })
          youmiLiveBatchFlushTimerRef.current = window.setTimeout(() => {
            youmiLiveLog('emit', 'Youmi live batch timer fired', {
              bufferedSlices: youmiLiveBatchPartsRef.current.length,
              bufferedBytes: youmiLiveBatchBytesRef.current,
              targetSlices: currentYoumiTargetSlices(),
              maxWaitMs: currentYoumiMaxWaitMs(),
              warmupBatchesSent: youmiLiveWarmupBatchesSentRef.current,
            })
            const flushed = flushYoumiBatchIfReady({ reason: 'timer_fired' })
            if (!flushed) return
            youmiLiveLog('emit', 'Youmi live batch flushed (timer)', {
              batchBytes: flushed.blob.size,
              batchMime: flushed.mime,
              bufferedSlices: flushed.bufferedSlices,
              bufferedBytes: flushed.bufferedBytes,
              warmupBatchesSent: youmiLiveWarmupBatchesSentRef.current,
            })
            const q = youmiLiveQueueTranscribeRef.current
            if (!q) {
              youmiLiveLog('emit', 'timer fired but queue fn missing (skipped)', {})
              return
            }
            if (youmiLiveWarmupBatchesSentRef.current < YOU_MI_LIVE_WARMUP_MAX_BATCHES) {
              youmiLiveWarmupBatchesSentRef.current += 1
            }
            q(flushed.blob, flushed.mime, 'youmi_batch_timer')
          }, maxWaitMs)
        }

        const flushedNow = flushYoumiBatchIfReady({ reason: 'target_reached' })
        if (!flushedNow) return
        blob = flushedNow.blob
        mime = flushedNow.mime
        if (youmiLiveWarmupBatchesSentRef.current < YOU_MI_LIVE_WARMUP_MAX_BATCHES) {
          youmiLiveWarmupBatchesSentRef.current += 1
        }

        youmiLiveLog('emit', 'Youmi live batch flushed (queued to transcribe)', {
          batchBytes: blob.size,
          batchMime: mime,
          slicesPerBatch: targetSlices,
          warmupBatchesSent: youmiLiveWarmupBatchesSentRef.current,
        })
      } else {
        resetYoumiBatch('non_youmi_hosted_live')
        youmiLiveLog('emit', 'chunk received in App handler (queued to transcribe)', {
          bytes: blob.size,
          mime,
        })
      }

      queueLiveTranscribe(blob, mime, isYoumiHostedLive ? 'youmi_batch_flush' : 'direct_slice')
    }

    return () => {
      onLiveAudioChunkRef.current = null
      // Important: do NOT clear the batching timer here. This effect can re-run while the session
      // stays active (e.g. health refresh / auth/session updates). Clearing would cause "buffered
      // but never flushed" if no further slices arrive to re-arm the timer.
    }
  }, [
    liveCaptionSessionActive,
    liveLang,
    liveCaptionsPipelineEnabled,
    usesHosted,
    stubMode,
    localOnly,
    supabase,
    userId,
    resetLiveTranscribeRuntime,
    useLiveEngineV2,
  ])

  useEffect(() => {
    if (useLiveEngineV2) {
      onFinalPhraseRef.current = null
      onDraftPhraseRef.current = null
      return
    }
    if (!liveCaptionSessionActive) {
      onFinalPhraseRef.current = null
      onDraftPhraseRef.current = null
      return
    }

    const pending: string[] = []
    const pendingDraft: string[] = []
    let debounceTimer: ReturnType<typeof setTimeout> | null = null
    let draftDebounceTimer: ReturnType<typeof setTimeout> | null = null
    let cancelled = false
    let chain: Promise<void> = Promise.resolve()
    const TRANSLATE_DEBOUNCE_MS = 140
    const TRANSLATE_REFLUSH_MS = 70
    const TRANSLATE_MAX_PHRASES_PER_BATCH = 1
    const TRANSLATE_DRAFT_DEBOUNCE_MS = 90
    const translatedRecently = new Set<string>()

    const normalizeForDedup = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ')

    const flushPending = () => {
      debounceTimer = null
      if (cancelled) return
      const batch = pending.splice(0, TRANSLATE_MAX_PHRASES_PER_BATCH).join(' ').trim()
      if (!batch) return
      if (translateTarget === 'off') return
      if (!liveCaptionsPipelineEnabled) return
      const target = translateTarget

      chain = chain.then(async () => {
        if (cancelled) return
        try {
          const t = await translateLiveCaption(batch, {
            target,
          })
          if (cancelled || !t) return
          setSecondaryCaption((c) => (c ? `${c} ${t}` : t))
        } catch (err) {
          youmiLiveLog('F', 'translateLiveCaption failed (secondary only)', {
            message: err instanceof Error ? err.message : String(err),
          })
        } finally {
          // Keep secondary closely following primary when phrases arrive quickly.
          if (!cancelled && pending.length > 0 && !debounceTimer) {
            debounceTimer = window.setTimeout(flushPending, TRANSLATE_REFLUSH_MS)
          }
        }
      })
    }

    const flushDraftPending = () => {
      draftDebounceTimer = null
      if (cancelled) return
      const batch = pendingDraft.splice(0, 1).join(' ').trim()
      if (!batch) return
      if (translateTarget === 'off') return
      if (!liveCaptionsPipelineEnabled) return
      const key = normalizeForDedup(batch)
      if (translatedRecently.has(key)) return
      translatedRecently.add(key)
      const target = translateTarget

      chain = chain.then(async () => {
        if (cancelled) return
        try {
          const t = await translateLiveCaption(batch, { target })
          if (cancelled || !t) return
          setSecondaryCaption((c) => (c ? `${c} ${t}` : t))
        } catch (err) {
          youmiLiveLog('F', 'translateLiveCaption failed (draft secondary)', {
            message: err instanceof Error ? err.message : String(err),
          })
        }
      })
    }

    onFinalPhraseRef.current = (phrase: string) => {
      if (translateTarget === 'off') return
      if (!liveCaptionsPipelineEnabled) return
      const p = phrase.trim()
      if (!p) return
      translatedRecently.add(normalizeForDedup(p))
      pending.push(p)
      if (debounceTimer) clearTimeout(debounceTimer)
      debounceTimer = window.setTimeout(flushPending, TRANSLATE_DEBOUNCE_MS)
    }

    onDraftPhraseRef.current = (phrase: string) => {
      if (translateTarget === 'off') return
      if (!liveCaptionsPipelineEnabled) return
      const p = phrase.trim()
      if (!p) return
      pendingDraft.push(p)
      if (draftDebounceTimer) clearTimeout(draftDebounceTimer)
      draftDebounceTimer = window.setTimeout(flushDraftPending, TRANSLATE_DRAFT_DEBOUNCE_MS)
    }

    return () => {
      cancelled = true
      onFinalPhraseRef.current = null
      onDraftPhraseRef.current = null
      if (debounceTimer) clearTimeout(debounceTimer)
      if (draftDebounceTimer) clearTimeout(draftDebounceTimer)
    }
  }, [liveCaptionSessionActive, translateTarget, liveCaptionsPipelineEnabled, useLiveEngineV2])

  // useLayoutEffect: attach PCM handler before paint so ScriptProcessor callbacks never run with a null ref
  // (recorder.start uses flushSync('recording') then starts AudioContext — effect would be too late).
  useLayoutEffect(() => {
    if (!useLiveEngineV2) {
      if (liveEngineRef.current) {
        liveRouteDiagLog('[LiveEngine][diag] stopping v2 engine because route is legacy')
        liveEngineRef.current.stop()
        liveEngineRef.current = null
      }
      return
    }
    if (!liveCaptionSessionActive) {
      setLiveRouteState('v2_waiting_session')
      onLiveAudioChunkRef.current = null
      onLivePcmChunkRef.current = null
      if (liveEngineRef.current) {
        liveRouteDiagLog('[LiveEngine][diag] stopping v2 engine because session is inactive')
        liveEngineRef.current.stop()
        liveEngineRef.current = null
      }
      return
    }
    if (!liveCaptionsPipelineEnabled || !usesHosted) {
      setLiveRouteState('v2_blocked_pipeline')
      liveRouteDiagLog(
        '[LiveEngine][diag] v2 blocked (pipeline/capability)',
        JSON.stringify({ liveCaptionsPipelineEnabled, usesHosted }),
      )
      onLiveAudioChunkRef.current = null
      onLivePcmChunkRef.current = null
      return
    }

    setLiveRouteState('v2_starting')
    liveRouteDiagLog('[LiveEngine][diag] LiveEngine.start()')
    const engine = new LiveEngine()
    liveEngineRef.current = engine
    v2PushCountRef.current = 0
    v2CurrentEnUtteranceRef.current = ''
    v2CurrentZhUtteranceRef.current = ''
    v2OpenUtteranceSeqRef.current = -1
    if (v2UtteranceIdleTimerRef.current != null) {
      clearTimeout(v2UtteranceIdleTimerRef.current)
      v2UtteranceIdleTimerRef.current = null
    }
    v2LastEnInterimRevBySegRef.current.clear()
    v2LastZhInterimRevBySegRef.current.clear()
    v2FinalizedZhSegIds.current.clear()
    lastFinalTimestampRef.current = 0
    v2EnPhraseLastSegmentIdRef.current = ''
    v2EnPhraseDisplayedLenRef.current = 0
    v2EnPhraseLastFlushAtRef.current = Date.now()
    v2EnGrayVisibleRef.current = ''
    v2PendingZhInterimRef.current = null
    v2LastEnFinalSanitizedBySegRef.current.clear()

    const clearEnPhraseTick = () => {
      if (v2EnPhraseTickTimerRef.current != null) {
        clearTimeout(v2EnPhraseTickTimerRef.current)
        v2EnPhraseTickTimerRef.current = null
      }
    }

    /** Gray EN (sanitized) must cover the full `sourceEn` string that was sent to translate. */
    const v2SanitizedGrayCoversSourceEn = (grayRaw: string, sourceEn: string): boolean => {
      const s = normCaptionSpaces(sourceEn).toLowerCase()
      if (!s) return true
      const g = normCaptionSpaces(sanitizeEnglishForZhTranslate(grayRaw)).toLowerCase()
      if (!g) return false
      return g.length >= s.length && g.startsWith(s)
    }

    const v2SourceEnStillPlausible = (latestRawEn: string, sourceEn: string): boolean => {
      const L = normCaptionSpaces(sanitizeEnglishForZhTranslate(latestRawEn)).toLowerCase()
      const s = normCaptionSpaces(sourceEn).toLowerCase()
      if (!s) return false
      return L.startsWith(s) || (s.startsWith(L) && L.length > 0)
    }

    const clearV2IdleTimer = () => {
      if (v2UtteranceIdleTimerRef.current != null) {
        clearTimeout(v2UtteranceIdleTimerRef.current)
        v2UtteranceIdleTimerRef.current = null
      }
    }

    const syncPrimaryCaptionSaveRef = () => {
      primaryCaptionRef.current = v2JoinForPersist(
        v2CommittedEnChunksRef.current,
        v2CurrentEnUtteranceRef.current,
      )
    }

    const applyWindowedPrimaryCommitted = () => {
      const black = v2CommittedForBlackDisplay(
        v2CommittedEnChunksRef.current,
        v2CurrentEnUtteranceRef.current,
      )
      setPrimaryCaption(black ? v2WindowCaptionWords(black) : '')
    }

    const applyWindowedSecondaryCommitted = () => {
      const black = v2CommittedForBlackDisplay(
        v2CommittedZhChunksRef.current,
        v2CurrentZhUtteranceRef.current,
      )
      setSecondaryCaption(black ? v2WindowCaptionWords(black) : '')
    }

    const flushV2OpenUtterance = () => {
      clearV2IdleTimer()
      clearEnPhraseTick()
      const en = v2CurrentEnUtteranceRef.current.trim()
      const zh = v2CurrentZhUtteranceRef.current.trim()
      if (!en && !zh) {
        v2OpenUtteranceSeqRef.current = -1
        syncPrimaryCaptionSaveRef()
        applyWindowedPrimaryCommitted()
        applyWindowedSecondaryCommitted()
        return
      }
      if (en) {
        v2MergeChunkIntoHistory(v2CommittedEnChunksRef.current, en)
      }
      if (zh) {
        v2MergeChunkIntoHistory(v2CommittedZhChunksRef.current, zh)
      }
      v2SyncCommittedStringsFromChunks(
        v2CommittedEnChunksRef.current,
        v2CommittedZhChunksRef.current,
        v2CommittedEnRef,
        secondaryCaptionFullRef,
      )
      v2CurrentEnUtteranceRef.current = ''
      v2CurrentZhUtteranceRef.current = ''
      v2OpenUtteranceSeqRef.current = -1
      v2PendingZhInterimRef.current = null
      v2EnGrayVisibleRef.current = ''
      setPrimaryCaptionDraft('')
      setSecondaryCaptionDraft('')
      v2EnPhraseLastSegmentIdRef.current = ''
      v2EnPhraseDisplayedLenRef.current = 0
      applyWindowedPrimaryCommitted()
      applyWindowedSecondaryCommitted()
      syncPrimaryCaptionSaveRef()
    }

    const scheduleV2UtteranceIdleFlush = () => {
      clearV2IdleTimer()
      v2UtteranceIdleTimerRef.current = window.setTimeout(() => {
        v2UtteranceIdleTimerRef.current = null
        flushV2OpenUtterance()
      }, V2_UTTERANCE_IDLE_FLUSH_MS)
    }

    const applyZhInterimToUi = (segmentId: string, rev: number, text: string) => {
      v2LastZhInterimRevBySegRef.current.set(segmentId, rev)
      if (v2LastZhInterimRevBySegRef.current.size > 48) {
        const first = v2LastZhInterimRevBySegRef.current.keys().next().value
        if (first !== undefined) v2LastZhInterimRevBySegRef.current.delete(first)
      }
      v2CurrentZhUtteranceRef.current = text.trim()
      v2ZhDraftTextRef.current = text
      applyWindowedSecondaryCommitted()
      if (v2ZhDraftRafRef.current == null) {
        v2ZhDraftRafRef.current = requestAnimationFrame(() => {
          v2ZhDraftRafRef.current = null
          setSecondaryCaptionDraft(v2ZhDraftTextRef.current)
          applyWindowedSecondaryCommitted()
        })
      }
    }

    const flushPendingZhInterimIfReady = () => {
      const p = v2PendingZhInterimRef.current
      if (!p) return
      if (v2FinalizedZhSegIds.current.has(p.segmentId)) {
        v2PendingZhInterimRef.current = null
        return
      }
      if (v2OpenUtteranceSeqRef.current !== segmentSeq(p.segmentId)) {
        v2PendingZhInterimRef.current = null
        return
      }
      const latestRaw = v2CurrentEnUtteranceRef.current
      if (!v2SourceEnStillPlausible(latestRaw, p.sourceEn)) {
        v2PendingZhInterimRef.current = null
        return
      }
      const gray = v2EnGrayVisibleRef.current
      if (!v2SanitizedGrayCoversSourceEn(gray, p.sourceEn)) return
      v2PendingZhInterimRef.current = null
      liveRouteDiagLog(
        '[LiveEngine][App] zh_interim (from pending)',
        JSON.stringify({ segmentId: p.segmentId, rev: p.rev }),
      )
      applyZhInterimToUi(p.segmentId, p.rev, p.text)
      scheduleV2UtteranceIdleFlush()
    }

    const commitEnGrayDraft = (full: string, now: number) => {
      setPrimaryCaptionDraft(full)
      v2EnGrayVisibleRef.current = full
      v2EnPhraseDisplayedLenRef.current = full.length
      v2EnPhraseLastFlushAtRef.current = now
      flushPendingZhInterimIfReady()
    }

    const tryFlushEnPhraseDisplay = (force: boolean) => {
      const full = v2EnDraftTextRef.current
      const now = Date.now()
      const shownLen = v2EnPhraseDisplayedLenRef.current
      const lastAt = v2EnPhraseLastFlushAtRef.current

      if (force) {
        commitEnGrayDraft(full, now)
        return
      }

      if (!full.trim()) return

      const delta = full.length - shownLen
      const timeSince = now - lastAt

      if (shownLen === 0) {
        if (v2EnEndsPhraseBoundary(full)) {
          commitEnGrayDraft(full, now)
        } else if (full.trim().length >= V2_EN_PHRASE_FIRST_MIN_CHARS) {
          commitEnGrayDraft(full, now)
        } else if (timeSince >= V2_EN_PHRASE_FIRST_WAIT_MS && full.trim().length >= 2) {
          commitEnGrayDraft(full, now)
        }
        return
      }

      if (delta <= 0) return

      if (v2EnEndsPhraseBoundary(full)) {
        commitEnGrayDraft(full, now)
        return
      }

      if (delta >= V2_EN_PHRASE_MIN_CHARS) {
        commitEnGrayDraft(full, now)
        return
      }

      if (timeSince >= V2_EN_PHRASE_MAX_WAIT_MS && delta >= V2_EN_PHRASE_STALE_MIN_DELTA) {
        commitEnGrayDraft(full, now)
      }
    }

    const scheduleEnPhraseTick = () => {
      clearEnPhraseTick()
      v2EnPhraseTickTimerRef.current = window.setTimeout(() => {
        v2EnPhraseTickTimerRef.current = null
        tryFlushEnPhraseDisplay(false)
        if (v2EnDraftTextRef.current.length > v2EnPhraseDisplayedLenRef.current) {
          scheduleEnPhraseTick()
        }
      }, V2_EN_PHRASE_TICK_MS)
    }

    engine.onEvent((ev) => {
      if (ev.type === 'status') {
        liveRouteDiagLog('[LiveEngine][App] status', JSON.stringify({ status: ev.status, detail: ev.detail }))
        if (ev.status === 'connected' || ev.status === 'streaming') setLiveRouteState('v2_streaming')
        if (ev.status === 'error') setLiveRouteState('v2_error')
        if (ev.status === 'reconnecting') {
          setLiveCaptionChunkNotice({
            kind: 'soft',
            message: 'Realtime captions reconnecting…',
          })
        } else if (ev.status === 'connected' || ev.status === 'streaming') {
          setLiveCaptionChunkNotice(null)
        }
        return
      }
      if (ev.type === 'error') {
        liveRouteDiagLog(
          '[LiveEngine][App] error',
          JSON.stringify({ code: ev.code, message: ev.message, recoverable: ev.recoverable }),
        )
        setLiveCaptionChunkNotice({
          kind: ev.recoverable ? 'soft' : 'fatal',
          message: ev.message,
        })
        setLiveRouteState('v2_error')
        if (ev.recoverable) {
          setLiveCaptionPendingSlices((n) => Math.max(0, n - 1))
        }
        return
      }
      if (ev.type === 'en_interim') {
        liveRouteDiagLog('[LiveEngine][App] en_interim', JSON.stringify({ segmentId: ev.segmentId, rev: ev.rev }))
        const seq = segmentSeq(ev.segmentId)
        const open = v2OpenUtteranceSeqRef.current
        // Drop only *late* packets from an older stream-N than the utterance slot (not global max N —
        // that discarded valid interims after any out-of-order higher segment and caused gray to lag speech).
        if (open >= 0 && seq < open) return
        const prevRev = v2LastEnInterimRevBySegRef.current.get(ev.segmentId) ?? 0
        if (ev.rev <= prevRev) return
        v2LastEnInterimRevBySegRef.current.set(ev.segmentId, ev.rev)
        if (v2LastEnInterimRevBySegRef.current.size > 48) {
          const first = v2LastEnInterimRevBySegRef.current.keys().next().value
          if (first !== undefined) v2LastEnInterimRevBySegRef.current.delete(first)
        }
        if (open >= 0 && seq !== open) flushV2OpenUtterance()
        v2OpenUtteranceSeqRef.current = seq
        const prevEn = v2CurrentEnUtteranceRef.current.trim()
        const t = ev.text.trim()
        if (prevEn.length && t.length) {
          const nonlinear = !t.startsWith(prevEn) && !prevEn.startsWith(t)
          if (nonlinear) {
            v2PendingZhInterimRef.current = null
            v2CurrentZhUtteranceRef.current = ''
            v2ZhDraftTextRef.current = ''
            if (v2ZhDraftRafRef.current != null) {
              cancelAnimationFrame(v2ZhDraftRafRef.current)
              v2ZhDraftRafRef.current = null
            }
            setSecondaryCaptionDraft('')
            applyWindowedSecondaryCommitted()
          }
        }
        v2CurrentEnUtteranceRef.current = t
        v2EnDraftTextRef.current = ev.text
        if (v2EnPhraseLastSegmentIdRef.current !== ev.segmentId) {
          v2EnPhraseLastSegmentIdRef.current = ev.segmentId
          v2EnPhraseDisplayedLenRef.current = 0
          v2EnPhraseLastFlushAtRef.current = Date.now()
          v2PendingZhInterimRef.current = null
        }
        applyWindowedPrimaryCommitted()
        tryFlushEnPhraseDisplay(false)
        scheduleEnPhraseTick()
        syncPrimaryCaptionSaveRef()
        scheduleV2UtteranceIdleFlush()
        return
      }
      if (ev.type === 'en_final') {
        clearEnPhraseTick()
        if (v2EnDraftRafRef.current != null) {
          cancelAnimationFrame(v2EnDraftRafRef.current)
          v2EnDraftRafRef.current = null
        }
        liveRouteDiagLog('[LiveEngine][App] en_final', JSON.stringify({ segmentId: ev.segmentId }))
        setLiveCaptionPendingSlices((n) => Math.max(0, n - 1))
        const seq = segmentSeq(ev.segmentId)
        const text = ev.text.trim()
        const open = v2OpenUtteranceSeqRef.current
        if (open !== -1 && seq < open) return
        if (open !== -1 && seq > open) flushV2OpenUtterance()
        v2OpenUtteranceSeqRef.current = seq
        // Commit EN final into black-line history immediately. Gray stays for true interims only;
        // avoids long "final stuck in draft" and reduces reliance on v2CommittedForBlackDisplay heuristics.
        if (text) {
          v2LastEnFinalSanitizedBySegRef.current.set(
            ev.segmentId,
            sanitizeEnglishForZhTranslate(text),
          )
          v2MergeChunkIntoHistory(v2CommittedEnChunksRef.current, text)
          v2SyncCommittedStringsFromChunks(
            v2CommittedEnChunksRef.current,
            v2CommittedZhChunksRef.current,
            v2CommittedEnRef,
            secondaryCaptionFullRef,
          )
        }
        v2PendingZhInterimRef.current = null
        v2CurrentEnUtteranceRef.current = ''
        v2EnDraftTextRef.current = ''
        v2EnPhraseLastSegmentIdRef.current = ''
        v2EnPhraseDisplayedLenRef.current = 0
        v2EnGrayVisibleRef.current = ''
        setPrimaryCaptionDraft('')
        flushPendingZhInterimIfReady()
        applyWindowedPrimaryCommitted()
        syncPrimaryCaptionSaveRef()
        // Idle flush still drains ZH draft → committed when translation settles (EN slot already empty).
        scheduleV2UtteranceIdleFlush()
        return
      }
      if (ev.type === 'zh_interim') {
        // Discard stale in-flight interim translation that resolved after zh_final for this segment.
        // Log is intentionally AFTER the guard so Console only shows interims that reach the UI.
        if (v2FinalizedZhSegIds.current.has(ev.segmentId)) return
        const seq = segmentSeq(ev.segmentId)
        const open = v2OpenUtteranceSeqRef.current
        if (open === -1 || seq !== open) return
        const prevZhRev = v2LastZhInterimRevBySegRef.current.get(ev.segmentId) ?? 0
        if (ev.rev <= prevZhRev) return
        const src = ev.sourceEn.trim()
        const latestRaw = v2CurrentEnUtteranceRef.current
        if (!v2SourceEnStillPlausible(latestRaw, src)) return
        const gray = v2EnGrayVisibleRef.current
        const pending = v2PendingZhInterimRef.current
        if (!v2SanitizedGrayCoversSourceEn(gray, src)) {
          if (!pending || pending.segmentId !== ev.segmentId || ev.rev > pending.rev) {
            v2PendingZhInterimRef.current = {
              segmentId: ev.segmentId,
              sourceEn: src,
              text: ev.text,
              rev: ev.rev,
            }
          }
          scheduleV2UtteranceIdleFlush()
          return
        }
        liveRouteDiagLog('[LiveEngine][App] zh_interim', JSON.stringify({ segmentId: ev.segmentId, rev: ev.rev }))
        applyZhInterimToUi(ev.segmentId, ev.rev, ev.text)
        scheduleV2UtteranceIdleFlush()
        return
      }
      if (ev.type === 'zh_final') {
        if (v2ZhDraftRafRef.current != null) {
          cancelAnimationFrame(v2ZhDraftRafRef.current)
          v2ZhDraftRafRef.current = null
        }
        liveRouteDiagLog('[LiveEngine][App] zh_final', JSON.stringify({ segmentId: ev.segmentId }))
        v2PendingZhInterimRef.current = null
        const expectedSan = normCaptionSpaces(
          v2LastEnFinalSanitizedBySegRef.current.get(ev.segmentId) ?? '',
        ).toLowerCase()
        const srcSan = normCaptionSpaces(ev.sourceEn).toLowerCase()
        if (expectedSan && srcSan && expectedSan !== srcSan) {
          liveRouteDiagLog(
            '[LiveEngine][App] zh_final dropped (sourceEn mismatch)',
            JSON.stringify({ segmentId: ev.segmentId }),
          )
          v2LastEnFinalSanitizedBySegRef.current.delete(ev.segmentId)
          return
        }
        v2LastEnFinalSanitizedBySegRef.current.delete(ev.segmentId)
        v2FinalizedZhSegIds.current.add(ev.segmentId)
        const seq = segmentSeq(ev.segmentId)
        const text = ev.text.trim()
        const open = v2OpenUtteranceSeqRef.current
        if (text) {
          if (open !== -1 && seq === open) {
            v2MergeChunkIntoHistory(v2CommittedZhChunksRef.current, text)
            v2SyncCommittedStringsFromChunks(
              v2CommittedEnChunksRef.current,
              v2CommittedZhChunksRef.current,
              v2CommittedEnRef,
              secondaryCaptionFullRef,
            )
            v2CurrentZhUtteranceRef.current = ''
            v2ZhDraftTextRef.current = ''
            setSecondaryCaptionDraft('')
            applyWindowedSecondaryCommitted()
          } else {
            v2MergeChunkIntoHistory(v2CommittedZhChunksRef.current, text)
            v2SyncCommittedStringsFromChunks(
              v2CommittedEnChunksRef.current,
              v2CommittedZhChunksRef.current,
              v2CommittedEnRef,
              secondaryCaptionFullRef,
            )
            applyWindowedSecondaryCommitted()
          }
        }
        if (!v2CurrentEnUtteranceRef.current.trim() && !v2CurrentZhUtteranceRef.current.trim()) {
          v2OpenUtteranceSeqRef.current = -1
          clearV2IdleTimer()
        } else {
          scheduleV2UtteranceIdleFlush()
        }
        if (v2FinalizedZhSegIds.current.size > 80) {
          const entries = [...v2FinalizedZhSegIds.current]
          v2FinalizedZhSegIds.current = new Set(entries.slice(-40))
        }
      }
    })

    engine.start({ translateTarget })
    // PCM streaming path: AudioContext frames drive the engine directly (no blob slices needed).
    onLivePcmChunkRef.current = (buffer, sampleRate) => {
      engine.pushPcmChunk(buffer, sampleRate)
    }
    onLiveAudioChunkRef.current = null

    return () => {
      if (v2UtteranceIdleTimerRef.current != null) {
        clearTimeout(v2UtteranceIdleTimerRef.current)
        v2UtteranceIdleTimerRef.current = null
      }
      if (v2EnPhraseTickTimerRef.current != null) {
        clearTimeout(v2EnPhraseTickTimerRef.current)
        v2EnPhraseTickTimerRef.current = null
      }
      if (v2EnDraftRafRef.current != null) {
        cancelAnimationFrame(v2EnDraftRafRef.current)
        v2EnDraftRafRef.current = null
      }
      if (v2ZhDraftRafRef.current != null) {
        cancelAnimationFrame(v2ZhDraftRafRef.current)
        v2ZhDraftRafRef.current = null
      }
      onLivePcmChunkRef.current = null
      onLiveAudioChunkRef.current = null
      engine.stop()
      if (liveEngineRef.current === engine) liveEngineRef.current = null
      if (useLiveEngineV2) setLiveRouteState('v2_waiting_session')
    }
  }, [
    useLiveEngineV2,
    liveCaptionSessionActive,
    liveCaptionsPipelineEnabled,
    usesHosted,
    translateTarget,
  ])

  const [recordings, setRecordings] = useState<Recording[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<RecordingDetail | null>(null)

  const [librarySelectedFolderId, setLibrarySelectedFolderId] = useState<string | null>(null)
  const [libraryPickMode, setLibraryPickMode] = useState(false)
  const [libraryPickedIds, setLibraryPickedIds] = useState<string[]>([])
  const libraryShiftAnchorRef = useRef<string | null>(null)

  const hostedCloudJobActive =
    !localOnly &&
    usesHosted &&
    detail &&
    ['queued', 'transcribing', 'summarizing'].includes(detail.aiStatus ?? '')

  const hostedPostClassOutputsComplete = Boolean(
    detail?.transcript?.trim() && detail?.summaryEn?.trim() && detail?.summaryZh?.trim(),
  )

  const showHostedReadyToGenerateHint =
    !localOnly &&
    usesHosted &&
    detail &&
    detail.aiStatus === 'pending' &&
    !hostedCloudJobActive &&
    (hostedConfigured || stubMode || optimisticCloudYoumiHealthLoading) &&
    !hostedUnavailableMessage &&
    !hostedPostClassOutputsComplete

  /** True from click until hosted enqueue returns or BYOK pipeline finishes; avoids “dead” UI before network. */
  const [transcribeSubmitPending, setTranscribeSubmitPending] = useState(false)
  const transcribeActionLockRef = useRef(false)

  const aiSourceSwitchEpochRef = useRef<string | null>(null)
  useEffect(() => {
    if (aiSourceSwitchEpochRef.current === null) {
      aiSourceSwitchEpochRef.current = aiStoreTick
      return
    }
    if (aiSourceSwitchEpochRef.current === aiStoreTick) return
    aiSourceSwitchEpochRef.current = aiStoreTick
    setRecentAi(null)
    setLiveCaptionChunkNotice(null)
    liveChunkFailStreakRef.current = 0
    setLiveCaptionPendingSlices(0)
    transcribeActionLockRef.current = false
    setTranscribeSubmitPending(false)
    if (recorder.status === 'idle') {
      primaryCaptionRef.current = ''
      lastFinalTimestampRef.current = 0
      setPrimaryCaption('')
      setPrimaryCaptionDraft('')
      setSecondaryCaption('')
      setSecondaryCaptionDraft('')
      secondaryCaptionFullRef.current = ''
      v2CommittedEnRef.current = ''
      v2CommittedEnChunksRef.current = []
      v2CommittedZhChunksRef.current = []
      v2CurrentEnUtteranceRef.current = ''
      v2CurrentZhUtteranceRef.current = ''
      v2OpenUtteranceSeqRef.current = -1
      if (v2UtteranceIdleTimerRef.current != null) {
        clearTimeout(v2UtteranceIdleTimerRef.current)
        v2UtteranceIdleTimerRef.current = null
      }
      v2LastEnInterimRevBySegRef.current.clear()
      liveCaptionSessionIdRef.current = null
      youmiLiveBatchPartsRef.current = []
      youmiLiveBatchBytesRef.current = 0
      youmiLiveBatchMimeRef.current = ''
      youmiLiveBatchStartedAtRef.current = null
      youmiLiveWarmupBatchesSentRef.current = 0
      if (youmiLiveBatchFlushTimerRef.current) {
        clearTimeout(youmiLiveBatchFlushTimerRef.current)
        youmiLiveBatchFlushTimerRef.current = null
      }
      resetLiveTranscribeRuntime()
    }
  }, [aiStoreTick, recorder.status, resetLiveTranscribeRuntime])

  const aiPipelineBusy =
    transcribeSubmitPending ||
    hostedCloudJobActive ||
    flow.phase === 'transcribing' ||
    flow.phase === 'summarizing'

  const generateTranscribeButtonLabel = useMemo(() => {
    if (transcribeSubmitPending && !localOnly && usesHosted && !hostedCloudJobActive) {
      return 'Starting Youmi AI…'
    }
    if (aiPipelineBusy) {
      return usesHosted ? 'Youmi AI is working…' : 'Working…'
    }
    if (!localOnly && usesHosted) return 'Generate transcript & summaries'
    return 'Transcribe & summarize (bilingual)'
  }, [
    transcribeSubmitPending,
    localOnly,
    usesHosted,
    hostedCloudJobActive,
    aiPipelineBusy,
  ])

  const [course, setCourse] = useState('CS 101')
  const [title, setTitle] = useState('')

  const saveInFlightRef = useRef(false)

  const [backupBusy, setBackupBusy] = useState(false)
  const [backupError, setBackupError] = useState<string | null>(null)
  const [backupMsg, setBackupMsg] = useState<string | null>(null)
  const [deleteActionBusy, setDeleteActionBusy] = useState(false)
  const [signOutBusy, setSignOutBusy] = useState(false)

  type LibraryFolder = { id: string; name: string; createdAt: number }
  const LIB_FOLDERS_KEY = 'yl_library_folders_v1'
  const LIB_LECTURE_LOCATION_KEY = 'yl_library_lecture_location_v1'

  const [libraryFolders, setLibraryFolders] = useState<LibraryFolder[]>(() => {
    try {
      const raw = localStorage.getItem(LIB_FOLDERS_KEY)
      if (!raw) return []
      const arr = JSON.parse(raw) as unknown
      if (!Array.isArray(arr)) return []
      const out: LibraryFolder[] = []
      for (const it of arr) {
        if (!it || typeof it !== 'object') continue
        const o = it as { id?: unknown; name?: unknown; createdAt?: unknown }
        if (typeof o.id !== 'string' || typeof o.name !== 'string') continue
        const createdAt = typeof o.createdAt === 'number' ? o.createdAt : Date.now()
        out.push({ id: o.id, name: o.name, createdAt })
      }
      return out
    } catch {
      return []
    }
  })

  const [libraryLectureLocation, setLibraryLectureLocation] = useState<Record<string, string>>(() => {
    try {
      const raw = localStorage.getItem(LIB_LECTURE_LOCATION_KEY)
      if (!raw) return {}
      const obj = JSON.parse(raw) as unknown
      if (!obj || typeof obj !== 'object') return {}
      const out: Record<string, string> = {}
      for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
        if (typeof v !== 'string') continue
        out[k] = v
      }
      return out
    } catch {
      return {}
    }
  })

  const [libraryCollapsedByFolderId, setLibraryCollapsedByFolderId] = useState<Record<string, boolean>>(
    {},
  )
  const [newFolderInputVisible, setNewFolderInputVisible] = useState(false)
  const [newFolderInputValue, setNewFolderInputValue] = useState('')

  useEffect(() => {
    try {
      localStorage.setItem(LIB_FOLDERS_KEY, JSON.stringify(libraryFolders))
      localStorage.setItem(LIB_LECTURE_LOCATION_KEY, JSON.stringify(libraryLectureLocation))
    } catch {
      /* ignore */
    }
  }, [libraryFolders, libraryLectureLocation])


  const refreshList = useCallback(async () => {
    if (localOnly) {
      setRecordings(await listRecordingsLocal())
    } else {
      setRecordings(await listRecordings(supabase!, userId!))
    }
  }, [localOnly, supabase, userId])

  const [draggingRecordingId, setDraggingRecordingId] = useState<string | null>(null)
  const [dropTargetFolderId, setDropTargetFolderId] = useState<LibraryDropId | null>(null)
  const [dragOverlayRecordingId, setDragOverlayRecordingId] = useState<string | null>(null)
  const fileExplorerScrollRef = useRef<HTMLDivElement | null>(null)
  const suppressItemClickRef = useRef(false)

  const lectureLocationFor = useCallback(
    (recordingId: string): string => libraryLectureLocation[recordingId] ?? 'unfiled',
    [libraryLectureLocation],
  )

  const unfiledRecordings = useMemo(
    () =>
      recordings
        .filter((r) => lectureLocationFor(r.id) === 'unfiled')
        .sort((a, b) => b.createdAt - a.createdAt),
    [recordings, lectureLocationFor],
  )

  const folderRecordingsMap = useMemo(() => {
    const out: Record<string, Recording[]> = {}
    for (const f of libraryFolders) out[f.id] = []
    for (const r of recordings) {
      const loc = lectureLocationFor(r.id)
      if (loc !== 'unfiled' && out[loc]) out[loc].push(r)
    }
    for (const id of Object.keys(out)) {
      out[id].sort((a, b) => b.createdAt - a.createdAt)
    }
    return out
  }, [libraryFolders, recordings, lectureLocationFor])

  const recordingIdsInFolderOrdered = useCallback(
    (folderId: string): string[] => {
      if (folderId === 'unfiled') return unfiledRecordings.map((r) => r.id)
      return (folderRecordingsMap[folderId] ?? []).map((r) => r.id)
    },
    [unfiledRecordings, folderRecordingsMap],
  )

  const applyShiftPickRange = useCallback(
    (anchorId: string, targetId: string) => {
      const fa = lectureLocationFor(anchorId)
      const ft = lectureLocationFor(targetId)
      if (fa !== ft) return
      const order = recordingIdsInFolderOrdered(fa)
      const ia = order.indexOf(anchorId)
      const ib = order.indexOf(targetId)
      if (ia < 0 || ib < 0) return
      const lo = Math.min(ia, ib)
      const hi = Math.max(ia, ib)
      const range = order.slice(lo, hi + 1)
      setLibraryPickedIds((prev) => Array.from(new Set([...prev, ...range])))
    },
    [lectureLocationFor, recordingIdsInFolderOrdered],
  )

  const handleLectureRowClick = useCallback(
    (recordingId: string) => (e: MouseEvent<HTMLButtonElement>) => {
      if (suppressItemClickRef.current) return
      if (libraryPickMode) {
        setLibraryPickedIds((prev) =>
          prev.includes(recordingId) ? prev.filter((x) => x !== recordingId) : [...prev, recordingId],
        )
        libraryShiftAnchorRef.current = recordingId
        return
      }
      if (e.shiftKey && libraryShiftAnchorRef.current) {
        e.preventDefault()
        applyShiftPickRange(libraryShiftAnchorRef.current, recordingId)
        return
      }
      if (e.metaKey || e.ctrlKey) {
        e.preventDefault()
        setLibraryPickedIds((prev) =>
          prev.includes(recordingId) ? prev.filter((x) => x !== recordingId) : [...prev, recordingId],
        )
        libraryShiftAnchorRef.current = recordingId
        return
      }
      setLibrarySelectedFolderId(null)
      setLibraryPickedIds([])
      setLibraryPickMode(false)
      setSelectedId(recordingId)
      libraryShiftAnchorRef.current = recordingId
    },
    [applyShiftPickRange, libraryPickMode],
  )

  useEffect(() => {
    void refreshList()
  }, [refreshList])

  useEffect(() => {
    if (!selectedId) {
      setDetail(null)
      return
    }
    let cancelled = false
    const p = localOnly
      ? getRecordingDetailLocal(selectedId)
      : getRecordingDetail(supabase!, userId!, selectedId)
    void p.then((row) => {
      if (!cancelled) setDetail(row)
    })
    return () => {
      cancelled = true
    }
  }, [selectedId, supabase, userId, localOnly])

  useEffect(() => {
    if (!selectedId) return
    if (!recordings.some((r) => r.id === selectedId)) {
      setSelectedId(null)
      setDetail(null)
    }
  }, [recordings, selectedId])

  useEffect(() => {
    if (!selectedId) hostedAiPollStartedAtRef.current = null
  }, [selectedId])

  useEffect(() => {
    if (localOnly || !usesHosted || !selectedId || !supabase || !userId) return
    const st = detail?.aiStatus
    if (!st || !['queued', 'transcribing', 'summarizing'].includes(st)) {
      hostedAiPollStartedAtRef.current = null
      return
    }
    if (hostedAiPollStartedAtRef.current === null) {
      hostedAiPollStartedAtRef.current = Date.now()
    }

    const id = window.setInterval(() => {
      void (async () => {
        try {
          const started = hostedAiPollStartedAtRef.current
          if (started !== null && Date.now() - started > HOSTED_AI_POLL_MAX_MS) {
            window.clearInterval(id)
            hostedAiPollStartedAtRef.current = null
            const next = await getRecordingDetail(supabase, userId, selectedId)
            if (next) setDetail(next)
            await refreshList()
            return
          }
          const next = await getRecordingDetail(supabase, userId, selectedId)
          if (next) setDetail(next)
          await refreshList()
        } catch {
          /* ignore */
        }
      })()
    }, 2800)
    return () => clearInterval(id)
  }, [localOnly, usesHosted, selectedId, supabase, userId, detail?.aiStatus, refreshList])

  const persistLiveLang = useCallback((value: string) => {
    setLiveLang(value)
    localStorage.setItem(KEY_LIVE_LANG, value)
  }, [])

  const startRecording = () => {
    if (!localOnly && usesHosted) {
      void refreshHostedHealth()
    }
    dispatchFlow({ type: 'LIVE_START' })
    liveCaptionSessionIdRef.current = crypto.randomUUID()
    youmiLiveLog('emit', 'Start pressed: new live session', {
      sessionSuffix: liveCaptionSessionIdRef.current.slice(-12),
      livePipelineEnabled: liveCaptionsPipelineEnabled,
      usesHosted,
      localOnly: Boolean(localOnly),
    })
    liveChunkIndexRef.current = 0
    youmiLiveBatchPartsRef.current = []
    youmiLiveBatchBytesRef.current = 0
    youmiLiveBatchMimeRef.current = ''
    youmiLiveBatchStartedAtRef.current = null
    youmiLiveWarmupBatchesSentRef.current = 0
    if (youmiLiveBatchFlushTimerRef.current) {
      clearTimeout(youmiLiveBatchFlushTimerRef.current)
      youmiLiveBatchFlushTimerRef.current = null
    }
    resetLiveTranscribeRuntime()
    primaryCaptionRef.current = ''
    lastFinalTimestampRef.current = 0
    setPrimaryCaption('')
    setPrimaryCaptionDraft('')
    setLiveCaptionChunkNotice(null)
    setSecondaryCaption('')
    setSecondaryCaptionDraft('')
    secondaryCaptionFullRef.current = ''
    v2CommittedEnRef.current = ''
    v2CommittedEnChunksRef.current = []
    v2CommittedZhChunksRef.current = []
    v2CurrentEnUtteranceRef.current = ''
    v2CurrentZhUtteranceRef.current = ''
    v2OpenUtteranceSeqRef.current = -1
    if (v2UtteranceIdleTimerRef.current != null) {
      clearTimeout(v2UtteranceIdleTimerRef.current)
      v2UtteranceIdleTimerRef.current = null
    }
    v2LastEnInterimRevBySegRef.current.clear()
    if (typeof document !== 'undefined') {
      document.documentElement.lang = liveLang
    }
    void recorder.start()
  }

  const discardRecording = () => {
    dispatchFlow({ type: 'LIVE_DISCARD' })
    liveCaptionSessionIdRef.current = null
    youmiLiveBatchPartsRef.current = []
    youmiLiveBatchBytesRef.current = 0
    youmiLiveBatchMimeRef.current = ''
    youmiLiveBatchStartedAtRef.current = null
    youmiLiveWarmupBatchesSentRef.current = 0
    if (youmiLiveBatchFlushTimerRef.current) {
      clearTimeout(youmiLiveBatchFlushTimerRef.current)
      youmiLiveBatchFlushTimerRef.current = null
    }
    recorder.cancel()
    resetLiveTranscribeRuntime()
    primaryCaptionRef.current = ''
    lastFinalTimestampRef.current = 0
    setPrimaryCaption('')
    setPrimaryCaptionDraft('')
    setLiveCaptionChunkNotice(null)
    setSecondaryCaption('')
    setSecondaryCaptionDraft('')
    secondaryCaptionFullRef.current = ''
    v2CommittedEnRef.current = ''
    v2CommittedEnChunksRef.current = []
    v2CommittedZhChunksRef.current = []
    v2CurrentEnUtteranceRef.current = ''
    v2CurrentZhUtteranceRef.current = ''
    v2OpenUtteranceSeqRef.current = -1
    if (v2UtteranceIdleTimerRef.current != null) {
      clearTimeout(v2UtteranceIdleTimerRef.current)
      v2UtteranceIdleTimerRef.current = null
    }
    v2LastEnInterimRevBySegRef.current.clear()
  }

  const pauseRecording = () => {
    dispatchFlow({ type: 'LIVE_PAUSE' })
    recorder.pause()
  }

  const resumeRecording = () => {
    dispatchFlow({ type: 'LIVE_RESUME' })
    recorder.resume()
  }

  const endCapture = useCallback((outcome: RecentCaptureOutcome) => {
    setRecentCapture(outcome)
    dispatchFlow({ type: 'CAPTURE_FINISHED' })
  }, [])

  const handleStopAndSave = async () => {
    if (saveInFlightRef.current) return
    if (recorder.status !== 'recording' && recorder.status !== 'paused') return

    const recordingId = crypto.randomUUID()

    if (!localOnly && userId && !tryAcquireTabSaveLock(recordingId)) {
      setRecentCapture({
        kind: 'failure',
        recordingId,
        outcome: 'other',
        message:
          'Another tab may be saving a recording. Wait for it to finish, or close other Youmi Lens tabs and try again.',
        at: Date.now(),
      })
      return
    }

    saveInFlightRef.current = true
    setRecentCapture((prev) => nextRecentCaptureForNewSave(prev))
    dispatchFlow({ type: 'CAPTURE_BEGIN', recordingId })

    const releaseLock = () => {
      if (!localOnly && userId) releaseTabSaveLock(recordingId)
    }

    try {
      const uiElapsedSecBeforeStop = recorder.elapsedSec
      const { blob, mime } = await recorder.stop()
      if (import.meta.env.DEV) {
        console.warn(
          '[MainRec][save]',
          JSON.stringify({
            recordingIdTail: recordingId.slice(-8),
            uiElapsedSec: uiElapsedSecBeforeStop,
            durationSource: 'elapsed_state_before_stop',
            blobBytes: blob.size,
            mime,
            t: Date.now(),
          }),
        )
      }
      const drainUntil = Date.now() + 4500
      while (
        Date.now() < drainUntil &&
        (liveTranscribeInFlightRef.current > 0 || liveTranscribeQueueRef.current.length > 0)
      ) {
        await new Promise((r) => window.setTimeout(r, 90))
      }
      const primary = (
        useLiveEngineV2
          ? v2JoinForPersist(v2CommittedEnChunksRef.current, v2CurrentEnUtteranceRef.current)
          : primaryCaptionRef.current
      ).trim()
      const secondary = useLiveEngineV2
        ? v2JoinForPersist(v2CommittedZhChunksRef.current, v2CurrentZhUtteranceRef.current)
        : secondaryCaption.trim()
      const liveText =
        translateTarget === 'off'
          ? primary
          : [
              `[Track A — speech ${liveLang}]`,
              primary || '(empty)',
              '',
              `[Track B — ${translateTarget === 'zh' ? 'Simplified Chinese' : 'English'}]`,
              secondary || '(empty)',
            ].join('\n')
      const liveTranscriptRaw = liveText
      const { canonical: liveTranscriptCanonical } = canonicalizeLectureTranscript(liveTranscriptRaw)
      if (blob.size > MAX_WHISPER_BYTES) {
        endCapture({
          kind: 'failure',
          recordingId,
          outcome: 'other',
          message: recordingTooLargeUserMessage((blob.size / 1024 / 1024).toFixed(1)),
          at: Date.now(),
        })
        ledgerClear(recordingId)
        return
      }

      const courseVal = course.trim() || 'Course'
      const titleVal = title.trim() || `Lecture ${formatDate(Date.now())}`
      const durationSec = uiElapsedSecBeforeStop

      if (localOnly) {
        dispatchFlow({ type: 'CAPTURE_UPLOAD' })
        try {
          await withTimeout(
            saveRecordingLocal({
              id: recordingId,
              course: courseVal,
              title: titleVal,
              createdAt: Date.now(),
              durationSec,
              mime,
              audioBlob: blob,
              liveTranscript: liveTranscriptCanonical || undefined,
              liveTranscriptRaw: liveTranscriptRaw || undefined,
            }),
            SAVE_DB_TIMEOUT_MS,
            'Local save (browser storage)',
          )
        } catch (locErr) {
          const inner = locErr instanceof Error ? locErr.message : String(locErr)
          endCapture({
            kind: 'failure',
            recordingId,
            outcome: 'local_failed',
            message: `Local save failed (browser storage): ${inner}`,
            at: Date.now(),
          })
          ledgerClear(recordingId)
          return
        }

        dispatchFlow({ type: 'CAPTURE_VERIFY' })
        let listOk = true
        try {
          await withTimeout(refreshList(), SAVE_LIST_TIMEOUT_MS, 'Refresh recording list')
        } catch {
          listOk = false
        }
        const verified = await withTimeout(
          getRecordingDetailLocal(recordingId),
          SAVE_META_TIMEOUT_MS,
          'Verify saved recording',
        )
        if (!verified) {
          endCapture({
            kind: 'failure',
            recordingId,
            outcome: 'db_ok_verify_failed',
            message:
              'The recording was written locally but could not be verified immediately. Try refreshing or selecting it again in Recent; if it still does not appear, check browser storage permissions.',
            at: Date.now(),
          })
          ledgerClear(recordingId)
          return
        }
        if (listOk) {
          endCapture({ kind: 'success', recordingId, at: Date.now() })
        } else {
          endCapture({
            kind: 'list_refresh_warn',
            recordingId,
            message:
              'The recording was saved locally but refreshing the list timed out or failed. Refresh the page; it should still be in your local library.',
            at: Date.now(),
          })
        }
        ledgerClear(recordingId)
      } else {
        const path = lectureAudioStoragePath(userId!, recordingId, mime)

        dispatchFlow({ type: 'CAPTURE_UPLOAD' })
        try {
          await withTimeout(
            uploadLectureAudio(supabase!, path, blob, mime),
            SAVE_UPLOAD_TIMEOUT_MS,
            'Audio upload',
          )
        } catch (upErr) {
          const msg =
            upErr instanceof SaveRecordingRemoteError
              ? upErr.message
              : upErr instanceof Error
                ? upErr.message
                : String(upErr)
          let friendly = msg
          if (/bucket not found/i.test(msg)) {
            friendly =
              'Storage bucket missing: in Supabase go to Storage → New bucket, name it exactly lecture-audio, keep it private. Or run the SQL in project file supabase-setup.sql (creates bucket + RLS). Then try Stop & save again.'
          }
          endCapture({
            kind: 'failure',
            recordingId,
            outcome: 'storage_failed',
            message: friendly,
            at: Date.now(),
          })
          ledgerClear(recordingId)
          return
        }
        ledgerMarkUploaded(recordingId, userId!, path)

        dispatchFlow({ type: 'CAPTURE_DB' })
        try {
          await withTimeout(
            insertLectureRecordingRow({
              supabase: supabase!,
              userId: userId!,
              id: recordingId,
              course: courseVal,
              title: titleVal,
              durationSec,
              mime,
              storagePath: path,
              liveTranscript: liveTranscriptCanonical,
              liveTranscriptRaw,
            }),
            SAVE_DB_TIMEOUT_MS,
            'Database write',
          )
        } catch (dbErr) {
          const msg =
            dbErr instanceof SaveRecordingRemoteError
              ? dbErr.message
              : dbErr instanceof Error
                ? dbErr.message
                : String(dbErr)
          endCapture({
            kind: 'failure',
            recordingId,
            outcome: 'storage_ok_db_failed',
            message: `Audio uploaded, but saving the lecture record failed (database). You can try again; upload may be overwritten. Details: ${msg}`,
            at: Date.now(),
          })
          ledgerClear(recordingId)
          return
        }
        ledgerMarkDbCommitted(recordingId, userId!)

        dispatchFlow({ type: 'CAPTURE_VERIFY' })
        let listOk = true
        try {
          await withTimeout(refreshList(), SAVE_LIST_TIMEOUT_MS, 'Refresh recording list')
        } catch {
          listOk = false
        }

        const meta = await withTimeout(
          getRecordingMetaWithRetry(supabase!, userId!, recordingId),
          25_000,
          'Confirm recording in database',
        )

        if (!meta) {
          endCapture({
            kind: 'failure',
            recordingId,
            outcome: 'db_ok_verify_failed',
            message:
              'The recording was written to the cloud but could not be confirmed after retries (network or permissions delay). Refresh and check Recent; avoid deleting audio if duplicate rows appear.',
            at: Date.now(),
          })
          ledgerClear(recordingId)
          return
        }

        if (listOk) {
          endCapture({ kind: 'success', recordingId, at: Date.now() })
        } else {
          endCapture({
            kind: 'list_refresh_warn',
            recordingId,
            message:
              'The recording was saved to the cloud but refreshing the list timed out or failed. Refresh the page; it should still be in the database.',
            at: Date.now(),
          })
        }

        ledgerClear(recordingId)
      }

      primaryCaptionRef.current = ''
      lastFinalTimestampRef.current = 0
      setPrimaryCaption('')
      setPrimaryCaptionDraft('')
      setLiveCaptionChunkNotice(null)
      setSecondaryCaption('')
      setSecondaryCaptionDraft('')
      secondaryCaptionFullRef.current = ''
      v2CommittedEnRef.current = ''
      v2CommittedEnChunksRef.current = []
      v2CommittedZhChunksRef.current = []
      v2CurrentEnUtteranceRef.current = ''
      v2CurrentZhUtteranceRef.current = ''
      v2OpenUtteranceSeqRef.current = -1
      if (v2UtteranceIdleTimerRef.current != null) {
        clearTimeout(v2UtteranceIdleTimerRef.current)
        v2UtteranceIdleTimerRef.current = null
      }
      v2LastEnInterimRevBySegRef.current.clear()
      setSelectedId(recordingId)
      setTitle('')
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Could not save recording'
      let friendly = msg
      if (/bucket not found/i.test(msg)) {
        friendly =
          'Storage bucket missing: in Supabase go to Storage → New bucket, name it exactly lecture-audio, keep it private. Or run the SQL in project file supabase-setup.sql (creates bucket + RLS). Then try Stop & save again.'
      }
      endCapture({
        kind: 'failure',
        recordingId,
        outcome: 'other',
        message: e instanceof AsyncTimeoutError ? e.message : friendly,
        at: Date.now(),
      })
      ledgerClear(recordingId)
    } finally {
      saveInFlightRef.current = false
      releaseLock()
    }
  }

  const runTranscribeAndSummarize = async () => {
    if (!detail) return
    if (transcribeActionLockRef.current) return

    if (!localOnly && usesHosted) {
      if (!hostedConfigured && !stubMode) {
        setRecentAi({
          kind: 'other',
          recordingId: detail.id,
          message: 'Youmi AI setup is not available yet. Try again later or use Advanced mode.',
          at: Date.now(),
        })
        return
      }
      if (!supabase || !userId) return
    } else {
      if (!byokReady) {
        setRecentAi({
          kind: 'other',
          recordingId: detail.id,
          message:
            'Open Account to use Youmi AI or configure advanced options with your own key.',
          at: Date.now(),
        })
        dispatchFlow({ type: 'AI_ERROR', recordingSaved: true })
        return
      }
      if (!usesHosted && !BYOK_PROVIDER_CAPABILITIES[getByokProvider()].transcribe) {
        setRecentAi({
          kind: 'other',
          recordingId: detail.id,
          message:
            'Speech-to-text is not available with your current advanced key setup. Open Account to change the connection type or switch to Youmi AI.',
          at: Date.now(),
        })
        dispatchFlow({ type: 'AI_ERROR', recordingSaved: true })
        return
      }
    }

    transcribeActionLockRef.current = true
    flushSync(() => {
      setTranscribeSubmitPending(true)
    })

    try {
      if (!localOnly && usesHosted) {
        const { data: sess } = await supabase!.auth.getSession()
        const tok = sess.session?.access_token
        if (!tok) {
          setRecentAi({
            kind: 'other',
            recordingId: detail.id,
            message: 'Sign in again to process recordings.',
            at: Date.now(),
          })
          return
        }
        setRecentAi(null)
        const out = await requestHostedRecordingAi({ accessToken: tok, recordingId: detail.id })
        if (!out.ok) {
          setRecentAi({
            kind: 'other',
            recordingId: detail.id,
            message: out.message,
            at: Date.now(),
          })
          return
        }
        try {
          const next = await withTimeout(
            getRecordingDetail(supabase!, userId!, detail.id),
            SAVE_META_TIMEOUT_MS,
            'Refresh recording',
          )
          if (next) setDetail(next)
          await refreshList()
        } catch {
          /* polling will refresh */
        }
        return
      }

      setRecentAi(null)
      flushSync(() => {
        dispatchFlow({ type: 'AI_START', recordingId: detail.id })
      })

      const blob = localOnly
        ? await (async () => {
            const r = await getRecordingWithBlob(detail.id)
            if (!r?.audioBlob) {
              throw new Error('Recording or audio blob not found in local storage.')
            }
            return r.audioBlob
          })()
        : await withTimeout(
            downloadRecordingBlob(supabase!, detail.storagePath),
            AI_DOWNLOAD_TIMEOUT_MS,
            'Download audio for transcription',
          )
      const ext =
        detail.mime.includes('webm') ? 'webm' : detail.mime.includes('mp4') ? 'm4a' : 'audio'

      let transcript: string
      try {
        transcript = await withTimeout(
          transcribeRecording(blob, `lecture.${ext}`, {}),
          AI_TRANSCRIBE_TIMEOUT_MS,
          'Speech transcription',
        )
      } catch (txErr) {
        console.warn('[transcribe]', txErr)
        setRecentAi(
          aiOutcomeToRecent(
            'transcribe_failed',
            detail.id,
            userFacingTranscribeFailure(),
          ),
        )
        dispatchFlow({ type: 'AI_ERROR', recordingSaved: true })
        return
      }

      const transcriptRaw = transcript
      const { canonical: transcriptCanon } = canonicalizeLectureTranscript(transcriptRaw)

      dispatchFlow({ type: 'AI_SUMMARIZE' })
      let summaryEn: string
      let summaryZh: string
      try {
        const sums = await withTimeout(
          summarizeRecording(transcriptCanon, { course: detail.course, title: detail.title }),
          AI_SUMMARIZE_TIMEOUT_MS,
          'Bilingual summary',
        )
        summaryEn = sums.summaryEn
        summaryZh = sums.summaryZh
      } catch (sumErr) {
        console.warn('[summarize]', sumErr)
        try {
          if (localOnly) {
            await withTimeout(
              updateRecordingLocal(detail.id, {
                transcript: transcriptCanon,
                transcriptRaw,
              }),
              AI_PERSIST_TIMEOUT_MS,
              'Save transcript locally',
            )
          } else {
            await withTimeout(
              updateRecordingAi(supabase!, userId!, detail.id, {
                transcript: transcriptCanon,
                transcriptRaw,
              }),
              AI_PERSIST_TIMEOUT_MS,
              'Save transcript to database',
            )
          }
        } catch (persistErr) {
          console.warn('[summarize + persist]', sumErr, persistErr)
          setRecentAi(
            aiOutcomeToRecent(
              'persist_failed',
              detail.id,
              'We could not save your transcript after this step. Try Transcribe & summarize again, or contact support if it continues.',
            ),
          )
          dispatchFlow({ type: 'AI_ERROR', recordingSaved: true })
          return
        }
        const next = localOnly
          ? await getRecordingDetailLocal(detail.id)
          : await getRecordingDetail(supabase!, userId!, detail.id)
        setDetail(next)
        await refreshList()
        setRecentAi(
          aiOutcomeToRecent(
            'summarize_failed',
            detail.id,
            `${userFacingSummarizeFailure()} You can tap Transcribe & summarize again shortly.`,
          ),
        )
        dispatchFlow({ type: 'AI_ERROR', recordingSaved: true })
        return
      }

      if (localOnly) {
        await withTimeout(
          updateRecordingLocal(detail.id, {
            transcript: transcriptCanon,
            transcriptRaw,
            summaryEn,
            summaryZh,
          }),
          AI_PERSIST_TIMEOUT_MS,
          'Save transcript and summaries locally',
        )
        const next = await getRecordingDetailLocal(detail.id)
        setDetail(next)
      } else {
        await withTimeout(
          updateRecordingAi(supabase!, userId!, detail.id, {
            transcript: transcriptCanon,
            transcriptRaw,
            summaryEn,
            summaryZh,
          }),
          AI_PERSIST_TIMEOUT_MS,
          'Save transcript and summaries to database',
        )
        const next = await getRecordingDetail(supabase!, userId!, detail.id)
        setDetail(next)
      }
      await refreshList()
      setRecentAi({ kind: 'success', recordingId: detail.id, at: Date.now() })
      dispatchFlow({ type: 'AI_DONE' })
    } catch (e) {
      console.warn('[ai pipeline]', e)
      setRecentAi(
        aiOutcomeToRecent(
          'other',
          detail.id,
          e instanceof AsyncTimeoutError
            ? 'This step took too long. Your recording should still be safe — try again.'
            : userFacingGenericProcessingFailure(),
        ),
      )
      dispatchFlow({ type: 'AI_ERROR', recordingSaved: true })
    } finally {
      setTranscribeSubmitPending(false)
      transcribeActionLockRef.current = false
    }
  }

  const handleExportLocalBackup = async () => {
    if (!localOnly) return
    setBackupError(null)
    setBackupMsg(null)
    setBackupBusy(true)
    try {
      const rows = await getAllRecordingsLocalWithBlobs()
      if (rows.length === 0) {
        setBackupMsg('No recordings to export yet.')
        return
      }
      const zip = await buildLocalBackupZip(rows)
      const url = URL.createObjectURL(zip)
      const a = document.createElement('a')
      a.href = url
      a.download = `youmi-lens-backup-${new Date().toISOString().slice(0, 10)}.zip`
      a.click()
      URL.revokeObjectURL(url)
      setBackupMsg(`Exported ${rows.length} recording(s). Keep the ZIP somewhere safe (cloud drive, etc.).`)
    } catch (e) {
      setBackupError(e instanceof Error ? e.message : 'Export failed')
    } finally {
      setBackupBusy(false)
    }
  }

  const handleImportLocalBackup = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || !localOnly) return
    setBackupError(null)
    setBackupMsg(null)
    setBackupBusy(true)
    try {
      const overwrite = window.confirm(
        'If a backup item has the same ID as a recording you already have, replace it?\n\nOK = replace\nCancel = skip duplicates and only add new ones',
      )
      const buf = await file.arrayBuffer()
      const { imported, skipped } = await importLocalBackupZip(buf, {
        saveRow: saveRecordingLocal,
        exists: async (id) => (await getRecordingWithBlob(id)) !== null,
        overwrite,
      })
      await refreshList()
      setBackupMsg(`Import finished: ${imported} added or updated, ${skipped} skipped.`)
    } catch (err) {
      setBackupError(err instanceof Error ? err.message : 'Import failed')
    } finally {
      setBackupBusy(false)
    }
  }

  const handleDelete = async (id: string, storagePath: string) => {
    const msg = localOnly
      ? 'Delete this recording from this browser?'
      : 'Delete this recording from the cloud?'
    if (!confirm(msg)) return
    setDeleteActionBusy(true)
    try {
      if (localOnly) {
        await deleteRecordingLocal(id)
      } else {
        await deleteRecordingRemote(supabase!, userId!, id, storagePath)
      }
      setLibraryLectureLocation((prev) => {
        if (!(id in prev)) return prev
        const next = { ...prev }
        delete next[id]
        return next
      })
      if (selectedId === id) setSelectedId(null)
      setLibraryPickedIds((prev) => prev.filter((x) => x !== id))
      await refreshList()
    } finally {
      setDeleteActionBusy(false)
    }
  }

  const createFolder = () => {
    setNewFolderInputValue('')
    setNewFolderInputVisible(true)
  }

  const confirmNewFolder = () => {
    const name = newFolderInputValue.trim()
    setNewFolderInputVisible(false)
    setNewFolderInputValue('')
    if (!name) return
    const id =
      typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `f-${Date.now()}`
    const folder: LibraryFolder = { id, name, createdAt: Date.now() }
    setLibraryFolders((prev) => [folder, ...prev])
  }

  const renameFolder = (folderId: string) => {
    const f = libraryFolders.find((x) => x.id === folderId)
    if (!f) return
    const name = (window.prompt('Rename folder', f.name) || '').trim()
    if (!name) return
    setLibraryFolders((prev) => prev.map((x) => (x.id === folderId ? { ...x, name } : x)))
  }

  const deleteFolder = (folderId: string) => {
    const count = folderRecordingsMap[folderId]?.length ?? 0
    const msg = count
      ? `Delete this folder (keeps ${count} lecture${count === 1 ? '' : 's'})?`
      : 'Delete this empty folder?'
    if (!confirm(msg)) return
    setLibraryFolders((prev) => prev.filter((x) => x.id !== folderId))
    setLibraryLectureLocation((prev) => {
      const next = { ...prev }
      for (const [rid, loc] of Object.entries(next)) {
        if (loc === folderId) next[rid] = 'unfiled'
      }
      return next
    })
    setLibraryCollapsedByFolderId((prev) => {
      const next = { ...prev }
      delete next[folderId]
      return next
    })
  }

  const batchDeleteLectures = async (ids: string[]) => {
    const unique = [...new Set(ids)]
    if (unique.length === 0) return
    const msg = localOnly
      ? `Delete ${unique.length} recording(s) from this browser?`
      : `Delete ${unique.length} recording(s) from the cloud?`
    if (!confirm(msg)) return
    setDeleteActionBusy(true)
    try {
      if (localOnly) {
        for (const id of unique) await deleteRecordingLocal(id)
      } else {
        const { data, error } = await supabase!
          .from('recordings')
          .select('id, storage_path')
          .eq('user_id', userId!)
          .in('id', unique)
        if (error) throw error
        const map = new Map<string, string>()
        for (const row of data ?? []) {
          if (row && typeof row.id === 'string' && typeof (row as { storage_path?: string }).storage_path === 'string') {
            map.set(row.id, (row as { storage_path: string }).storage_path)
          }
        }
        for (const id of unique) {
          const sp = map.get(id)
          if (!sp) continue
          await deleteRecordingRemote(supabase!, userId!, id, sp)
        }
      }
      setLibraryLectureLocation((prev) => {
        const next = { ...prev }
        for (const id of unique) delete next[id]
        return next
      })
      if (selectedId && unique.includes(selectedId)) setSelectedId(null)
      setLibraryPickedIds([])
      setLibraryPickMode(false)
      await refreshList()
    } finally {
      setDeleteActionBusy(false)
    }
  }

  const handleLibraryToolbarDelete = async () => {
    if (libraryPickedIds.length > 0) {
      await batchDeleteLectures(libraryPickedIds)
      return
    }
    if (selectedId) {
      if (detail?.id === selectedId) {
        await handleDelete(selectedId, detail.storagePath)
        return
      }
      if (localOnly) {
        await handleDelete(selectedId, '')
        return
      }
      if (supabase && userId) {
        const d = await getRecordingDetail(supabase, userId, selectedId)
        if (d) await handleDelete(selectedId, d.storagePath)
      }
      return
    }
    if (
      librarySelectedFolderId &&
      librarySelectedFolderId !== 'unfiled' &&
      !libraryPickMode
    ) {
      deleteFolder(librarySelectedFolderId)
    }
  }

  const renameSelectedLibraryFolder = () => {
    if (!librarySelectedFolderId || librarySelectedFolderId === 'unfiled') return
    renameFolder(librarySelectedFolderId)
  }

  const moveLectureToFolder = (recordingId: string, folderId: string) => {
    setLibraryLectureLocation((prev) => ({ ...prev, [recordingId]: folderId }))
  }

  const moveLectureToUnfiled = (recordingId: string) => {
    setLibraryLectureLocation((prev) => ({ ...prev, [recordingId]: 'unfiled' }))
  }

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    }),
  )

  const handleDndStart = useCallback((event: DragStartEvent) => {
    const data = event.active.data.current as { kind?: string; recordingId?: string } | undefined
    if (data?.kind !== 'lecture' || !data.recordingId) return
    setDraggingRecordingId(data.recordingId)
    setDragOverlayRecordingId(data.recordingId)
    suppressItemClickRef.current = true
  }, [])

  const handleDndOver = useCallback(
    (event: DragOverEvent) => {
      const overData = event.over?.data.current as { kind?: string; dropId?: LibraryDropId } | undefined
      if (overData?.kind === 'library-drop' && overData.dropId) {
        setDropTargetFolderId(overData.dropId)
      } else {
        setDropTargetFolderId(null)
      }
    },
    [],
  )

  const resetDndState = useCallback(() => {
    setDraggingRecordingId(null)
    setDragOverlayRecordingId(null)
    setDropTargetFolderId(null)
    window.setTimeout(() => {
      suppressItemClickRef.current = false
    }, 0)
  }, [])

  const handleDndCancel = useCallback(
    (_event: DragCancelEvent) => {
      resetDndState()
    },
    [resetDndState],
  )

  const handleDndEnd = useCallback(
    (event: DragEndEvent) => {
      const activeData = event.active.data.current as { kind?: string; recordingId?: string } | undefined
      const overData = event.over?.data.current as { kind?: string; dropId?: LibraryDropId } | undefined
      if (activeData?.kind === 'lecture' && activeData.recordingId && overData?.kind === 'library-drop' && overData.dropId) {
        if (overData.dropId === 'unfiled') moveLectureToUnfiled(activeData.recordingId)
        else moveLectureToFolder(activeData.recordingId, overData.dropId)
      }
      resetDndState()
    },
    [moveLectureToFolder, moveLectureToUnfiled, resetDndState],
  )

  const audioUrl = detail?.audioUrl ?? null

  useEffect(() => {
    return () => {
      if (audioUrl?.startsWith('blob:')) URL.revokeObjectURL(audioUrl)
    }
  }, [audioUrl])

  const hasLectureSelForToolbar = libraryPickedIds.length > 0 || selectedId !== null
  const canRenameLibraryFolder =
    Boolean(librarySelectedFolderId) &&
    librarySelectedFolderId !== 'unfiled' &&
    !hasLectureSelForToolbar &&
    !libraryPickMode
  const canDeleteLibraryFolderToolbar =
    Boolean(librarySelectedFolderId) &&
    librarySelectedFolderId !== 'unfiled' &&
    !hasLectureSelForToolbar &&
    !libraryPickMode
  const libraryToolbarDeleteEnabled =
    libraryPickedIds.length > 0 || selectedId !== null || canDeleteLibraryFolderToolbar

  const showAccountPanel =
    !localOnly && supabase && userId && onProfileRowChange

  return (
    <>
      {showAccountPanel ? (
        <AccountSettingsModal
          open={accountSettingsOpen}
          onClose={() => setAccountSettingsOpen(false)}
          supabase={supabase}
          userId={userId}
          accountEmail={userEmail}
          profile={profileRow ?? null}
          onSaved={(row) => onProfileRowChange(row)}
          onSignOut={() => {
            setAccountSettingsOpen(false)
            onSignOut?.()
          }}
        />
      ) : null}
      <YoumiLensShell
      welcomeLine={!localOnly ? welcomeLine : undefined}
      topBarActions={
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            flexWrap: 'wrap',
            justifyContent: 'flex-end',
            maxWidth: 'min(720px, 94vw)',
          }}
        >
          <span style={{ color: 'rgba(248,250,252,0.9)', fontSize: '0.8rem', lineHeight: 1.45 }}>
            {localOnly ? (
              <>
                <strong>{userLabel}</strong>. Data stays in this browser only: export ZIP backups below, or add
                Supabase in <code>.env</code> and restart to use cloud sync.
                {onReloadAfterCloudEnv && (
                  <>
                    {' '}
                    <button
                      type="button"
                      className="btn ghost small"
                      style={{ marginLeft: '0.35rem', verticalAlign: 'middle' }}
                      onClick={() => {
                        try {
                          localStorage.removeItem(LC_USE_LOCAL_KEY)
                        } catch {
                          /* ignore */
                        }
                        window.location.reload()
                      }}
                    >
                      Supabase configured — reload to sign in
                    </button>
                  </>
                )}
              </>
            ) : (
              <>
                Signed in as <strong>{userLabel}</strong>
              </>
            )}
          </span>
          {showAccountPanel ? (
            <button
              type="button"
              className="btn ghost small"
              onClick={() => setAccountSettingsOpen(true)}
            >
              Account
            </button>
          ) : null}
          {!localOnly && onSignOut && !showAccountPanel ? (
            <button
              type="button"
              className={`btn ghost small${signOutBusy ? ' is-busy' : ''}`}
              disabled={signOutBusy}
              aria-busy={signOutBusy}
              onClick={() => {
                if (signOutBusy) return
                setSignOutBusy(true)
                void Promise.resolve(onSignOut?.()).finally(() => {
                  setSignOutBusy(false)
                })
              }}
            >
              {signOutBusy ? 'Signing out…' : 'Sign out'}
            </button>
          ) : null}
        </div>
      }
      sidebar={
        <>
          <div className="yl-nav-section">
            <div className="yl-nav-section-label">Workspace</div>
            <nav className="yl-nav" aria-label="Workspace">
              <span className="yl-nav-item yl-active">Record</span>
              <a href="#yl-library" className="yl-nav-item">
                Library
              </a>
              <a href="#yl-settings" className="yl-nav-item">
                Settings
              </a>
            </nav>
          </div>
          <div className="yl-sidebar-divider" aria-hidden />
          <div id="yl-library" className="yl-history-section list-panel">
            <div className="yl-nav-section-label yl-nav-section-label--secondary yl-library-head">
              <span>Lectures</span>
              {!newFolderInputVisible && (
                <button type="button" className="btn ghost small" onClick={createFolder}>
                  New folder
                </button>
              )}
            </div>
            {newFolderInputVisible && (
              <div style={{ padding: '4px 8px 6px' }}>
                <input
                  type="text"
                  autoFocus
                  placeholder="Folder name"
                  value={newFolderInputValue}
                  onChange={(e) => setNewFolderInputValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') confirmNewFolder()
                    if (e.key === 'Escape') { setNewFolderInputVisible(false); setNewFolderInputValue('') }
                  }}
                  onBlur={confirmNewFolder}
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    fontSize: '13px',
                    padding: '4px 8px',
                    borderRadius: '6px',
                    border: '1px solid var(--yl-border, #e2e8f0)',
                    outline: 'none',
                  }}
                />
              </div>
            )}

            <div className="yl-library-toolbar">
              <div className="yl-library-toolbar__row">
                <button
                  type="button"
                  className="btn ghost small"
                  onClick={() => {
                    if (libraryPickMode) {
                      setLibraryPickMode(false)
                      setLibraryPickedIds([])
                    } else {
                      setLibraryPickMode(true)
                      setLibraryPickedIds([])
                      setLibrarySelectedFolderId(null)
                      setSelectedId(null)
                    }
                  }}
                >
                  {libraryPickMode ? 'Done' : 'Select'}
                </button>
                {libraryPickMode ? (
                  <>
                    <button
                      type="button"
                      className="btn ghost small"
                      onClick={() => setLibraryPickedIds(recordings.map((r) => r.id))}
                    >
                      Select all
                    </button>
                    <button type="button" className="btn ghost small" onClick={() => setLibraryPickedIds([])}>
                      Clear
                    </button>
                  </>
                ) : null}
                <button
                  type="button"
                  className="btn ghost small"
                  disabled={!canRenameLibraryFolder}
                  title={
                    !librarySelectedFolderId
                      ? 'Select a folder first (click a folder row).'
                      : librarySelectedFolderId === 'unfiled'
                        ? 'Unfiled cannot be renamed.'
                        : hasLectureSelForToolbar || libraryPickMode
                          ? 'Clear lecture selection or exit Select mode.'
                          : 'Rename the selected folder'
                  }
                  onClick={() => renameSelectedLibraryFolder()}
                >
                  Rename folder
                </button>
                <button
                  type="button"
                  className="btn ghost small"
                  disabled={!libraryToolbarDeleteEnabled || deleteActionBusy}
                  onClick={() => void handleLibraryToolbarDelete()}
                >
                  {deleteActionBusy ? 'Deleting…' : 'Delete'}
                </button>
              </div>
              {(libraryPickMode || libraryPickedIds.length > 0) && (
                <div className="yl-library-multiselect-banner">
                  <span className="yl-library-multiselect-count">{libraryPickedIds.length} selected</span>
                  <button type="button" className="btn ghost small" onClick={() => setLibraryPickedIds([])}>
                    Clear selection
                  </button>
                </div>
              )}
            </div>

            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragStart={handleDndStart}
              onDragOver={handleDndOver}
              onDragCancel={handleDndCancel}
              onDragEnd={handleDndEnd}
            >
              <div
                className="yl-history"
                ref={fileExplorerScrollRef}
              >
                <div className="yl-file-explorer">
                {libraryFolders
                  .slice()
                  .sort((a, b) => b.createdAt - a.createdAt)
                  .map((f) => {
                    const collapsed = Boolean(libraryCollapsedByFolderId[f.id])
                    const items = folderRecordingsMap[f.id] || []
                    return (
                      <section key={f.id} className="yl-recent-group">
                        <DroppableLibraryTarget
                          dropId={f.id}
                          activeDropId={dropTargetFolderId}
                          className={`yl-recent-group-head${librarySelectedFolderId === f.id ? ' is-folder-selected' : ''}`}
                        >
                          <button
                            type="button"
                            className="yl-recent-group-head-btn"
                            aria-expanded={!collapsed}
                            onClick={() => {
                              setLibrarySelectedFolderId(f.id)
                              setSelectedId(null)
                              setLibraryPickedIds([])
                              setLibraryPickMode(false)
                              setLibraryCollapsedByFolderId((prev) => ({
                                ...prev,
                                [f.id]: !Boolean(prev[f.id]),
                              }))
                            }}
                          >
                            <span className="yl-recent-group-chevron" aria-hidden>
                              {collapsed ? '›' : '⌄'}
                            </span>
                            <span className="yl-recent-group-label">
                              <span className="yl-recent-course">{f.name}</span>
                              <span className="yl-recent-count">({items.length})</span>
                            </span>
                          </button>
                        </DroppableLibraryTarget>
                        {!collapsed && items.length > 0 && (
                          <ul className="rec-list yl-recent-items">
                            {items.map((r) => (
                              <li key={r.id}>
                                <div
                                  className={`yl-lecture-row${libraryPickedIds.includes(r.id) ? ' is-picked' : ''}`}
                                >
                                  {libraryPickMode ? (
                                    <label
                                      className="yl-lecture-row__check"
                                      onPointerDown={(e) => e.stopPropagation()}
                                    >
                                      <input
                                        type="checkbox"
                                        checked={libraryPickedIds.includes(r.id)}
                                        onChange={() => {
                                          setLibraryPickedIds((prev) =>
                                            prev.includes(r.id)
                                              ? prev.filter((x) => x !== r.id)
                                              : [...prev, r.id],
                                          )
                                          libraryShiftAnchorRef.current = r.id
                                        }}
                                      />
                                    </label>
                                  ) : null}
                                  <DraggableLectureItem
                                    recordingId={r.id}
                                    selected={r.id === selectedId}
                                    dragging={draggingRecordingId === r.id}
                                    onRowClick={handleLectureRowClick(r.id)}
                                    suppressItemClickRef={suppressItemClickRef}
                                  >
                                    <span className="yl-recent-item-body">
                                      <span className="rec-title">{r.title}</span>
                                      <span className="rec-meta">
                                        {(r.course?.trim() ? r.course.trim() : 'Uncategorized')} ·{' '}
                                        {formatClock(r.durationSec)} · {formatDate(r.createdAt)}
                                      </span>
                                    </span>
                                  </DraggableLectureItem>
                                </div>
                              </li>
                            ))}
                          </ul>
                        )}
                        {!collapsed && items.length === 0 ? <p className="muted">Empty folder.</p> : null}
                      </section>
                    )
                  })}

                <section className="yl-recent-group">
                  <DroppableLibraryTarget
                    dropId="unfiled"
                    activeDropId={dropTargetFolderId}
                    className={`yl-recent-group-head${librarySelectedFolderId === 'unfiled' ? ' is-folder-selected' : ''}`}
                  >
                    <button
                      type="button"
                      className="yl-recent-group-head-btn yl-recent-group-head-btn--unfiled"
                      onClick={() => {
                        setLibrarySelectedFolderId('unfiled')
                        setSelectedId(null)
                        setLibraryPickedIds([])
                        setLibraryPickMode(false)
                      }}
                    >
                      <span className="yl-recent-group-label">
                        <span className="yl-recent-course">Unfiled</span>
                        <span className="yl-recent-count">({unfiledRecordings.length})</span>
                      </span>
                    </button>
                  </DroppableLibraryTarget>
                  {unfiledRecordings.length > 0 ? (
                    <ul className="rec-list yl-recent-items">
                      {unfiledRecordings.map((r) => (
                        <li key={r.id}>
                          <div
                            className={`yl-lecture-row${libraryPickedIds.includes(r.id) ? ' is-picked' : ''}`}
                          >
                            {libraryPickMode ? (
                              <label
                                className="yl-lecture-row__check"
                                onPointerDown={(e) => e.stopPropagation()}
                              >
                                <input
                                  type="checkbox"
                                  checked={libraryPickedIds.includes(r.id)}
                                  onChange={() => {
                                    setLibraryPickedIds((prev) =>
                                      prev.includes(r.id) ? prev.filter((x) => x !== r.id) : [...prev, r.id],
                                    )
                                    libraryShiftAnchorRef.current = r.id
                                  }}
                                />
                              </label>
                            ) : null}
                            <DraggableLectureItem
                              recordingId={r.id}
                              selected={r.id === selectedId}
                              dragging={draggingRecordingId === r.id}
                              onRowClick={handleLectureRowClick(r.id)}
                              suppressItemClickRef={suppressItemClickRef}
                            >
                              <span className="yl-recent-item-body">
                                <span className="rec-title">{r.title}</span>
                                <span className="rec-meta">
                                  {(r.course?.trim() ? r.course.trim() : 'Uncategorized')} ·{' '}
                                  {formatClock(r.durationSec)} · {formatDate(r.createdAt)}
                                </span>
                              </span>
                            </DraggableLectureItem>
                          </div>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="muted">No unfiled lectures.</p>
                  )}
                </section>
                </div>
              </div>
              <DragOverlay>
                {dragOverlayRecordingId ? (
                  <div className="yl-drag-preview" style={{ minWidth: 180, maxWidth: 340 }}>
                    <div className="rec-item is-dragging">
                      <span className="yl-recent-item-body">
                        <span className="rec-title">
                          {recordings.find((r) => r.id === dragOverlayRecordingId)?.title ?? 'Lecture'}
                        </span>
                      </span>
                    </div>
                  </div>
                ) : null}
              </DragOverlay>
            </DndContext>
          </div>
        </>
      }
      recordingStrip={
        <>
          <div className="yl-recording-strip__lead">
            <p className="yl-recording-strip__eyebrow">Now</p>
            <div className="row" style={{ flexWrap: 'wrap', gap: '0.75rem', alignItems: 'flex-end', marginBottom: '0.35rem' }}>
          <label className="field">
            <span>Course</span>
            <input
              className="input"
              value={course}
              onChange={(e) => setCourse(e.target.value)}
              disabled={recorder.status !== 'idle' || saveOrFinishBusy}
            />
          </label>
          <label className="field">
            <span>Lecture title (optional)</span>
            <input
              className="input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={recorder.status !== 'idle' || saveOrFinishBusy}
              placeholder="e.g. Week 3 — sorting"
            />
          </label>
            </div>
            <p className="yl-meta">
              {course.trim() || 'Course'} ·{' '}
              {recorder.status !== 'idle' ? formatClock(recorder.elapsedSec) : '—'} ·{' '}
              {saveOrFinishBusy && capturePhaseLabel(flow.phase)
                ? capturePhaseLabel(flow.phase)
                : recorder.status === 'idle'
                  ? 'Ready'
                  : recorder.status === 'recording'
                    ? 'Recording'
                    : 'Paused'}
            </p>
          </div>
          <div className="yl-recording-strip__controls">
            <div className="yl-timer-block" aria-live="polite">
              <span className="yl-timer-label">Elapsed</span>
              <span className="yl-timer">{formatClock(recorder.elapsedSec)}</span>
            </div>
            <div className="yl-record-actions">
              {recorder.status === 'idle' && (
                <button
                  type="button"
                  className="yl-btn-primary"
                  onClick={startRecording}
                  disabled={saveOrFinishBusy}
                >
                  {saveOrFinishBusy ? 'Please wait…' : 'Start'}
                </button>
              )}
              {recorder.status === 'recording' && (
                <>
                  <button
                    type="button"
                    className="btn secondary"
                    onClick={pauseRecording}
                    disabled={saveOrFinishBusy}
                  >
                    Pause
                  </button>
                  <button
                    type="button"
                    className="btn danger"
                    disabled={saveOrFinishBusy}
                    onClick={() => void handleStopAndSave()}
                  >
                    {stopSaveButtonLabel(flow.phase)}
                  </button>
                </>
              )}
              {recorder.status === 'paused' && (
                <>
                  <button
                    type="button"
                    className="yl-btn-primary"
                    onClick={resumeRecording}
                    disabled={saveOrFinishBusy}
                  >
                    Resume
                  </button>
                  <button
                    type="button"
                    className="btn danger"
                    disabled={saveOrFinishBusy}
                    onClick={() => void handleStopAndSave()}
                  >
                    {stopSaveButtonLabel(flow.phase)}
                  </button>
                </>
              )}
              {recorder.status !== 'idle' && (
                <button
                  type="button"
                  className="btn ghost"
                  onClick={discardRecording}
                  disabled={saveOrFinishBusy}
                >
                  Discard
                </button>
              )}
            </div>
          </div>
        </>
      }
      mainExtra={
        <>
      <header className="hero">
        <h1>Record class, real-time captions, bilingual summaries</h1>
        <p className="lede">
          While you teach or study, Youmi Lens shows live captions and can prepare a full transcript and
          bilingual summaries after class. Spoken language and translation target are set in Session below.
        </p>
            <p className="legal">
          Only record when your professor and local law allow it.{' '}
          {localOnly
            ? 'Audio stays in this browser until you use cloud login.'
            : 'You control data in your Supabase project.'}
        </p>
      </header>

      {localOnly && (
        <section className="panel">
          <h2>Backup &amp; restore</h2>
          <p className="hint small">
            Before switching browsers, devices, or clearing site data, export a ZIP. On a new device open this
            page and import to restore IndexedDB. Independent of cloud sign-in.
          </p>
          <div className="row" style={{ flexWrap: 'wrap', gap: '0.5rem' }}>
            <button
              type="button"
              className="btn secondary"
              disabled={backupBusy || recordings.length === 0}
              onClick={() => void handleExportLocalBackup()}
            >
              Export all (.zip)
            </button>
            <label className="btn secondary" style={{ cursor: backupBusy ? 'not-allowed' : 'pointer' }}>
              Import backup…
              <input
                type="file"
                accept=".zip,application/zip"
                disabled={backupBusy}
                style={{ display: 'none' }}
                onChange={(ev) => void handleImportLocalBackup(ev)}
              />
            </label>
          </div>
          {backupMsg && <p className="hint small" style={{ marginTop: '0.75rem' }}>{backupMsg}</p>}
          {backupError && <p className="error" style={{ marginTop: '0.5rem' }}>{backupError}</p>}
        </section>
      )}

          <section className="panel" id="yl-settings">
            <h2>Session</h2>
            <div className="session-form-row">
              <label className="field session-field">
                <span className="session-field__label">Spoken language</span>
                <select
                  className="input session-field__select"
                  value={liveLang}
                  onChange={(e) => persistLiveLang(e.target.value)}
                  disabled={recorder.status !== 'idle' || saveOrFinishBusy}
                >
                  {LIVE_LANG_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field session-field">
                <span className="session-field__label">Translation</span>
                <select
                  className="input session-field__select"
                  value={translateTarget}
                  onChange={(e) => persistTranslateTarget(e.target.value as LiveTranslateTarget)}
                  disabled={recorder.status !== 'idle' || saveOrFinishBusy}
                >
                  <option value="zh">Translate to Chinese</option>
                  <option value="en">Translate to English</option>
                  <option value="off">Off</option>
                </select>
              </label>
            </div>
        <p className="hint small" style={{ marginTop: '-0.5rem' }}>
          <strong>Primary line</strong> is your spoken language (about every {LIVE_WHISPER_SLICE_SEC}s while
          recording). <strong>Secondary line</strong> is the translation target, line by line, when enabled.
        </p>
        {!postClassAiEnabled ? (
          <p className="hint small" style={{ marginTop: '0.35rem' }}>
            Open <strong>Account</strong> to use <strong>Youmi AI</strong> (recommended) or configure advanced options
            with your own key.
          </p>
        ) : null}

        {recorder.error && <p className="error">{recorder.error}</p>}
        {recentCapture && (
          <div className="recent-outcome" role="status">
            <div className="recent-outcome-head">
              <strong>{recentCaptureHeadline(recentCapture)}</strong>
              <button
                type="button"
                className="btn ghost small"
                onClick={() => setRecentCapture(null)}
              >
                Dismiss
              </button>
            </div>
            {recentCapture.kind === 'success' && (
              <p className="hint small">
                Recording saved {localOnly ? 'locally' : 'to the cloud'}. Open it from Recent on the left.
              </p>
            )}
            {recentCapture.kind === 'list_refresh_warn' && (
              <p className="hint small">{recentCapture.message}</p>
            )}
            {recentCapture.kind === 'failure' && (
              <p className="error small">{recentCapture.message}</p>
            )}
          </div>
        )}
          </section>
        </>
      }
      transcript={
        <>
        {(recorder.status === 'recording' || recorder.status === 'paused') && (
          <>
            {liveCaptionSessionSurface?.tier === 'fatal' && (
              <p className="error" role="alert">
                {liveCaptionSessionSurface.text}
              </p>
            )}
            {liveCaptionSessionSurface?.tier === 'info' && (
              <p className="hint small" style={{ marginBottom: '0.35rem' }}>
                {liveCaptionSessionSurface.text}
              </p>
            )}
            {liveCaptionChunkNotice?.kind === 'fatal' && (
              <p className="error" role="alert">
                {liveCaptionChunkNotice.message}
              </p>
            )}
            {liveCaptionChunkNotice?.kind === 'soft' && (
              <p className="hint small" style={{ marginBottom: '0.35rem' }}>
                {liveCaptionChunkNotice.message}
              </p>
            )}
          </>
        )}
        {(recorder.status === 'recording' || recorder.status === 'paused') && (
          <>
            <div className="live-caption live-caption-primary" aria-live="polite">
              <div className="live-caption-head">
                <div className="live-caption-label">Primary · {spokenLanguageLabel(liveLang)}</div>
                {recorder.status === 'paused' && (
                  <span className="live-pill">Paused — text kept</span>
                )}
              </div>
              <p className="live-caption-hint muted small">{LIVE_CAPTIONS_USER_EXPECTATION_EN}</p>
              <p className="live-caption-hint muted small">
                {useLiveEngineV2 && liveV2CaptionPhase && liveV2CaptionPhase !== 'paused' ? (
                  <>
                    <span className="live-pill" style={{ marginRight: '0.4rem' }}>
                      {liveV2CaptionPhase === 'hearing' ? 'Hearing' : null}
                      {liveV2CaptionPhase === 'drafting' ? 'Draft' : null}
                      {liveV2CaptionPhase === 'refining' ? 'Refining' : null}
                    </span>
                    {liveV2CaptionPhase === 'hearing'
                      ? 'Listening — first words appear within a second.'
                      : null}
                    {liveV2CaptionPhase === 'drafting'
                      ? 'Live — faint text is the current phrase updating in real time.'
                      : null}
                    {liveV2CaptionPhase === 'refining'
                      ? 'Processing — next caption will follow shortly.'
                      : null}
                  </>
                ) : (
                  <>
                    About every {LIVE_WHISPER_SLICE_SEC}s while you speak; faint text means that segment is still
                    updating. Pause stops new segments.
                  </>
                )}
              </p>
              {SHOW_LIVE_ROUTE_DEBUG_UI && (
                <p className="live-caption-hint muted small">
                  Route: {useLiveEngineV2 ? `LiveEngine v2 (${liveRouteState})` : 'Legacy live captions'}
                </p>
              )}
              <div className="live-caption-text live-realtime">
                {primaryCaption && <span className="live-final">{primaryCaption}</span>}
                {primaryCaptionDraft && (
                  <span className="live-interim">
                    {primaryCaption ? ' ' : ''}
                    {primaryCaptionDraft}
                  </span>
                )}
                {liveCaptionPendingSlices > 0 && !useLiveEngineV2 && (
                  <span className="live-interim">
                    {primaryCaption || primaryCaptionDraft ? ' ' : ''}
                    (Updating…)
                  </span>
                )}
                {!primaryCaption && !primaryCaptionDraft && liveCaptionPendingSlices === 0 && (
                  <span className="muted">
                    {recorder.status === 'recording'
                      ? useLiveEngineV2
                        ? 'Speak — captions stream as you go.'
                        : `First segment in ~${LIVE_WHISPER_SLICE_SEC}s after you start…`
                      : 'Paused'}
                  </span>
                )}
              </div>
            </div>
            {translateTarget !== 'off' && (
              <div className="live-caption live-caption-secondary" aria-live="polite">
                <div className="live-caption-head">
                  <div className="live-caption-label">
                    Translation · {translateTarget === 'zh' ? 'Chinese' : 'English'}
                  </div>
                </div>
                <div className="live-caption-text live-realtime">
                  {secondaryCaption ? <span className="live-final">{secondaryCaption}</span> : null}
                  {secondaryCaptionDraft ? (
                    <span className="live-interim">
                      {secondaryCaption ? ' ' : ''}
                      {secondaryCaptionDraft}
                    </span>
                  ) : null}
                  {useLiveEngineV2 && Boolean(primaryCaptionDraft.trim()) && !secondaryCaptionDraft ? (
                    <span className="live-interim muted">Translating…</span>
                  ) : null}
                  {!secondaryCaption &&
                  !secondaryCaptionDraft &&
                  !(useLiveEngineV2 && Boolean(primaryCaptionDraft.trim())) ? (
                    <span className="muted">
                      {liveCaptionsPipelineEnabled
                        ? 'Translated lines appear after each primary line…'
                        : 'Translation will appear here when each line is ready.'}
                    </span>
                  ) : null}
                </div>
              </div>
            )}
          </>
        )}

          {recorder.status === 'idle' && selectedId && !detail && (
            <p className="muted">Loading transcript…</p>
          )}

          {recorder.status === 'idle' && detail && (
            <>
              {detail.liveTranscript && (
                <CollapsibleResultBlock
                  key={`${detail.id}-live`}
                  title="Live captions (saved)"
                  status="Saved"
                >
                  <pre className="scroll subtle result-collapsible__pre">{detail.liveTranscript}</pre>
                </CollapsibleResultBlock>
              )}

              {detail.transcript && (
                <CollapsibleResultBlock
                  key={`${detail.id}-transcript-full`}
                  title="Full transcript"
                  status="Ready"
                >
                  <pre className="scroll result-collapsible__pre">{detail.transcript}</pre>
                </CollapsibleResultBlock>
              )}

              {!detail.liveTranscript && !detail.transcript && (
                <p className="muted small">
                  {!localOnly && usesHosted && detail.aiStatus === 'pending'
                    ? 'No full transcript yet. When you’re ready, open the summary column and tap Generate transcript & summaries.'
                    : 'No transcript yet. Use Transcribe & summarize in the summary column.'}
                </p>
              )}
            </>
          )}

          {recorder.status === 'idle' && !selectedId && (
            <div className="yl-transcript-placeholder">
              <p className="yl-transcript-line">Pick a recording from the sidebar, or start a new session.</p>
              <p className="yl-transcript-line">
                Live captions stream here while you record; saved transcripts appear when you open a lecture.
              </p>
            </div>
          )}
        </>
      }
      summaryHint={
        <p className="yl-summary-hint">
          {detail
            ? 'Bilingual summaries and actions for this session.'
            : selectedId
              ? 'Loading session…'
              : 'Select a recording or start a new session.'}
        </p>
      }
      rightPanel={
        <div className="yl-summary-body">
          {!selectedId && (
            <p className="yl-summary-placeholder muted">Choose a recording to see playback and summaries.</p>
          )}
          {selectedId && !detail && <p className="muted">Loading…</p>}
          {detail && (
            <>
              <div className="detail-head">
                <div>
                  <h3>{detail.title}</h3>
                  <p className="muted">
                    {detail.course} · {formatClock(detail.durationSec)}
                  </p>
                </div>
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
                  <button
                    type="button"
                    className={`btn ghost small${deleteActionBusy ? ' is-busy' : ''}`}
                    disabled={deleteActionBusy}
                    aria-busy={deleteActionBusy}
                    onClick={() => void handleDelete(detail.id, detail.storagePath)}
                  >
                    {deleteActionBusy ? 'Deleting…' : 'Delete'}
                  </button>
                </div>
              </div>

              {audioUrl && (
                <RecordingAudioPlayer
                  recordingId={detail.id}
                  src={audioUrl}
                  durationSecFallback={detail.durationSec}
                />
              )}

              <div className="ai-actions">
                {stubMode && usesHosted && (
                  <p className="hint small" style={{ marginBottom: '0.5rem' }}>
                    Demo mode is active on this device.
                  </p>
                )}
                {hostedUnavailableMessage && (
                  <p className="hint small" style={{ marginBottom: '0.5rem' }}>
                    {hostedUnavailableMessage}
                  </p>
                )}
                {showHostedReadyToGenerateHint && (
                  <p className="hint small" style={{ marginBottom: '0.5rem' }}>
                    Saved. Ready to generate transcript and summaries when you want — tap the button below. Nothing
                    starts automatically after save.
                  </p>
                )}
                {transcribeSubmitPending && !hostedCloudJobActive && !localOnly && usesHosted && (
                  <p className="hint small" aria-live="polite" style={{ marginBottom: '0.5rem' }}>
                    Starting Youmi AI…
                  </p>
                )}
                {hostedCloudJobActive && (
                  <p className="hint small" aria-live="polite" style={{ marginBottom: '0.5rem' }}>
                    {hostedRecordingAiStatusLabel(detail.aiStatus) ?? 'Youmi AI is working…'}
                  </p>
                )}
                {!hostedCloudJobActive &&
                  (flow.phase === 'transcribing' || flow.phase === 'summarizing') && (
                    <p className="hint small" aria-live="polite" style={{ marginBottom: '0.5rem' }}>
                      {flow.phase === 'transcribing'
                        ? 'Transcribing class audio (long lectures may take several minutes)…'
                        : 'Writing bilingual summaries…'}
                    </p>
                  )}
                {detail.aiStatus === 'failed' && (
                  <p className="error small" style={{ marginBottom: '0.5rem' }}>
                    {userFacingHostedJobFailure(detail.aiError)}
                  </p>
                )}
                <button
                  type="button"
                  className={`btn primary${aiPipelineBusy ? ' is-busy' : ''}`}
                  disabled={aiPipelineBusy || Boolean(hostedUnavailableMessage)}
                  aria-busy={aiPipelineBusy}
                  onClick={() => void runTranscribeAndSummarize()}
                >
                  {generateTranscribeButtonLabel}
                </button>
                {recentAi && (
                  <div className="recent-outcome" role="status">
                    <div className="recent-outcome-head">
                      <strong>{recentAiHeadline(recentAi)}</strong>
                      <button
                        type="button"
                        className="btn ghost small"
                        onClick={() => setRecentAi(null)}
                      >
                        Dismiss
                      </button>
                    </div>
                    {recentAi.kind === 'success' && (
                      <p className="hint small">See transcript and summaries below.</p>
                    )}
                    {recentAi.kind !== 'success' && (
                      <p className="error small">{recentAi.message}</p>
                    )}
                  </div>
                )}
              </div>
              {detail.summaryEn && (
                <CollapsibleResultBlock
                  key={`${detail.id}-sum-en`}
                  title="Summary (English)"
                  status="Ready"
                >
                  <div className="markdown scroll result-collapsible__md">{detail.summaryEn}</div>
                </CollapsibleResultBlock>
              )}
              {detail.summaryZh && (
                <CollapsibleResultBlock
                  key={`${detail.id}-sum-zh`}
                  title="Summary (Chinese)"
                  status="Ready"
                >
                  <div className="markdown scroll result-collapsible__md">{detail.summaryZh}</div>
                </CollapsibleResultBlock>
              )}
            </>
          )}
        </div>
      }
    />
    </>
  )

}
