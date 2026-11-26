/**
 * A page that decides, from data it fetched, that its record is missing (an
 * unknown product) marks its root element with this attribute. The server reads
 * the status back from the rendered HTML, so it cannot drift from what was
 * shown. Kept in its own module so a page can import it without importing the
 * renderer.
 */
export const NOT_FOUND_ATTRIBUTE = "data-http-status"

const notFoundTag = new RegExp(`<[a-z][^>]*\\s${NOT_FOUND_ATTRIBUTE}="404"`)

/**
 * Whether the rendered HTML carries the marker on an element. Text content
 * escapes `<`, so user input (a product id, a path) can't forge the tag.
 */
export const renderedNotFound = (html: string): boolean => notFoundTag.test(html)
