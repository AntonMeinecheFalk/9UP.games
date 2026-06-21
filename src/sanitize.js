// XSS-safe sanitization for the rich-text Section type. The editor produces a
// constrained set of tags; we enforce a strict allowlist on the server so that
// whatever an editor pastes can never inject script or dangerous attributes.
import sanitizeHtml from 'sanitize-html';

const RICH_OPTS = {
  allowedTags: [
    'p', 'br', 'h2', 'h3', 'strong', 'b', 'em', 'i', 'u', 'span',
    'ul', 'ol', 'li', 'a', 'blockquote',
  ],
  allowedAttributes: {
    a: ['href', 'target', 'rel'],
    '*': ['style'], // style is kept only where allowedStyles matches (font-size below)
  },
  // Only font-size survives (keyword sizes from execCommand, or explicit units);
  // every other declaration is dropped, so this can't smuggle anything dangerous.
  allowedStyles: {
    '*': {
      'font-size': [
        /^(-webkit-)?(xxx-large|xx-large|x-large|large|medium|small|x-small|xx-small)$/,
        /^\d{1,4}(\.\d+)?(px|pt|rem|em|%)$/,
      ],
      'font-weight': [/^(normal|bold|bolder|lighter|[1-9]00)$/],
      'font-style': [/^(normal|italic|oblique)$/],
    },
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
