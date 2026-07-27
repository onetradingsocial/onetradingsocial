import 'server-only'
import { rollupFills, type Fill } from '@/lib/crypto/fills'
import { mapCycleToTrade } from '@/lib/crypto/map'

// Pure core: fills -> journal rows + the new cursor. No DB, no network, so it
// is fully unit-testable. The cursor is the max fill timestamp seen (even when
// no cycle closed), so an open position is never re-fetched from scratch.
export function planImport(
  fills: Fill[],
  opts: { userId: string; isPublic: boolean; exchange: string },
): { rows: Record<string, unknown>[]; cursor: number | null; warnings: string[] } {
  const { cycles, warnings } = rollupFills(fills)
  const rows = cycles.map((c) => mapCycleToTrade(c, opts))
  const cursor = fills.length ? Math.max(...fills.map((f) => f.timestamp)) : null
  return { rows, cursor, warnings }
}
