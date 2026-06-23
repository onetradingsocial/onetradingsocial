// app/src/app/admin/analytics/_components/CompletionsList.tsx
export function CompletionsList({ rows }: { rows: { courseTitle: string; count: number }[] }) {
  if (rows.length === 0) return <p className="faint" style={{ fontSize: 13 }}>No completions yet.</p>
  return (
    <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 6 }}>
      {rows.map((r) => (
        <li key={r.courseTitle} style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>{r.courseTitle}</span>
          <strong>{r.count}</strong>
        </li>
      ))}
    </ul>
  )
}
