import { describe, it, expect, vi } from 'vitest'
import { extractMentions, insertNotification } from '@/lib/notifications'
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
