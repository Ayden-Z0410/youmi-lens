/** Map internal failures to safe API messages (no vendor names in JSON). */

export const CLIENT_SAFE_UNAVAILABLE = 'Youmi AI setup is not available yet.'

export function safeJsonError(res, status, _internalReason) {
  res.status(status).json({ error: CLIENT_SAFE_UNAVAILABLE })
}
