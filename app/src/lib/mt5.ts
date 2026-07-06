// MT5 history-report parser + trade mapper. Pure module: no server deps,
// fully unit-testable. Three format readers (HTML/CSV/XLSX) each produce
// string[][]; one extractor locates the Positions table and normalizes rows.

export type Mt5Deal = {
  ticket: string
  symbol: string
  direction: 'long' | 'short'
  lots: number
  openTime: string
  closeTime: string
  openPrice: number
  closePrice: number
  stopPrice: number | null
  targetPrice: number | null
  commission: number
  swap: number
  profit: number
  netPnl: number
}

export type Mt5ParseResult = { deals: Mt5Deal[]; skipped: number }

const NO_POSITIONS =
  'No closed trades found. In MT5: right-click Account History → Report → HTML (or Open XML), then upload that file.'

/** MT5 saves reports as UTF-16LE (BOM FF FE) or UTF-8. */
function decodeReport(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder('utf-16le').decode(buf)
  }
  return new TextDecoder('utf-8').decode(buf)
}

function stripTags(html: string): string {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim()
}

/** HTML → rows of cell text. */
function htmlToRows(html: string): string[][] {
  const rows: string[][] = []
  const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi
  const cellRe = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi
  let tr: RegExpExecArray | null
  while ((tr = trRe.exec(html))) {
    const cells: string[] = []
    let td: RegExpExecArray | null
    cellRe.lastIndex = 0
    while ((td = cellRe.exec(tr[1]))) cells.push(stripTags(td[1]))
    if (cells.length) rows.push(cells)
  }
  return rows
}

/** Minimal CSV reader with quoted-field support. Auto-detects , or ; */
function csvToRows(text: string): string[][] {
  const sep = (text.split(';').length > text.split(',').length) ? ';' : ','
  const rows: string[][] = []
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue
    const cells: string[] = []
    let cur = ''
    let inQ = false
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]
      if (inQ) {
        if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++ }
        else if (ch === '"') inQ = false
        else cur += ch
      } else if (ch === '"') inQ = true
      else if (ch === sep) { cells.push(cur.trim()); cur = '' }
      else cur += ch
    }
    cells.push(cur.trim())
    rows.push(cells)
  }
  return rows
}

/** '1 234.56' / '−12.3' / '' → number | null. */
function num(v: string | undefined): number | null {
  if (v == null) return null
  const cleaned = v.replace(/[\s  ]/g, '').replace(/−/g, '-').replace(/,/g, '.')
  if (cleaned === '') return null
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : null
}

/** '2026.06.01 09:30:00' → '2026-06-01T09:30:00Z' (broker server time). */
function toIso(v: string | undefined): string | null {
  if (!v) return null
  const m = v.trim().match(/^(\d{4})[.\-/](\d{2})[.\-/](\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/)
  if (!m) return null
  return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6] ?? '00'}Z`
}

/** Locate the Positions header row and parse rows beneath it. Column layout
 *  (MetaQuotes report): Time, Position, Symbol, Type, Volume, Price, S/L,
 *  T/P, Time, Price, Commission, Swap, Profit. Rows stop at the next
 *  section header (Orders/Deals/Results) or first unparseable row. */
function extractPositions(rows: string[][]): Mt5ParseResult | { error: string } {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '')
  let header = -1
  for (let i = 0; i < rows.length; i++) {
    const n = rows[i].map(norm)
    if (n.includes('position') && n.includes('symbol') && n.includes('type') && n.includes('volume')) {
      header = i
      break
    }
  }
  if (header === -1) return { error: NO_POSITIONS }

  const cols = rows[header].map(norm)
  const idx = {
    openTime: cols.indexOf('time'),
    ticket: cols.indexOf('position'),
    symbol: cols.indexOf('symbol'),
    type: cols.indexOf('type'),
    volume: cols.indexOf('volume'),
    openPrice: cols.indexOf('price'),
    sl: cols.indexOf('sl'),
    tp: cols.indexOf('tp'),
    closeTime: cols.indexOf('time', cols.indexOf('time') + 1),
    closePrice: cols.indexOf('price', cols.indexOf('price') + 1),
    commission: cols.indexOf('commission'),
    swap: cols.indexOf('swap'),
    profit: cols.indexOf('profit'),
  }

  const deals: Mt5Deal[] = []
  let skipped = 0
  for (let i = header + 1; i < rows.length; i++) {
    const r = rows[i]
    const first = norm(r[0] ?? '')
    if (r.length <= 3 || first === 'orders' || first === 'deals' || first === 'results') break

    const ticket = (r[idx.ticket] ?? '').trim()
    const type = (r[idx.type] ?? '').trim().toLowerCase()
    const openTime = toIso(r[idx.openTime])
    const closeTime = toIso(r[idx.closeTime])
    const lots = num(r[idx.volume]?.split('/')[0])
    const openPrice = num(r[idx.openPrice])
    const closePrice = num(r[idx.closePrice])
    const profit = num(r[idx.profit])

    if (!ticket || !openTime || !closeTime || lots == null || openPrice == null ||
        closePrice == null || profit == null || (type !== 'buy' && type !== 'sell')) {
      skipped++
      continue
    }

    const commission = num(r[idx.commission]) ?? 0
    const swap = num(r[idx.swap]) ?? 0
    deals.push({
      ticket,
      symbol: (r[idx.symbol] ?? '').trim(),
      direction: type === 'buy' ? 'long' : 'short',
      lots,
      openTime,
      closeTime,
      openPrice,
      closePrice,
      stopPrice: idx.sl === -1 ? null : num(r[idx.sl]),
      targetPrice: idx.tp === -1 ? null : num(r[idx.tp]),
      commission,
      swap,
      profit,
      netPnl: Math.round((profit + commission + swap) * 100) / 100,
    })
  }
  if (deals.length === 0) return { error: NO_POSITIONS }
  return { deals, skipped }
}

export function parseMt5(buf: ArrayBuffer, filename: string): Mt5ParseResult | { error: string } {
  const ext = filename.toLowerCase().split('.').pop() ?? ''
  try {
    if (ext === 'html' || ext === 'htm') return extractPositions(htmlToRows(decodeReport(buf)))
    if (ext === 'csv') return extractPositions(csvToRows(decodeReport(buf)))
    if (ext === 'xlsx') return extractPositions(xlsxToRows(buf))
    return { error: 'Unsupported file type. Upload an MT5 report as HTML, XLSX, or CSV.' }
  } catch {
    return { error: 'Could not read this file. Export a fresh report from MT5 and try again.' }
  }
}

/** Placeholder until Task 4 — keeps parseMt5 compiling for HTML/CSV. */
function xlsxToRows(_buf: ArrayBuffer): string[][] {
  throw new Error('xlsx not supported yet')
}
