import { describe, it, expect } from 'vitest'
import {
  imageFileProblem,
  scaledDimensions,
  normaliseContentType,
  isAllowedContentType,
  formatBytes,
  MAX_UPLOAD_BYTES,
  MAX_IMAGE_DIMENSION,
} from '@/lib/image-prep'
import { sniffMt5Format, zipInflatedSize, MAX_XLSX_INFLATED_BYTES } from '@/lib/mt5'

/** Audit item 11 findings F2, F3 and F4. */

describe('imageFileProblem — F2 size gate', () => {
  it('accepts a normal screenshot', () => {
    expect(imageFileProblem({ size: 1_070_352, type: 'image/png' })).toBeNull()
  })

  it('rejects anything over the cap and names both numbers', () => {
    const msg = imageFileProblem({ size: MAX_UPLOAD_BYTES + 1, type: 'image/jpeg' })
    expect(msg).toContain('5.0 MB')
    expect(msg).toMatch(/limit/i)
  })

  it('accepts exactly the cap', () => {
    expect(imageFileProblem({ size: MAX_UPLOAD_BYTES, type: 'image/jpeg' })).toBeNull()
  })

  it('rejects a type outside the two the key builder understands', () => {
    expect(imageFileProblem({ size: 100, type: 'image/svg+xml' })).toMatch(/PNG and JPEG/)
    expect(imageFileProblem({ size: 100, type: 'image/gif' })).toMatch(/PNG and JPEG/)
    expect(imageFileProblem({ size: 100, type: 'text/html' })).toMatch(/PNG and JPEG/)
  })

  it('rejects an empty file', () => {
    expect(imageFileProblem({ size: 0, type: 'image/png' })).toBe('That file is empty.')
  })

  it('matches the bucket cap the migration sets', () => {
    expect(MAX_UPLOAD_BYTES).toBe(5242880)
  })
})

describe('scaledDimensions — F4 downscale', () => {
  it('leaves a small image alone', () => {
    expect(scaledDimensions(800, 600)).toEqual({ width: 800, height: 600 })
  })

  it('fits the longest edge and preserves aspect ratio', () => {
    expect(scaledDimensions(4000, 3000)).toEqual({ width: 2000, height: 1500 })
    expect(scaledDimensions(3000, 4000)).toEqual({ width: 1500, height: 2000 })
  })

  it('handles the exact boundary without resizing', () => {
    expect(scaledDimensions(MAX_IMAGE_DIMENSION, 100))
      .toEqual({ width: MAX_IMAGE_DIMENSION, height: 100 })
  })

  it('never rounds a dimension to zero', () => {
    expect(scaledDimensions(10000, 1).height).toBe(1)
  })

  it('survives a zero-sized image', () => {
    expect(scaledDimensions(0, 0)).toEqual({ width: 0, height: 0 })
  })
})

describe('content types', () => {
  it('keeps PNG as PNG and everything else as JPEG', () => {
    expect(normaliseContentType('image/png')).toBe('image/png')
    expect(normaliseContentType('image/jpeg')).toBe('image/jpeg')
  })

  it('rejects SVG, which is what F1 was about', () => {
    expect(isAllowedContentType('image/svg+xml')).toBe(false)
  })

  it('formats bytes readably', () => {
    expect(formatBytes(5242880)).toBe('5.0 MB')
    expect(formatBytes(120 * 1024)).toBe('120 KB')
  })
})

/** Build a minimal but structurally valid ZIP end-of-central-directory. */
function fakeZip(entries: number[]): ArrayBuffer {
  const CD_ENTRY = 46
  const cdSize = entries.length * CD_ENTRY
  const total = cdSize + 22
  const buf = new ArrayBuffer(total)
  const b = new Uint8Array(buf)
  const view = new DataView(buf)

  entries.forEach((uncompressed, i) => {
    const o = i * CD_ENTRY
    b[o] = 0x50; b[o + 1] = 0x4b; b[o + 2] = 0x01; b[o + 3] = 0x02
    view.setUint32(o + 24, uncompressed, true)
    view.setUint16(o + 28, 0, true) // name length
    view.setUint16(o + 30, 0, true) // extra length
    view.setUint16(o + 32, 0, true) // comment length
  })

  const e = cdSize
  b[e] = 0x50; b[e + 1] = 0x4b; b[e + 2] = 0x05; b[e + 3] = 0x06
  view.setUint16(e + 10, entries.length, true)
  view.setUint32(e + 12, cdSize, true)
  view.setUint32(e + 16, 0, true) // central directory offset
  return buf
}

function bytes(...values: number[]): ArrayBuffer {
  return new Uint8Array(values).buffer
}

function text(s: string): ArrayBuffer {
  return new TextEncoder().encode(s).buffer as ArrayBuffer
}

describe('sniffMt5Format — F3 content-based dispatch', () => {
  it('detects an XLSX by its ZIP signature, not by its name', () => {
    expect(sniffMt5Format(bytes(0x50, 0x4b, 0x03, 0x04, 0x00), 'statement.csv')).toBe('xlsx')
  })

  it('does NOT trust an .xlsx name over the actual bytes', () => {
    expect(sniffMt5Format(text('<html><table><tr><td>Ticket</td></tr></table></html>'), 'evil.xlsx'))
      .toBe('html')
  })

  it('detects HTML from a leading angle bracket, BOM or whitespace', () => {
    expect(sniffMt5Format(text('<!DOCTYPE html><html>'), 'x')).toBe('html')
    expect(sniffMt5Format(text('\n\n   <html>'), 'x')).toBe('html')
  })

  it('detects CSV from delimiters', () => {
    expect(sniffMt5Format(text('Ticket,Symbol,Type,Volume\n1,EURUSD,buy,0.1'), 'x')).toBe('csv')
    expect(sniffMt5Format(text('Ticket;Symbol;Type'), 'x')).toBe('csv')
  })

  it('refuses other binary formats outright', () => {
    expect(sniffMt5Format(bytes(0x25, 0x50, 0x44, 0x46), 'report.xlsx')).toBe('unknown')
    expect(sniffMt5Format(bytes(0xd0, 0xcf, 0x11, 0xe0), 'report.xlsx')).toBe('unknown')
  })

  it('falls back to the filename only when the content is genuinely ambiguous', () => {
    expect(sniffMt5Format(text('Ticket'), 'report.csv')).toBe('csv')
    expect(sniffMt5Format(text('Ticket'), 'report.html')).toBe('html')
    expect(sniffMt5Format(text('Ticket'), 'report.bin')).toBe('unknown')
  })
})

describe('zipInflatedSize — F3 decompression bound', () => {
  it('sums the uncompressed sizes in the central directory', () => {
    expect(zipInflatedSize(fakeZip([1000, 2000, 3000]))).toBe(6000)
  })

  it('spots a bomb before any inflation happens', () => {
    const bomb = zipInflatedSize(fakeZip([900_000_000]))
    expect(bomb).toBeGreaterThan(MAX_XLSX_INFLATED_BYTES)
  })

  it('passes a realistic MT5 workbook', () => {
    const real = zipInflatedSize(fakeZip([120_000, 40_000, 8_000]))
    expect(real).toBeLessThan(MAX_XLSX_INFLATED_BYTES)
  })

  it('returns null rather than guessing when the directory is unreadable', () => {
    expect(zipInflatedSize(bytes(0x50, 0x4b, 0x03, 0x04))).toBeNull()
    expect(zipInflatedSize(text('not a zip at all, not even close'))).toBeNull()
  })

  it('keeps a bound that is generous but finite', () => {
    expect(MAX_XLSX_INFLATED_BYTES).toBe(64 * 1024 * 1024)
  })
})
