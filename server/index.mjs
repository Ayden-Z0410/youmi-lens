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
    exp === 'volcengine' || exp === 'volc' || exp === 'vol' ? 'volcengine' : 'dashscope'
  if (provider === 'volcengine') {
    const ok =
      Boolean(process.env.VOLCENGINE_ASR_APP_KEY?.trim()) &&
      Boolean(process.env.VOLCENGINE_ASR_ACCESS_KEY?.trim())
    return { provider, ready: ok }
  }
  return { provider, ready: Boolean(dashEnv.getDashScopeEffectiveKey()) }
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
        postClass: {
          transcribe: Boolean(hosted.transcribe),
          summarize: Boolean(hosted.summarize),
          translate: Boolean(hosted.translate),
          ready: postClassTranscript,
        },
        liveRealtimeAsr: liveRt,
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
