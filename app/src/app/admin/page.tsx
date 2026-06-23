import { createServiceClient } from '@/lib/supabase/service'

async function count(table: string, filter?: (q: any) => any): Promise<number> {
  const svc = createServiceClient()
  let q = svc.from(table).select('id', { count: 'exact', head: true })
  if (filter) q = filter(q)
  const { count } = await q
  return count ?? 0
}

export default async function AdminHome() {
  const [openFeedback, users, trades, courses] = await Promise.all([
    count('feedback', (q) => q.eq('status', 'open')),
    count('profiles'),
    count('trades'),
    count('courses'),
  ])
  const cards = [
    { label: 'Open feedback', value: openFeedback },
    { label: 'Users', value: users },
    { label: 'Trades logged', value: trades },
    { label: 'Courses', value: courses },
  ]
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 14 }}>
      {cards.map((c) => (
        <div key={c.label} className="ts-card" style={{ display: 'grid', gap: 6 }}>
          <span className="faint" style={{ fontSize: 13 }}>{c.label}</span>
          <strong style={{ fontSize: 28 }}>{c.value}</strong>
        </div>
      ))}
    </div>
  )
}
