import { describe, expect, it } from "vite-plus/test"
import * as Chart from "../src/analytics/components/Chart.ts"

describe("escapeXml", () => {
  it("escapes the five XML special characters", () => {
    expect(Chart.escapeXml(`<a href="x">Tom & 'Jerry'</a>`)).toBe(
      "&lt;a href=&quot;x&quot;&gt;Tom &amp; &apos;Jerry&apos;&lt;/a&gt;"
    )
  })

  it("escapes & first, so it never double-escapes its own output", () => {
    expect(Chart.escapeXml("&lt;")).toBe("&amp;lt;")
  })

  it("leaves plain text alone", () => {
    expect(Chart.escapeXml("Total Revenue (USD)")).toBe("Total Revenue (USD)")
  })
})

describe("lineChartSvg", () => {
  const points = [
    { label: "Q1 & Q2", value: 10 },
    { label: "<script>", value: 20 }
  ]

  it("escapes the title and every point label, so the SVG stays well-formed XML", () => {
    const svg = Chart.lineChartSvg('R&D "2025" <draft>', points)
    expect(svg).toContain('aria-label="R&amp;D &quot;2025&quot; &lt;draft&gt;"')
    expect(svg).toContain(">Q1 &amp; Q2</text>")
    expect(svg).toContain(">&lt;script&gt;</text>")
    expect(svg).not.toContain("<script>")
    const parsed = new DOMParser().parseFromString(svg, "image/svg+xml")
    expect(parsed.querySelector("parsererror")).toBeNull()
    expect(parsed.documentElement.getAttribute("aria-label")).toBe('R&D "2025" <draft>')
  })

  it("survives the data-URI round trip", () => {
    const uri = Chart.svgDataUri(Chart.lineChartSvg("A & B", points))
    expect(uri.startsWith("data:image/svg+xml;charset=utf-8,")).toBe(true)
    expect(decodeURIComponent(uri.slice(uri.indexOf(",") + 1))).toContain("A &amp; B")
  })
})
