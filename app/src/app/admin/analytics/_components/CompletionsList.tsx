// app/src/app/admin/analytics/_components/CompletionsList.tsx
export function CompletionsList({ rows }: { rows: { courseTitle: string; count: number }[] }) {
  if (rows.length === 0) return <p className="faint" style={{ fontSize: 13 }}>No completions yet.</p>
  const max = Math.max(1, ...rows.map((r) => r.count))
  return (
    <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 9 }}>
      {rows.map((r) => (
        <li key={r.courseTitle} className="ad-meter">
          <div className="ad-meter-top">
            <span>{r.courseTitle}</span>
            <span className="n">{r.count}</span>
          </div>
          <div className="ad-meter-track">
            <i className="ad-meter-fill" style={{ width: `${(r.count / max) * 100}%` }} />
          </div>
        </li>
      ))}
    </ul>
  )
}
