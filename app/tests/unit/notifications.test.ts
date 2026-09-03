import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { extractMentions, insertNotification, SYSTEM_NOTIF_TYPES } from '@/lib/notifications'
import { getUnreadCount, markAllRead } from '@/lib/server/notifications'

describe('extractMentions', () => {
  it('returns empty array when no mentions', () => {
    expect(extractMentions('Hello world')).toEqual([])
  })
  it('parses single @mention', () => {
    expect(extractMentions('Nice trade @alice!')).toEqual(['alice'])
  })
  it('parses multiple @mentions deduped', () => {
    expect(extractMentions('@bob great call @alice @bob')).toEqual(['bob', 'alice'])
  })
  it('parses mention at start of string', () => {
    expect(extractMentions('@carol check this')).toEqual(['carol'])
  })
  it('ignores email-style patterns', () => {
    // @ preceded by a word char is an email — not a mention
    expect(extractMentions('email me@example.com')).toEqual([])
  })
})

describe('getUnreadCount', () => {
  it('returns count of unread notifications', async () => {
    const supabase = {
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => Promise.resolve({ count: 3, error: null }),
          }),
        }),
      }),
    } as unknown as import('@supabase/supabase-js').SupabaseClient
    expect(await getUnreadCount(supabase, 'user1')).toBe(3)
  })

  it('returns 0 on error', async () => {
    const supabase = {
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => Promise.resolve({ count: null, error: { message: 'err' } }),
          }),
        }),
      }),
    } as unknown as import('@supabase/supabase-js').SupabaseClient
    expect(await getUnreadCount(supabase, 'user1')).toBe(0)
  })
})

function makeInsertSpy() {
  const inserted: unknown[] = []
  const supabase = {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve({ data: null, error: null }),
            }),
          }),
        }),
      }),
      insert: (row: unknown) => { inserted.push(row); return Promise.resolve({ error: null }) },
    }),
  } as unknown as import('@supabase/supabase-js').SupabaseClient
  return { supabase, inserted }
}

describe('insertNotification', () => {
  it('skips when actorId === userId (self-notification)', async () => {
    const { supabase, inserted } = makeInsertSpy()
    await insertNotification({ supabase, userId: 'abc', actorId: 'abc', type: 'like', entityId: 'p1', entityType: 'post' })
    expect(inserted).toHaveLength(0)
  })

  it('inserts when actorId !== userId', async () => {
    const { supabase, inserted } = makeInsertSpy()
    await insertNotification({ supabase, userId: 'user1', actorId: 'user2', type: 'like', entityId: 'p1', entityType: 'post' })
    expect(inserted).toHaveLength(1)
  })

  it('deduplicates follow notifications (existing follow notif → skip)', async () => {
    const supabase = {
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: () => Promise.resolve({ data: { id: 'existing' }, error: null }),
              }),
            }),
          }),
        }),
        insert: () => { throw new Error('should not insert') },
      }),
    } as unknown as import('@supabase/supabase-js').SupabaseClient
    await expect(
      insertNotification({ supabase, userId: 'user1', actorId: 'user2', type: 'follow' })
    ).resolves.toBeUndefined()
  })
})

/**
 * Structural guard, in the spirit of admin-gate.test.ts: read the source text
 * rather than importing it, because actions/notifications.ts is a 'use server'
 * module that drags in next/headers and a request scope vitest has not got.
 *
 * The convention 0049 set — a transactional notice is absent from PREF_KEYS so
 * it cannot be switched off — is enforced nowhere but by whoever remembers it.
 * The failure mode is somebody tidying the list by adding "the missing types",
 * which reads as a fix and silently gives users a switch to turn off the answer
 * to a question they asked.
 */
describe('transactional notices stay out of PREF_KEYS (0049 convention)', () => {
  const src = readFileSync(
    join(process.cwd(), 'src', 'app', 'actions', 'notifications.ts'),
    'utf8',
  )
  const prefKeys = (src.match(/const PREF_KEYS = new Set\(\[([\s\S]*?)\]\)/) ?? [])[1] ?? ''

  it('found the PREF_KEYS list', () => {
    // If the regex stops matching, every assertion below passes vacuously.
    expect(prefKeys).toContain('weekly_report')
  })

  for (const type of ['payment_failed', 'trial_ending', 'trial_expired', 'feedback_reply']) {
    it(`does not offer an opt-out for '${type}'`, () => {
      expect(prefKeys).not.toContain(type)
    })
  }

  it('feedback_reply is nonetheless a real system notification type', () => {
    expect(SYSTEM_NOTIF_TYPES).toContain('feedback_reply')
  })
})
