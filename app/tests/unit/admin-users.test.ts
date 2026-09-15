import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { userTierSummary } from '@/lib/admin-users'
import {
  normalizeAccountFilter, normalizeSubFilter, normalizeCompFilter, isInternalRow,
} from '@/lib/admin-users'

const ADMINS = ['boss@x.com']

describe('userTierSummary', () => {
  it('admin email always resolves to pro/Admin', () => {
    expect(userTierSummary({ email: 'boss@x.com', compTier: null, subTier: null, subStatus: null, adminEmails: ADMINS }))
      .toEqual({ tier: 'pro', source: 'Admin' })
  })
  it('comp tier shows as Comp when no higher paid tier', () => {
    expect(userTierSummary({ email: 'a@x.com', compTier: 'pro', subTier: null, subStatus: null, adminEmails: ADMINS }))
      .toEqual({ tier: 'pro', source: 'Comp' })
  })
  it('active paid sub shows as Paid', () => {
    expect(userTierSummary({ email: 'a@x.com', compTier: null, subTier: 'trader', subStatus: 'active', adminEmails: ADMINS }))
      .toEqual({ tier: 'trader', source: 'Paid' })
  })
  it('higher paid tier wins over lower comp, source is Paid', () => {
    expect(userTierSummary({ email: 'a@x.com', compTier: 'trader', subTier: 'pro', subStatus: 'active', adminEmails: ADMINS }))
      .toEqual({ tier: 'pro', source: 'Paid' })
  })
  it('comp wins over lower paid tier, source is Comp', () => {
    expect(userTierSummary({ email: 'a@x.com', compTier: 'pro', subTier: 'trader', subStatus: 'active', adminEmails: ADMINS }))
      .toEqual({ tier: 'pro', source: 'Comp' })
  })
  it('no comp, no sub → free/Free', () => {
    expect(userTierSummary({ email: 'a@x.com', compTier: null, subTier: null, subStatus: null, adminEmails: ADMINS }))
      .toEqual({ tier: 'free', source: 'Free' })
  })
  it('comp ties with equal paid tier → source is Comp', () => {
    expect(userTierSummary({ email: 'a@x.com', compTier: 'pro', subTier: 'pro', subStatus: 'active', adminEmails: ADMINS }))
      .toEqual({ tier: 'pro', source: 'Comp' })
    expect(userTierSummary({ email: 'a@x.com', compTier: 'trader', subTier: 'trader', subStatus: 'active', adminEmails: ADMINS }))
      .toEqual({ tier: 'trader', source: 'Comp' })
  })
})

describe('a trial is not a customer', () => {
  // Once every signup opens a trialing subscription, the old behaviour labelled
  // the ENTIRE user base "Pro, source Paid" and there was no way left to tell a
  // customer from a trialist. The tier is still granted — that part was always
  // right — but the source now says where it came from.
  it('a trialing sub grants the tier but reads as Trialing, not Paid', () => {
    expect(userTierSummary({ email: 'a@x.com', compTier: null, subTier: 'pro', subStatus: 'trialing', adminEmails: ADMINS }))
      .toEqual({ tier: 'pro', source: 'Trialing' })
    expect(userTierSummary({ email: 'a@x.com', compTier: null, subTier: 'trader', subStatus: 'trialing', adminEmails: ADMINS }))
      .toEqual({ tier: 'trader', source: 'Trialing' })
  })

  it('an active sub still reads as Paid', () => {
    expect(userTierSummary({ email: 'a@x.com', compTier: null, subTier: 'pro', subStatus: 'active', adminEmails: ADMINS }))
      .toEqual({ tier: 'pro', source: 'Paid' })
  })

  it('admin and comp still outrank a trial', () => {
    expect(userTierSummary({ email: 'boss@x.com', compTier: null, subTier: 'pro', subStatus: 'trialing', adminEmails: ADMINS }))
      .toEqual({ tier: 'pro', source: 'Admin' })
    // The comp is what this user keeps when the trial ends, so it names the source.
    expect(userTierSummary({ email: 'a@x.com', compTier: 'pro', subTier: 'pro', subStatus: 'trialing', adminEmails: ADMINS }))
      .toEqual({ tier: 'pro', source: 'Comp' })
  })

  it('a trial ABOVE a comp reads as Trialing — the grant is the trial', () => {
    expect(userTierSummary({ email: 'a@x.com', compTier: 'trader', subTier: 'pro', subStatus: 'trialing', adminEmails: ADMINS }))
      .toEqual({ tier: 'pro', source: 'Trialing' })
  })

  it('a dead subscription grants nothing, whatever its tier', () => {
    for (const subStatus of ['canceled', 'past_due', 'unpaid', 'incomplete', 'incomplete_expired']) {
      expect(userTierSummary({ email: 'a@x.com', compTier: null, subTier: 'pro', subStatus, adminEmails: ADMINS }))
        .toEqual({ tier: 'free', source: 'Free' })
    }
  })
})

describe('filter normalizers', () => {
  it('normalizeAccountFilter defaults to real, passes valid, rejects junk', () => {
    expect(normalizeAccountFilter(undefined)).toBe('real')
    expect(normalizeAccountFilter('all')).toBe('all')
    expect(normalizeAccountFilter('test')).toBe('test')
    expect(normalizeAccountFilter('real')).toBe('real')
    expect(normalizeAccountFilter('bogus')).toBe('real')
  })
  it('normalizeSubFilter defaults to any', () => {
    expect(normalizeSubFilter(undefined)).toBe('any')
    expect(normalizeSubFilter('pro')).toBe('pro')
    expect(normalizeSubFilter('trader')).toBe('trader')
    expect(normalizeSubFilter('free')).toBe('free')
    expect(normalizeSubFilter('x')).toBe('any')
  })
  it('normalizeCompFilter defaults to any', () => {
    expect(normalizeCompFilter(undefined)).toBe('any')
    expect(normalizeCompFilter('comped')).toBe('comped')
    expect(normalizeCompFilter('not')).toBe('not')
    expect(normalizeCompFilter('x')).toBe('any')
  })
})

describe('isInternalRow', () => {
  it('true when flag set', () => {
    expect(isInternalRow({ is_internal: true, email: 'a@gmail.com' })).toBe(true)
  })
  it('true for @tradingsocial.io regardless of flag', () => {
    expect(isInternalRow({ is_internal: false, email: 'lb_hi_1@tradingsocial.io' })).toBe(true)
    expect(isInternalRow({ is_internal: false, email: 'X@TradingSocial.IO' })).toBe(true)
  })
  it('false for a real external user', () => {
    expect(isInternalRow({ is_internal: false, email: 'real@gmail.com' })).toBe(false)
    expect(isInternalRow({ is_internal: null, email: null })).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Migration 0078 — the RPC half of the same label
// ---------------------------------------------------------------------------

describe('migration 0078 — admin_search_users prefers a real subscription', () => {
  // repo root is three levels up from app/tests/unit
  const sql = readFileSync(
    join(__dirname, '..', '..', 'supabase', 'migrations', '0078_admin_search_users_prefer_active.sql'),
    'utf8',
  )

  it('breaks the tie on status, so a payer is never labelled Trialing by chance', () => {
    // `sub_status` now names the source in the directory, so whichever row the
    // lateral join returns decides what an admin sees. Tier alone left that to
    // whatever Postgres happened to return first.
    expect(sql).toMatch(/order by[\s\S]*?case tier when 'pro' then 2[\s\S]*?case status when 'active' then 1 else 0 end desc/i)
  })

  it('keeps every filter the replaced function had — the 0041 lesson', () => {
    // CREATE OR REPLACE swaps the WHOLE body and silently drops anything not
    // repeated. 0041 documents what that costs when it goes unnoticed.
    for (const kept of [
      'word_similarity', 'p_account', 'p_sub', 'p_comp',
      'is_internal', 'tradingsocial.io', 'limit lim offset off',
      'security definer', "set search_path to 'public'",
    ]) {
      expect(sql.toLowerCase()).toContain(kept.toLowerCase())
    }
  })

  it('still returns every column the callers read', () => {
    // admin/users/page.tsx and admin/users/[id]/page.tsx destructure these by
    // name; a dropped column is a runtime undefined, not a compile error.
    for (const col of ['id', 'username', 'display_name', 'email', 'created_at',
      'comp_tier', 'sub_tier', 'sub_status', 'is_internal']) {
      expect(sql).toContain(col)
    }
  })

  it('names both projects, as every hand-applied migration here must', () => {
    expect(sql).toContain('jmpanzrjxflovdfwcbye')
    expect(sql).toContain('sixixwutvrguqemqzvvw')
  })
})
