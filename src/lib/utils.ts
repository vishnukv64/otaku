/**
 * Utility functions for the Otaku app
 */

/**
 * Combines class names, filtering out falsy values
 * A simple alternative to clsx/classnames without dependencies
 */
export function cn(...classes: (string | undefined | null | false)[]): string {
  return classes.filter(Boolean).join(' ')
}
