import type * as Analytics from "../domain/Analytics.ts"
import "./chart.css"

/**
 * Pure SVG line-chart helper (no DOM, no dependencies). Analytics-only, so it
 * lands in the Analytics page chunk, together with its stylesheet.
 */
export const ANALYTICS_CHART_CHUNK = "SENTINEL:analytics-chart"

const WIDTH = 640
const HEIGHT = 260
const PAD = { top: 16, right: 16, bottom: 28, left: 48 } as const

/** Escapes text for an XML text node or a double-quoted attribute. */
export const escapeXml = (text: string): string =>
  text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;")

const round = (value: number): number => Math.round(value * 10) / 10

export const lineChartSvg = (title: string, points: ReadonlyArray<Analytics.SeriesPoint>): string => {
  const values = points.map((point) => point.value)
  const max = Math.max(1, ...values)
  const innerWidth = WIDTH - PAD.left - PAD.right
  const innerHeight = HEIGHT - PAD.top - PAD.bottom
  const x = (index: number) => PAD.left + (points.length <= 1 ? 0 : (index / (points.length - 1)) * innerWidth)
  const y = (value: number) => PAD.top + innerHeight - (value / max) * innerHeight

  const line = points
    .map((point, index) => `${index === 0 ? "M" : "L"}${round(x(index))} ${round(y(point.value))}`)
    .join(" ")
  const labels = points
    .map(
      (point, index) =>
        `<text x="${round(x(index))}" y="${HEIGHT - 8}" font-size="10" text-anchor="middle" fill="#555">${escapeXml(point.label)}</text>`
    )
    .join("")
  const dots = points
    .map((point, index) => `<circle cx="${round(x(index))}" cy="${round(y(point.value))}" r="3" fill="#0b5fff"/>`)
    .join("")

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" role="img" aria-label="${escapeXml(title)}">` +
    `<rect width="${WIDTH}" height="${HEIGHT}" fill="#fff"/>` +
    `<line x1="${PAD.left}" y1="${PAD.top + innerHeight}" x2="${WIDTH - PAD.right}" y2="${PAD.top + innerHeight}" stroke="#bbb"/>` +
    `<text x="${PAD.left - 6}" y="${PAD.top + 4}" font-size="10" text-anchor="end" fill="#555">${max}</text>` +
    `<text x="${PAD.left - 6}" y="${PAD.top + innerHeight}" font-size="10" text-anchor="end" fill="#555">0</text>` +
    `<path d="${line}" fill="none" stroke="#0b5fff" stroke-width="2"/>${dots}${labels}</svg>`
  )
}

/** An `<img src>` that renders the chart without needing SVG element support in the view layer. */
export const svgDataUri = (svg: string): string => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
