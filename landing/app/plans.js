/**
 * Youmi Lens plan values — EXACT approved figures, mirrored from the backend
 * source of truth (server/betaGate.mjs limits; $4.99/$49.99 from .env.example
 * + docs/student-pass-phase4-runbook.md). Do NOT change prices/quotas here.
 *
 * plan_type mapping: public_trial → "Free Beta"; student_pass → "Student Basic".
 */
export const FREE = {
  key: 'public_trial',
  name: 'Free Beta',
  monthlyMinutes: 300,
  dailyMinutes: 120,
  maxRecordingMinutes: 60,
  maxLiveSessionMinutes: 60,
  recordingsPerDay: 2,
  processingJobsPerDay: 2,
}

export const PAID = {
  key: 'student_pass',
  name: 'Student Basic',
  monthlyMinutes: 600,
  dailyMinutes: 120,
  maxRecordingMinutes: 90,
  maxLiveSessionMinutes: 90,
  recordingsPerDay: 6,
  processingJobsPerDay: 10,
  entitlementDays: 30,
}

export const PRICE = {
  monthly: { code: 'student_basic_monthly', interval: 'month', usdCents: 499 }, // $4.99 / month
  annual: { code: 'student_basic_annual', interval: 'year', usdCents: 4999 }, // $49.99 / year
}

export const PLAN_DISPLAY = {
  public_trial: 'Free Beta',
  student_pass: 'Student Basic',
  admin: 'Developer',
  developer: 'Developer',
  core_tester: 'Core Tester',
}

export function usd(cents) { return '$' + (cents / 100).toFixed(2) }
export function annualPerMonth() { return '$' + (PRICE.annual.usdCents / 100 / 12).toFixed(2) } // ≈ $4.17
export function mins(m) {
  if (m == null) return '—'
  if (m < 60) return m + ' min'
  const h = m / 60
  return (Number.isInteger(h) ? h : h.toFixed(1)) + ' hr'
}

/** Website comparison rows — exact values only. */
export const COMPARE_ROWS = [
  ['Transcription minutes / month', mins(FREE.monthlyMinutes), mins(PAID.monthlyMinutes)],
  ['Minutes / day', mins(FREE.dailyMinutes), mins(PAID.dailyMinutes)],
  ['Longest single recording', mins(FREE.maxRecordingMinutes), mins(PAID.maxRecordingMinutes)],
  ['Live caption session length', mins(FREE.maxLiveSessionMinutes), mins(PAID.maxLiveSessionMinutes)],
  ['Recordings / day', String(FREE.recordingsPerDay), String(PAID.recordingsPerDay)],
  ['Processing jobs / day', String(FREE.processingJobsPerDay), String(PAID.processingJobsPerDay)],
  ['Works on Mac, Windows & iPad', 'Yes', 'Yes'],
]
