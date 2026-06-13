// XSS-safe sanitization for the rich-text Section type. The editor produces a
// constrained set of tags; we enforce a strict allowlist on the server so that
// whatever an editor pastes can never inject script or dangerous attributes.
import sanitizeHtml from 'sanitize-html';

const RICH_OPTS = {
  allowedTags: [
    'p', 'br', 'h2', 'h3', 'strong', 'b', 'em', 'i', 'u',
    'ul', 'ol', 'li', 'a', 'blockquote',
  ],
  allowedAttributes: {
    a: ['href', 'target', 'rel'],
  },
  allowedSchemes: ['http', 'https', 'mailto'],
  // Force safe link behavior and prevent reverse-tabnabbing.
  transformTags: {
    a: (tagName, attribs) => ({
      tagName: 'a',
      attribs: {
        ...attribs,
        target: '_blank',
        rel: 'noopener noreferrer nofollow',
      },
    }),
  },
  allowedSchemesByTag: { a: ['http', 'https', 'mailto'] },
  disallowedTagsMode: 'discard',
};

export function sanitizeRichHtml(html) {
  if (typeof html !== 'string') return '';
  return sanitizeHtml(html, RICH_OPTS);
}

// Plain-text escape for everything else rendered into HTML.
export function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Validate + normalize a URL for use in href/src. Returns '' if unsafe.
export function safeUrl(url) {
  if (typeof url !== 'string') return '';
  const trimmed = url.trim();
  if (!trimmed) return '';
  // Allow site-relative URLs.
  if (trimmed.startsWith('/')) return trimmed;
  try {
    const u = new URL(trimmed);
    if (['http:', 'https:', 'mailto:'].includes(u.protocol)) return u.href;
  } catch {
    /* fall through */
  }
  return '';
}
