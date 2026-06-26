import { describe, it, expect, vi } from 'vitest'
import { extractMentions } from '@/lib/notifications'
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
