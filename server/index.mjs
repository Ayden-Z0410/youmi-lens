import 'dotenv/config'
import cors from 'cors'
import express from 'express'
import { createServer } from 'node:http'
import { handleProcessRecording } from './processRecording.mjs'
import * as youmiHosted from './ai/hosted/youmiHosted.mjs'
import {
  handleHostedSummarize,
  handleHostedTranslateCaption,
  handleHostedTranscribe,
  hostedUpload,
} from './ai/hostedHttp.mjs'
import { handleLiveTranscribeFromUrl } from './liveTranscribeFromUrl.mjs'
import {
  byokTranscribeMiddleware,
  handleByokSummarize,
  handleByokTranscribe,
  handleByokTranslateCaption,
} from './ai/byok/http.mjs'
import { attachLiveRealtimeWs } from './liveRealtimeWs.mjs'
import * as dashEnv from './dashscopeEnv.mjs'
import { audioUploadMiddleware, handleUploadAudio } from './uploadAudio.mjs'
import { handleBetaUsageStatus } from './betaUsageStatus.mjs'
import { handleAuthCheckEmail } from './authCheckEmail.mjs'

const PORT = Number(process.env.PORT || process.env.AI_SERVER_PORT || 3847)

if (process.env.YOUMI_TRANSCRIBE_FORCE_TEST === '1') {
  console.warn(
    '[live-latency] WARNING: YOUMI_TRANSCRIBE_FORCE_TEST=1 — POST /api/transcribe returns stub text; do not use for realtime latency benchmarks.',
  )
}

const app = express()
app.use(cors({ origin: true, credentials: true }))
app.use(express.json({ limit: '2mb' }))

function present(v) {
  return v ? 'present' : 'missing'
}

function envDiagnostics() {
  const hostedEnv = youmiHosted.hostedEnvDiagnostics()
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const supabaseAnon = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY
  return {
    DASHSCOPE_API_KEY: present(hostedEnv.DASHSCOPE_API_KEY),
    DASHSCOPE_OVERSEAS_API_KEY: present(hostedEnv.DASHSCOPE_OVERSEAS_API_KEY),
    DEEPGRAM_API_KEY: present(Boolean(process.env.DEEPGRAM_API_KEY?.trim())),
    OPENAI_API_KEY: present(hostedEnv.OPENAI_API_KEY),
    SUPABASE_URL_or_VITE_SUPABASE_URL: present(Boolean(supabaseUrl)),
    SUPABASE_ANON_KEY_or_VITE_SUPABASE_ANON_KEY: present(Boolean(supabaseAnon)),
    SUPABASE_SERVICE_ROLE_KEY: present(Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY?.trim())),
    ENABLE_STUB_AI: hostedEnv.ENABLE_STUB_AI ? 'enabled' : 'disabled',
  }
}

function runtimeModeSummary() {
  const hostedEnv = youmiHosted.hostedEnvDiagnostics()
  return {
    hostedAdapterId: youmiHosted.HOSTED_ADAPTER_ID || 'unknown',
    hostedRuntimeMode: youmiHosted.hostedRuntimeMode(),
    hostedTranscribeImpl: process.env.YUMI_HOSTED_TRANSCRIBE_IMPL || 'default',
    productAiModeFlag: process.env.VITE_PRODUCT_AI_MODE || 'unset',
    hostedChatModel: hostedEnv.YUMI_QWEN_CHAT_MODEL,
    hostedTranscribeModel: hostedEnv.YUMI_PARAFORMER_MODEL,
    stubAiEnabled: hostedEnv.ENABLE_STUB_AI === true,
  }
}

function liveRealtimeAsrSummary() {
  const exp = (process.env.YOUMI_LIVE_ASR_EXPERIMENT || '').trim().toLowerCase()
  const provider =
    exp === 'volcengine' || exp === 'volc' || exp === 'vol'
      ? 'volcengine'
      : exp === 'deepgram' || exp === 'deep'
        ? 'deepgram'
        : 'dashscope'
  if (provider === 'volcengine') {
    const ok =
      Boolean(process.env.VOLCENGINE_ASR_APP_KEY?.trim()) &&
      Boolean(process.env.VOLCENGINE_ASR_ACCESS_KEY?.trim())
    return { provider, ready: ok }
  }
  if (provider === 'deepgram') {
    return {
      provider,
      ready: Boolean(process.env.DEEPGRAM_API_KEY?.trim()),
      deepgramConfigured: Boolean(process.env.DEEPGRAM_API_KEY?.trim()),
      liveRealtimeEnabled: true,
    }
  }
  return {
    provider,
    ready: Boolean(dashEnv.getDashScopeEffectiveKey()),
    deepgramConfigured: Boolean(process.env.DEEPGRAM_API_KEY?.trim()),
    liveRealtimeEnabled: true,
  }
}

app.get('/api/health', (_req, res) => {
  const hosted = youmiHosted.hostedCapabilities()
  const env = envDiagnostics()
  const mode = runtimeModeSummary()
  const postClassTranscript = Boolean(hosted.transcribe && hosted.summarize)
  const postClassReady = Boolean(hosted.transcribe && hosted.summarize && hosted.translate)
  const liveRt = liveRealtimeAsrSummary()
  res.json({
    ok: true,
    youmiAi: {
      /** V1: full recording upload + post-class transcription + summaries is the primary product path. */
      product: {
        v1PrimaryFlow: 'post_class_transcript',
        liveCaptions: 'beta_preview',
      },
      ready: postClassReady,
      /** After-class transcript + bilingual summaries (process-recording / generate). */
      postClassTranscript,
      /** Near–real-time live captions (beta); same keys as DashScope but not required for V1 readiness. */
      liveCaptions: Boolean(hosted.liveCaptions),
      providerReadiness: {
        dashscope: {
          configured: Boolean(dashEnv.getDashScopeEffectiveKey()),
          region: dashEnv.getDashScopeEffectiveRegion(),
          keySource: dashEnv.getDashScopeKeySource(),
        },
        openaiFallback: {
          configured: Boolean(process.env.OPENAI_API_KEY?.trim()),
        },
        deepgram: {
          configured: Boolean(process.env.DEEPGRAM_API_KEY?.trim()),
        },
        postClass: {
          transcribe: Boolean(hosted.transcribe),
          summarize: Boolean(hosted.summarize),
          translate: Boolean(hosted.translate),
          ready: postClassTranscript,
        },
        liveRealtimeAsr: liveRt,
        liveTranslation: {
          enabled: process.env.YOUMI_LIVE_TRANSLATION_EXPERIMENT === 'enabled',
          envValuePresent: Boolean(process.env.YOUMI_LIVE_TRANSLATION_EXPERIMENT),
          providerReady: Boolean(hosted.translate),
        },
      },
      capabilities: {
        ...hosted,
        postClassTranscript,
      },
      mode,
      env,
    },
  })
})

app.post('/api/auth/check-email', (req, res) => {
  void handleAuthCheckEmail(req, res)
})

app.get('/api/beta-usage-status', (req, res) => {
  void handleBetaUsageStatus(req, res).catch((err) => {
    console.error('[beta-usage-status]', err)
    if (!res.headersSent) {
      res.status(500).json({ error: 'beta_usage_status_failed', message: 'Could not load beta usage status.' })
    }
  })
})

app.post('/api/transcribe', hostedUpload.single('file'), (req, res) => {
  void handleHostedTranscribe(req, res)
})

/** Live captions: client uploads slice to Storage, passes signed GET URL; server runs Paraformer. */
app.post('/api/live-transcribe-url', (req, res) => {
  void handleLiveTranscribeFromUrl(req, res)
})

app.post('/api/summarize', (req, res) => {
  void handleHostedSummarize(req, res)
})

app.post('/api/translate-caption', (req, res) => {
  void handleHostedTranslateCaption(req, res)
})

app.post('/api/byok/transcribe', byokTranscribeMiddleware, (req, res) => {
  void handleByokTranscribe(req, res)
})

app.post('/api/byok/summarize', (req, res) => {
  void handleByokSummarize(req, res)
})

app.post('/api/byok/translate-caption', (req, res) => {
  void handleByokTranslateCaption(req, res)
})

/** Proxy audio upload from Tauri WKWebView → Railway → Supabase Storage (avoids WKWebView binary fetch instability). */
app.post('/api/upload-audio', audioUploadMiddleware, (req, res) => {
  void handleUploadAudio(req, res)
})

app.post('/api/process-recording', express.json({ limit: '256kb' }), (req, res) => {
  void handleProcessRecording(req, res).catch((err) => {
    console.error('[process-recording]', err)
    if (!res.headersSent) {
      res.status(500).json({ error: 'Youmi AI is temporarily unavailable.' })
    }
  })
})

// ── Tauri auth bridge ─────────────────────────────────────────────────────────
// Supabase magic-link / OAuth redirects here from the email client (HTTPS, always
// allowed by email clients and Supabase). The page forwards query + hash to the
// lecturecompanion:// custom scheme so the desktop app receives the deep link.
//
// Add to Supabase → Authentication → URL Configuration → Redirect URLs:
//   https://youmi-lens-production.up.railway.app/tauri-auth-callback
app.get('/tauri-auth-callback', (_req, res) => {
  // Supabase magic-link redirects here after verifying the token. This page uses
  // client-side JS to forward the callback to the lecturecompanion:// scheme.
  //
  // Two token delivery formats are handled:
  //   PKCE flow:    /tauri-auth-callback?code=...         (params in query string)
  //   Implicit flow: /tauri-auth-callback#access_token=... (params in hash — server cannot read)
  //
  // The server never sees or logs hash fragment tokens.
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.send(`<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>Opening Youmi Lens\u2026</title></head>
<body style="font-family:system-ui,sans-serif;color:#333;margin:0;padding:2rem">
<p>Opening Youmi Lens\u2026</p>
<p id="fb" style="color:#888;display:none">If nothing happens, open Youmi Lens and request a new sign-in link.</p>
<script>
(function () {
  // Build the deep-link target using query string (PKCE) and/or hash (implicit tokens).
  // Tokens stay in the browser — this script never sends them to any server.
  var target = 'lecturecompanion://auth-callback' + window.location.search + window.location.hash;
  window.location.replace(target);
  setTimeout(function () {
    var fb = document.getElementById('fb');
    if (fb) fb.style.display = '';
  }, 2500);
})();
</script>
</body>
</html>`)
})

const server = createServer(app)
attachLiveRealtimeWs(server)

server.listen(PORT, '0.0.0.0', () => {
  const marker = process.env.YOUMI_DEPLOY_MARKER || 'dev'
  console.log(`Youmi AI server on http://127.0.0.1:${PORT}`)
  console.log(`[youmi-ai/version] marker=${marker}`)
  const hosted = youmiHosted.hostedCapabilities()
  const env = envDiagnostics()
  const mode = runtimeModeSummary()
  console.log(
    `[youmi-ai/diag] DASHSCOPE_API_KEY=${env.DASHSCOPE_API_KEY} DASHSCOPE_OVERSEAS_API_KEY=${env.DASHSCOPE_OVERSEAS_API_KEY} OPENAI_API_KEY=${env.OPENAI_API_KEY} SUPABASE_URL=${env.SUPABASE_URL_or_VITE_SUPABASE_URL} SUPABASE_ANON_KEY=${env.SUPABASE_ANON_KEY_or_VITE_SUPABASE_ANON_KEY} SUPABASE_SERVICE_ROLE_KEY=${env.SUPABASE_SERVICE_ROLE_KEY}`,
  )
  console.log(
    `[youmi-ai/diag] adapter=${mode.hostedAdapterId} transcribeImpl=${mode.hostedTranscribeImpl} productAiMode=${mode.productAiModeFlag} capabilities=${JSON.stringify(hosted)}`,
  )
})
