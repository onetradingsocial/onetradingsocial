import sanitizeHtml from 'sanitize-html'

const ALLOWED_TAGS = ['p', 'br', 'strong', 'b', 'em', 'i', 'ul', 'ol', 'li', 'h2', 'h3', 'h4', 'a', 'code', 'pre', 'blockquote']

/** Sanitize trusted-but-untrusted lesson HTML to a tight allowlist. Run on SAVE. */
export function sanitizeLessonHtml(dirty: string): string {
  return sanitizeHtml(dirty ?? '', {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: { a: ['href'] },
    allowedSchemes: ['http', 'https', 'mailto'],
    disallowedTagsMode: 'discard',
  })
}
