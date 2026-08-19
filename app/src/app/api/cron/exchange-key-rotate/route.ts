import { NextResponse } from 'next/server'
import { authorizedCron } from '@/lib/cron'
import { createServiceClient } from '@/lib/supabase/service'
import { logError, logInfo } from '@/lib/server/log'
import {
  reencryptExchangeSecrets,
  scanExchangeKeyVersions,
  canRetireVersion,
} from '@/lib/server/secrets-rotation'

/**
 * Operator endpoint for rotating `EXCHANGE_KEY_SECRET` (audit item 10 finding 1).
 *
 * ── WHY THIS IS AN ENDPOINT AND NOT A SCRIPT ────────────────────────────────
 *
 * The master key lives in Vercel's environment, and `docs/secret-rotation.md`
 * would rather it did not also live on a laptop. A local script would have to
 * be handed the production key to do its job — so the pass runs *inside* the
 * deployed app, where the key set already is, and the laptop only sees counts.
 *
 * ── WHY IT IS UNDER /api/cron ───────────────────────────────────────────────
 *
 * Path follows gate: it is protected by `authorizedCron`, the same fail-closed
 * `CRON_SECRET` check as every other route in this directory. It is deliberately
 * NOT registered in `vercel.json` and must never be scheduled — it is invoked by
 * hand, a few times, during one rotation.
 *
 *   MODE=scan (default) — read-only. Which key version does each stored
 *   ciphertext need? This is the guard: `retirable` lists the versions that are
 *   safe to delete from the env, and `missing` must be empty.
 *
 *     curl -H "Authorization: Bearer $CRON_SECRET" \
 *       'https://app.tradingsocial.io/api/cron/exchange-key-rotate?mode=scan'
 *
 *   MODE=migrate — re-encrypt onto the newest key. Add `&dryRun=1` first: it
 *   decrypts and re-encrypts everything and writes nothing, which proves the
 *   deployed key set can read every row before a single row is changed. Safe to
 *   run live, safe to run twice, resumable via `cursor`.
 *
 *     curl -H "Authorization: Bearer $CRON_SECRET" \
 *       'https://app.tradingsocial.io/api/cron/exchange-key-rotate?mode=migrate&dryRun=1'
 *
 *   MODE=retire&version=v1 — the go/no-go answer on removing one key.
 *
 * Responses carry counts, row ids and version labels. No key material, no
 * ciphertext, no plaintext — that is enforced in `secrets-rotation.ts`.
 */

export const maxDuration = 60
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  if (!authorizedCron(req.headers.get('authorization'))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const params = new URL(req.url).searchParams
  const mode = params.get('mode') ?? 'scan'
  const svc = createServiceClient()

  try {
    if (mode === 'scan') {
      const scan = await scanExchangeKeyVersions(svc)
      logInfo('exchange-key-rotate', { mode, rows: scan.rows, byVersion: scan.byVersion })
      return NextResponse.json(scan)
    }

    if (mode === 'retire') {
      const version = params.get('version')
      if (!version) {
        return NextResponse.json({ error: 'version is required, e.g. &version=v1' }, { status: 400 })
      }
      const scan = await scanExchangeKeyVersions(svc)
      const verdict = canRetireVersion(scan, version)
      logInfo('exchange-key-rotate', { mode, version, ok: verdict.ok })
      return NextResponse.json({ version, ...verdict, scan })
    }

    if (mode === 'migrate') {
      const limit = Number(params.get('limit'))
      const report = await reencryptExchangeSecrets(svc, {
        dryRun: params.get('dryRun') === '1',
        cursor: params.get('cursor'),
        maxRows: Number.isFinite(limit) && limit > 0 ? limit : undefined,
      })
      logInfo('exchange-key-rotate', {
        mode,
        dryRun: report.dryRun,
        target: report.target,
        rowsScanned: report.rowsScanned,
        rowsRewritten: report.rowsRewritten,
        rowsAlreadyCurrent: report.rowsAlreadyCurrent,
        rowsRaced: report.rowsRaced,
        failures: report.failures.length,
        done: report.done,
      })
      return NextResponse.json(report)
    }

    return NextResponse.json({ error: 'mode must be scan, migrate or retire' }, { status: 400 })
  } catch (e) {
    // `secrets.ts` and `secrets-rotation.ts` both throw non-leaking messages, and
    // logError redacts on top of that. Still no error body to the caller beyond
    // the fact of failure.
    logError('exchange-key-rotate', e, { mode })
    return NextResponse.json({ error: 'exchange key rotation failed' }, { status: 500 })
  }
}
