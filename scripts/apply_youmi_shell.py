# -*- coding: utf-8 -*-
"""One-off splice: map RecordingWorkspace return onto YoumiLensShell (preserves UTF-8 from App.tsx)."""
from pathlib import Path


def main() -> None:
    app_path = Path(__file__).resolve().parents[1] / "src" / "App.tsx"
    text = app_path.read_text(encoding="utf-8")
    lines = text.splitlines(keepends=True)

    def s(a: int, b: int) -> str:
        """Inclusive 1-based line range [a, b]."""
        return "".join(lines[a - 1 : b])

    idx_fn = text.find("function RecordingWorkspace")
    start = text.find('  return (\n    <div className="app">', idx_fn)
    end_marker = "        </section>\n      </div>\n    </div>\n  )"
    end = text.find(end_marker, start) + len(end_marker)
    if start < 0 or end < len(end_marker):
        raise SystemExit("Could not find RecordingWorkspace return block")

    inner_signed = s(1138, 1167)
    hero = s(1177, 1188)
    api_inner = s(1192, 1234)
    backup_block = s(1238, 1268)

    course_title_fields = s(1273, 1291)
    lang_col = s(1292, 1306)
    trans_col = s(1308, 1320)
    session_tail = s(1321, 1357)

    whisper_err = s(1358, 1361)
    live_block = s(1363, 1415)
    detail_transcripts = s(1624, 1636)

    list_inner = s(1493, 1514)
    right_detail = s(1523, 1622) + s(1638, 1649)

    new = (
        "  return (\n"
        "    <YoumiLensShell\n"
        "      topBarActions={\n"
        "        <div\n"
        "          style={{\n"
        "            display: 'flex',\n"
        "            alignItems: 'center',\n"
        "            gap: '0.5rem',\n"
        "            flexWrap: 'wrap',\n"
        "            justifyContent: 'flex-end',\n"
        "            maxWidth: 'min(720px, 94vw)',\n"
        "          }}\n"
        "        >\n"
        "          <span style={{ color: 'rgba(248,250,252,0.9)', fontSize: '0.8rem', lineHeight: 1.45 }}>\n"
        + inner_signed
        + "          </span>\n"
        + "          {!localOnly && onSignOut && (\n"
        "            <button type=\"button\" className=\"btn ghost small\" onClick={onSignOut}>\n"
        "              Sign out\n"
        "            </button>\n"
        "          )}\n"
        "        </div>\n"
        "      }\n"
        "      sidebar={\n"
        "        <>\n"
        "          <div className=\"yl-nav-section\">\n"
        "            <div className=\"yl-nav-section-label\">Workspace</div>\n"
        "            <nav className=\"yl-nav\" aria-label=\"Workspace\">\n"
        "              <span className=\"yl-nav-item yl-active\">Record</span>\n"
        "              <a href=\"#yl-recent\" className=\"yl-nav-item\">\n"
        "                Library\n"
        "              </a>\n"
        "              <a href=\"#yl-settings\" className=\"yl-nav-item\">\n"
        "                Settings\n"
        "              </a>\n"
        "            </nav>\n"
        "          </div>\n"
        "          <div className=\"yl-sidebar-divider\" aria-hidden />\n"
        "          <div id=\"yl-recent\" className=\"yl-history-section list-panel\">\n"
        "            <div className=\"yl-nav-section-label yl-nav-section-label--secondary\">Recent</div>\n"
        "            <div className=\"yl-history\">\n"
        + list_inner
        + "            </div>\n"
        "          </div>\n"
        "        </>\n"
        "      }\n"
        "      recordingStrip={\n"
        "        <>\n"
        "          <div className=\"yl-recording-strip__lead\">\n"
        "            <p className=\"yl-recording-strip__eyebrow\">Now</p>\n"
        "            <div className=\"row\" style={{ flexWrap: 'wrap', gap: '0.75rem', alignItems: 'flex-end', marginBottom: '0.35rem' }}>\n"
        + course_title_fields
        + "            </div>\n"
        "            <p className=\"yl-meta\">\n"
        "              {course.trim() || 'Course'} \\u00b7{' '}\n"
        "              {recorder.status !== 'idle' ? formatClock(recorder.elapsedSec) : '\\u2014'} \\u00b7{' '}\n"
        "              {saveOrFinishBusy && capturePhaseLabel(flow.phase)\n"
        "                ? capturePhaseLabel(flow.phase)\n"
        "                : recorder.status === 'idle'\n"
        "                  ? 'Ready'\n"
        "                  : recorder.status === 'recording'\n"
        "                    ? 'Recording'\n"
        "                    : 'Paused'}\n"
        "            </p>\n"
        "          </div>\n"
        "          <div className=\"yl-recording-strip__controls\">\n"
        "            <div className=\"yl-timer-block\" aria-live=\"polite\">\n"
        "              <span className=\"yl-timer-label\">Elapsed</span>\n"
        "              <span className=\"yl-timer\">{formatClock(recorder.elapsedSec)}</span>\n"
        "            </div>\n"
        "            <div className=\"yl-record-actions\">\n"
        "              {recorder.status === 'idle' && (\n"
        "                <button\n"
        "                  type=\"button\"\n"
        "                  className=\"yl-btn-primary\"\n"
        "                  onClick={startRecording}\n"
        "                  disabled={saveOrFinishBusy}\n"
        "                >\n"
        "                  {saveOrFinishBusy ? 'Please wait·' : 'Start'}\n"
        "                </button>\n"
        "              )}\n"
        "              {recorder.status === 'recording' && (\n"
        "                <>\n"
        "                  <button\n"
        "                    type=\"button\"\n"
        "                    className=\"btn secondary\"\n"
        "                    onClick={pauseRecording}\n"
        "                    disabled={saveOrFinishBusy}\n"
        "                  >\n"
        "                    Pause\n"
        "                  </button>\n"
        "                  <button\n"
        "                    type=\"button\"\n"
        "                    className=\"btn danger\"\n"
        "                    disabled={saveOrFinishBusy}\n"
        "                    onClick={() => void handleStopAndSave()}\n"
        "                  >\n"
        "                    {stopSaveButtonLabel(flow.phase)}\n"
        "                  </button>\n"
        "                </>\n"
        "              )}\n"
        "              {recorder.status === 'paused' && (\n"
        "                <>\n"
        "                  <button\n"
        "                    type=\"button\"\n"
        "                    className=\"yl-btn-primary\"\n"
        "                    onClick={resumeRecording}\n"
        "                    disabled={saveOrFinishBusy}\n"
        "                  >\n"
        "                    Resume\n"
        "                  </button>\n"
        "                  <button\n"
        "                    type=\"button\"\n"
        "                    className=\"btn danger\"\n"
        "                    disabled={saveOrFinishBusy}\n"
        "                    onClick={() => void handleStopAndSave()}\n"
        "                  >\n"
        "                    {stopSaveButtonLabel(flow.phase)}\n"
        "                  </button>\n"
        "                </>\n"
        "              )}\n"
        "              {recorder.status !== 'idle' && (\n"
        "                <button\n"
        "                  type=\"button\"\n"
        "                  className=\"btn ghost\"\n"
        "                  onClick={discardRecording}\n"
        "                  disabled={saveOrFinishBusy}\n"
        "                >\n"
        "                  Discard\n"
        "                </button>\n"
        "              )}\n"
        "            </div>\n"
        "          </div>\n"
        "        </>\n"
        "      }\n"
        "      mainExtra={\n"
        "        <>\n"
        + hero
        + "          <section className=\"panel\" id=\"yl-settings\">\n"
        + api_inner
        + "          </section>\n\n"
        + backup_block
        + "\n          <section className=\"panel\">\n"
        "            <h2>Session</h2>\n"
        "            <div className=\"grid2\">\n"
        + lang_col
        + trans_col
        + "            </div>\n"
        + session_tail
        + "          </section>\n"
        "        </>\n"
        "      }\n"
        "      transcript={\n"
        "        <>\n"
        + whisper_err
        + "          {(recorder.status === 'recording' || recorder.status === 'paused') && (\n"
        "            <>\n"
        + live_block
        + "            </>\n"
        "          )}\n\n"
        "          {recorder.status === 'idle' && selectedId && !detail && (\n"
        "            <p className=\"muted\">Loading transcript·</p>\n"
        "          )}\n\n"
        "          {recorder.status === 'idle' && detail && (\n"
        "            <>\n"
        + detail_transcripts
        + "            </>\n"
        "          )}\n\n"
        "          {recorder.status === 'idle' && !selectedId && (\n"
        "            <div className=\"yl-transcript-placeholder\">\n"
        "              <p className=\"yl-transcript-line\">Pick a recording from the sidebar, or start a new session.</p>\n"
        "              <p className=\"yl-transcript-line\">\n"
        "                Live captions stream here while you record; saved transcripts appear when you open a lecture.\n"
        "              </p>\n"
        "            </div>\n"
        "          )}\n"
        "        </>\n"
        "      }\n"
        "      summaryHint={\n"
        "        <p className=\"yl-summary-hint\">\n"
        "          {detail\n"
        "            ? 'Bilingual summaries and actions for this session.'\n"
        "            : selectedId\n"
        "              ? 'Loading session·'\n"
        "              : 'Select a recording or start a new session.'}\n"
        "        </p>\n"
        "      }\n"
        "      rightPanel={\n"
        "        <div className=\"yl-summary-body\">\n"
        "          {!selectedId && (\n"
        "            <p className=\"yl-summary-placeholder muted\">Choose a recording to see playback and summaries.</p>\n"
        "          )}\n"
        "          {selectedId && !detail && <p className=\"muted\">Loading·</p>}\n"
        "          {detail && (\n"
        "            <>\n"
        + right_detail
        + "            </>\n"
        "          )}\n"
        "        </div>\n"
        "      }\n"
        "    />\n"
        "  )\n"
    )

    app_path.write_text(text[:start] + new + text[end:], encoding="utf-8")
    print("Wrote YoumiLensShell mapping to App.tsx")


if __name__ == "__main__":
    main()
