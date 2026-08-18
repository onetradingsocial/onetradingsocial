// MT5 history-report parser + trade mapper. Pure module: no server deps,
// fully unit-testable. Three format readers (HTML/CSV/XLSX) each produce
// string[][]; one extractor locates the Positions table and normalizes rows.

import * as XLSX from 'xlsx'
import { pipInfo } from '@/lib/instruments'

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

/**
 * Sniff the real format from the leading bytes. Audit item 11, finding F3.
 *
 * `parseMt5` used to dispatch on the client-supplied `file.name` extension,
 * which is fully attacker-controlled — naming a file `x.xlsx` forced its bytes
 * into `XLSX.read` whatever they actually were, and the `accept` attribute on
 * the input is cosmetic. The content is what decides now; the filename is only
 * a tiebreaker between the two text formats, which genuinely cannot be told
 * apart by their first four bytes.
 *
 * Exported so the behaviour is testable without constructing a whole report.
 */
export type Mt5Format = 'xlsx' | 'html' | 'csv' | 'unknown'

export function sniffMt5Format(buf: ArrayBuffer, filename = ''): Mt5Format {
  const head = new Uint8Array(buf.slice(0, 4))
  // PK\x03\x04 — every ZIP container, which is what an XLSX is.
  if (head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04) return 'xlsx'
  // Any other binary-looking signature is not a report we can read.
  if (head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44) return 'unknown' // %PDF
  if (head[0] === 0xd0 && head[1] === 0xcf) return 'unknown' // legacy OLE .xls

  // Text from here. MT5's HTML export starts with a BOM, whitespace, `<html`
  // or a doctype; a CSV starts with a column name.
  const text = decodeReport(buf).slice(0, 512).trimStart().toLowerCase()
  if (text.startsWith('<')) return 'html'
  if (/<(html|table|!doctype)/.test(text)) return 'html'
  if (text.includes(',') || text.includes(';') || text.includes('\t')) return 'csv'

  const ext = filename.toLowerCase().split('.').pop() ?? ''
  if (ext === 'html' || ext === 'htm') return 'html'
  if (ext === 'csv') return 'csv'
  return 'unknown'
}

export function parseMt5(buf: ArrayBuffer, filename: string): Mt5ParseResult | { error: string } {
  try {
    switch (sniffMt5Format(buf, filename)) {
      case 'html': return extractPositions(htmlToRows(decodeReport(buf)))
      case 'csv': return extractPositions(csvToRows(decodeReport(buf)))
      case 'xlsx': return extractPositions(xlsxToRows(buf))
      default:
        return { error: 'Unsupported file type. Upload an MT5 report as HTML, XLSX, or CSV.' }
    }
  } catch (err) {
    if (err instanceof Error && err.message === ZIP_BOMB) return { error: ZIP_BOMB }
    return { error: 'Could not read this file. Export a fresh report from MT5 and try again.' }
  }
}

/**
 * Decompression bound. Audit item 11, finding F3.
 *
 * An XLSX is a ZIP, and `XLSX.read` was called with no cap on the decompressed
 * output — so a ~1 MB upload of highly-compressible sheet XML can inflate to
 * hundreds of MB and take the serverless invocation down with an OOM. That is
 * gated behind a Trader subscription and behind the request body limit, so it
 * is a paid-account nuisance rather than an open DoS — but "buy one cheap
 * subscription" is not a defence.
 *
 * The cap is applied where it is cheap and certain: the ZIP central directory
 * records every entry's uncompressed size, so the total is known BEFORE any
 * inflation happens. A legitimate MT5 XLSX of 500 positions is comfortably
 * under a megabyte of sheet XML; 64 MB is roughly two orders of magnitude of
 * headroom and still small enough that inflating it cannot exhaust the
 * function.
 *
 * `MAX_COMMIT_ROWS = 500` further down stays as the backstop on what can
 * actually reach the database.
 */
export const MAX_XLSX_INFLATED_BYTES = 64 * 1024 * 1024
const ZIP_BOMB = 'That spreadsheet expands to far more data than an MT5 report should. Export a fresh report from MT5.'

/**
 * Sum the uncompressed sizes recorded in a ZIP's central directory.
 *
 * Returns null when the structure cannot be read, in which case the caller
 * proceeds — an unreadable directory means `XLSX.read` is about to fail anyway,
 * and refusing on a parse quirk would reject valid files.
 */
export function zipInflatedSize(buf: ArrayBuffer): number | null {
  const b = new Uint8Array(buf)
  // End of Central Directory: signature PK\x05\x06, within the last 64KB+22.
  const start = Math.max(0, b.length - (0xffff + 22))
  let eocd = -1
  for (let i = b.length - 22; i >= start; i -= 1) {
    if (b[i] === 0x50 && b[i + 1] === 0x4b && b[i + 2] === 0x05 && b[i + 3] === 0x06) { eocd = i; break }
  }
  if (eocd < 0) return null

  const view = new DataView(buf)
  const entries = view.getUint16(eocd + 10, true)
  let offset = view.getUint32(eocd + 16, true)
  if (offset >= b.length) return null

  let total = 0
  for (let n = 0; n < entries; n += 1) {
    if (offset + 46 > b.length) return null
    // Central directory file header: PK\x01\x02
    if (!(b[offset] === 0x50 && b[offset + 1] === 0x4b && b[offset + 2] === 0x01 && b[offset + 3] === 0x02)) return null
    total += view.getUint32(offset + 24, true) // uncompressed size
    const nameLen = view.getUint16(offset + 28, true)
    const extraLen = view.getUint16(offset + 30, true)
    const commentLen = view.getUint16(offset + 32, true)
    offset += 46 + nameLen + extraLen + commentLen
  }
  return total
}

function xlsxToRows(buf: ArrayBuffer): string[][] {
  const inflated = zipInflatedSize(buf)
  if (inflated !== null && inflated > MAX_XLSX_INFLATED_BYTES) throw new Error(ZIP_BOMB)

  const wb = XLSX.read(buf, { type: 'array' })
  const ws = wb.Sheets[wb.SheetNames[0]]
  // Second bound, for the case the central directory lied or was unreadable:
  // reject a sheet whose declared range is far larger than any MT5 report.
  const ref = (ws as { '!ref'?: string })?.['!ref']
  if (ref) {
    const range = XLSX.utils.decode_range(ref)
    const cells = (range.e.r - range.s.r + 1) * (range.e.c - range.s.c + 1)
    if (cells > 2_000_000) throw new Error(ZIP_BOMB)
  }
  const raw = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: false, defval: '' })
  return raw.map((row) => row.map((c) => String(c ?? '').trim()))
}

const CURRENCIES = new Set(['EUR', 'USD', 'GBP', 'JPY', 'AUD', 'NZD', 'CAD', 'CHF', 'SGD', 'NOK', 'SEK', 'ZAR', 'MXN', 'PLN', 'TRY', 'CNH', 'HKD'])
const CRYPTO = /^(BTC|ETH|XRP|LTC|SOL|ADA|DOGE|DOT|BNB|AVAX)/
const INDICES = /^(US30|US100|US500|USTEC|NAS100|SPX|SP500|DJ30|GER30|GER40|DAX|DE40|UK100|FTSE|FRA40|EU50|JP225|JPN225|NIKKEI|HK50|AUS200)/
const METALS = /^(XAU|XAG|XPT|XPD|XTI|XBR|GOLD|SILVER|OIL|BRENT|WTI|NGAS|UKOIL|USOIL)/

/** Best-effort market class from a raw broker symbol (suffixes stripped). */
export function inferMarket(symbol: string): string {
  const s = symbol.toUpperCase().replace(/[^A-Z0-9].*$/, '')
  if (METALS.test(s)) return 'commodities'
  if (CRYPTO.test(s)) return 'crypto'
  if (INDICES.test(s)) return 'indices'
  if (s.length >= 6 && CURRENCIES.has(s.slice(0, 3)) && CURRENCIES.has(s.slice(3, 6))) return 'forex'
  return 'stocks'
}

const MAX_COMMIT_ROWS = 500

/** Server-side re-validation of client-echoed rows before commit. */
export function validateDeals(input: unknown): { deals: Mt5Deal[] } | { error: string } {
  if (!Array.isArray(input) || input.length === 0) return { error: 'Nothing to import.' }
  if (input.length > MAX_COMMIT_ROWS) return { error: `Too many rows (max ${MAX_COMMIT_ROWS} per import).` }
  const deals: Mt5Deal[] = []
  for (const raw of input) {
    if (typeof raw !== 'object' || raw == null) return { error: 'Invalid import payload.' }
    const d = raw as Record<string, unknown>
    const fin = (v: unknown) => typeof v === 'number' && Number.isFinite(v)
    const finOrNull = (v: unknown) => v === null || fin(v)
    const isoRe = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/
    if (
      typeof d.ticket !== 'string' || !d.ticket.trim() || d.ticket.length > 32 ||
      typeof d.symbol !== 'string' || !d.symbol.trim() || d.symbol.length > 32 ||
      (d.direction !== 'long' && d.direction !== 'short') ||
      !fin(d.lots) || (d.lots as number) <= 0 ||
      !fin(d.openPrice) || !fin(d.closePrice) || !fin(d.netPnl) ||
      !fin(d.commission) || !fin(d.swap) || !fin(d.profit) ||
      !finOrNull(d.stopPrice) || !finOrNull(d.targetPrice) ||
      typeof d.openTime !== 'string' || !isoRe.test(d.openTime) ||
      typeof d.closeTime !== 'string' || !isoRe.test(d.closeTime)
    ) return { error: 'Invalid import payload.' }
    deals.push({
      ticket: d.ticket.trim(), symbol: d.symbol.trim(), direction: d.direction,
      lots: d.lots as number, openTime: d.openTime, closeTime: d.closeTime,
      openPrice: d.openPrice as number, closePrice: d.closePrice as number,
      stopPrice: (d.stopPrice ?? null) as number | null,
      targetPrice: (d.targetPrice ?? null) as number | null,
      commission: d.commission as number, swap: d.swap as number,
      profit: d.profit as number, netPnl: d.netPnl as number,
    })
  }
  return { deals }
}

/** Mt5Deal → trades insert row. Journaling fields stay empty for the user
 *  to enrich. r_multiple only when a stop exists (risk is defined). */
export function mapDealToTrade(
  deal: Mt5Deal,
  opts: { userId: string; isPublic: boolean; source?: 'statement' | 'broker' },
): Record<string, unknown> {
  const market = inferMarket(deal.symbol)
  // Normalize symbol for catalog lookup: strip broker suffix (e.g. 'GBPJPY.a' →
  // 'GBPJPY'), same stripping rule as inferMarket, then insert a slash for
  // 6-letter forex pairs ('EURUSD' → 'EUR/USD').
  const stripped = deal.symbol.toUpperCase().replace(/[^A-Z0-9].*$/, '')
  const normalizedSymbol = /^[A-Z]{6}$/.test(stripped)
    ? `${stripped.slice(0, 3)}/${stripped.slice(3)}`
    : stripped
  const { pipSize, pipValuePerLot } = pipInfo(normalizedSymbol, market)

  let slPips = 0
  let riskAmount = 0
  let rMultiple: number | null = null
  if (deal.stopPrice != null && deal.stopPrice > 0) {
    // Round to 1dp (same precision as realized_pips) to avoid float noise
    // (e.g. 30.000000000001137) landing in the DB; risk math uses the
    // rounded value for consistency with the stored sl_pips.
    slPips = Math.round((Math.abs(deal.openPrice - deal.stopPrice) / pipSize) * 10) / 10
    if (pipValuePerLot != null && Number.isFinite(pipValuePerLot) && pipValuePerLot > 0) {
      riskAmount = slPips * pipValuePerLot * deal.lots
      if (riskAmount > 0) rMultiple = Math.round((deal.netPnl / riskAmount) * 100) / 100
    }
  }

  const dirSign = deal.direction === 'long' ? 1 : -1
  const realizedPips = ((deal.closePrice - deal.openPrice) * dirSign) / pipSize

  return {
    user_id: opts.userId,
    broker_deal_id: deal.ticket,
    // Verification level: file/statement upload vs live MetaApi sync.
    source: opts.source ?? 'statement',
    market,
    instrument: deal.symbol,
    direction: deal.direction,
    sizing_mode: 'lots',
    lots: deal.lots,
    risk_percent: null,
    entry_price: deal.openPrice,
    exit_price: deal.closePrice,
    stop_price: deal.stopPrice,
    target_price: deal.targetPrice,
    risk_amount: riskAmount,
    sl_pips: slPips,
    tp_pips: null,
    planned_rr: null,
    r_multiple: rMultiple,
    pnl_amount: deal.netPnl,
    realized_pips: Math.round(realizedPips * 10) / 10,
    outcome: deal.netPnl > 0 ? 'win' : deal.netPnl < 0 ? 'loss' : 'breakeven',
    status: 'closed',
    is_public: opts.isPublic,
    traded_at: deal.openTime,
    closed_at: deal.closeTime,
  }
}
