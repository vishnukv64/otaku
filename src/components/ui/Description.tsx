/**
 * Description Component
 *
 * Safely renders HTML/markdown content for media descriptions.
 * Sanitizes the HTML to prevent XSS attacks while preserving formatting.
 */

import DOMPurify from 'dompurify'

interface DescriptionProps {
  content: string
  className?: string
}

// Configure DOMPurify to allow safe tags and attributes
const ALLOWED_TAGS = [
  'p', 'br', 'b', 'i', 'em', 'strong', 'a', 'ul', 'ol', 'li',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'code', 'pre',
  'span', 'div', 'hr'
]

const ALLOWED_ATTR = ['href', 'target', 'rel', 'class']

export function Description({ content, className = '' }: DescriptionProps) {
  if (!content) return null

  // Sanitize the HTML content
  const sanitizedHtml = DOMPurify.sanitize(content, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    // Add target="_blank" and rel="noopener noreferrer" to all links for security
    ADD_ATTR: ['target'],
    FORBID_TAGS: ['style', 'script', 'iframe', 'form', 'input'],
  })

  // Post-process to ensure all links open in new tab safely
  const processedHtml = sanitizedHtml.replace(
    /<a /g,
    '<a target="_blank" rel="noopener noreferrer" '
  )

  return (
    <div
      className={`description-content prose prose-invert prose-sm max-w-none ${className}`}
      dangerouslySetInnerHTML={{ __html: processedHtml }}
      style={{
        // Override prose defaults for better integration
        lineHeight: '1.7',
      }}
    />
  )
}
