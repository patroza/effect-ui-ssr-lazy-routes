/**
 * A page that decides, from data it fetched, that its record is missing (404)
 * or its initial query failed (503) marks its root element with this attribute.
 * The server reads the status back from the rendered HTML, so it cannot drift
 * from what was shown. Kept in its own module so a page can import it without
 * importing the renderer.
 */
export const HTTP_STATUS_ATTRIBUTE = "data-http-status"

/** Back-compatible alias used by 404 resource pages (`ProductDetailPage`). */
export const NOT_FOUND_ATTRIBUTE = HTTP_STATUS_ATTRIBUTE

const httpStatusTag = new RegExp(`<([a-z][^>]*)\\s${HTTP_STATUS_ATTRIBUTE}="(404|503)"`)

/**
 * The HTTP error status declared on an element in the rendered HTML, if any.
 * Text content escapes `<`, so user input (a product id, a path) can't forge the tag.
 */
export const renderedHttpStatus = (html: string): 404 | 503 | undefined => {
  const match = httpStatusTag.exec(html)
  if (match === null) return undefined
  return match[2] === "503" ? 503 : 404
}

/** Whether the rendered HTML carries `data-http-status="404"` on an element. */
export const renderedNotFound = (html: string): boolean => renderedHttpStatus(html) === 404
