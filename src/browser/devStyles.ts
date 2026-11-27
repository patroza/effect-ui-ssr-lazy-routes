/**
 * Removes dev-only SSR `<link rel="stylesheet" href="...?direct">` tags once
 * Vite's JS module import has already mounted the matching
 * `<style data-vite-dev-id="...">` tag in `document.head`.
 *
 * Because removal happens only after the replacement `<style>` is present,
 * there is zero unstyled gap, zero duplicate rules lingering in `<head>`,
 * and full Vite CSS/Tailwind HMR works through `<style data-vite-dev-id>`.
 */
export const removeSupersededDevStylesheets = (doc: Document): number => {
  const activeDevIds = [...doc.head.querySelectorAll("style[data-vite-dev-id]")]
    .map((el) => (el.getAttribute("data-vite-dev-id") ?? "").replaceAll("\\", "/"))
    .filter((id) => id.length > 0)
  if (activeDevIds.length === 0) return 0

  let removed = 0
  for (const link of doc.head.querySelectorAll('link[rel="stylesheet"]')) {
    const rawHref = link.getAttribute("href")
    if (rawHref === null || !URL.canParse(rawHref, "http://localhost")) continue
    const parsed = new URL(rawHref, "http://localhost")
    if (!parsed.searchParams.has("direct")) continue
    if (activeDevIds.some((id) => id.endsWith(parsed.pathname))) {
      link.remove()
      removed += 1
    }
  }
  return removed
}
