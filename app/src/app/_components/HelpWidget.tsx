'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { submitFeedback } from '@/app/actions/feedback'
import { FEEDBACK_TYPES, FEEDBACK_TYPE_LABELS, FEEDBACK_MAX, type FeedbackType } from '@/lib/feedback'
import { track } from '@/lib/track'

export function HelpWidget() {
  const [open, setOpen] = useState(false)
  const [type, setType] = useState<FeedbackType>('bug')
  const [message, setMessage] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)
  const [pending, start] = useTransition()
  const panelRef = useRef<HTMLDivElement>(null)

  // Close on Escape or outside click while open.
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setOpen(false) }
    function onClick(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onClick)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onClick)
    }
  }, [open])

  function reset() {
    setType('bug'); setMessage(''); setError(null); setSent(false)
  }

  function send() {
    setError(null)
    start(async () => {
      const w = window.innerWidth
      const r = await submitFeedback({
        type,
        message,
        pageUrl: window.location.href,
        meta: {
          device: w < 768 ? 'mobile' : w < 1100 ? 'tablet' : 'desktop',
          viewport: `${window.innerWidth}x${window.innerHeight}`,
        },
      })
      if (r.error) { setError(r.error); return }
      setSent(true)
      setMessage('')
      setTimeout(() => { setOpen(false); reset() }, 1600)
    })
  }

  return (
    <div ref={panelRef} className="help-widget">
      {open && (
        <div className="help-panel" role="dialog" aria-label="Send feedback">
          {sent ? (
            <div className="help-sent">
              <strong>Thanks!</strong>
              <span>Your message reached the team.</span>
            </div>
          ) : (
            <>
              <div className="help-panel-head">
                <strong>Help &amp; feedback</strong>
                <button type="button" className="help-close" aria-label="Close" onClick={() => setOpen(false)}>×</button>
              </div>
              <label className="help-field">
                <span>Type</span>
                <select value={type} onChange={(e) => setType(e.target.value as FeedbackType)} disabled={pending}>
                  {FEEDBACK_TYPES.map((t) => (
                    <option key={t} value={t}>{FEEDBACK_TYPE_LABELS[t]}</option>
                  ))}
                </select>
              </label>
              <label className="help-field">
                <span>Message</span>
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  maxLength={FEEDBACK_MAX}
                  rows={4}
                  placeholder="Describe the bug or idea…"
                  disabled={pending}
                />
              </label>
              {error && <p className="help-error">{error}</p>}
              <button type="button" className="btn btn-primary btn-block" onClick={send} disabled={pending || !message.trim()}>
                {pending ? 'Sending…' : 'Send'}
              </button>
            </>
          )}
        </div>
      )}
      <button
        type="button"
        className="help-fab"
        aria-label="Help and feedback"
        aria-expanded={open}
        onClick={() => (open ? setOpen(false) : (reset(), setOpen(true), track('feedback_opened')))}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
        </svg>
        <span>Help</span>
      </button>
    </div>
  )
}
