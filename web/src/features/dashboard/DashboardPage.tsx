import { Link } from 'react-router-dom'
import { useHealthQuery } from '../../lib/health/useHealthQuery'

export function DashboardPage() {
  const { data, isPending, error } = useHealthQuery()

  if (isPending) return <p role="status">Loading your data…</p>
  if (error) return <p role="alert">{error.message}</p>

  if (data === null) {
    return (
      <section>
        <h1>No health data yet</h1>
        <p>Upload your Apple Health export to see your dashboard.</p>
        <p>
          <Link to="/upload">Upload your export</Link>
        </p>
        <p>
          <a href="/">Open the classic app</a>
        </p>
      </section>
    )
  }

  return (
    <section>
      <h1>Dashboard</h1>
      {data.is_demo && (
        <p role="status" className="demo-banner">
          You're viewing sample data. <Link to="/upload">Upload your own data</Link>
        </p>
      )}
      <p>{data.summary.total_days} days of data</p>
    </section>
  )
}
