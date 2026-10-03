import { useQuery } from '@tanstack/react-query'
import { getHealth } from '../../lib/api/client'
import { useAuth } from '../../lib/supabase/auth'

export function DashboardPage() {
  const { email, getToken } = useAuth()
  const { data, isPending, error } = useQuery({
    queryKey: ['health', email],
    queryFn: () => getHealth(getToken),
  })

  if (isPending) return <p role="status">Loading your data…</p>
  if (error) return <p role="alert">{error.message}</p>

  if (data === null) {
    return (
      <section>
        <h1>No health data yet</h1>
        <p>Uploading your Apple Health export is coming to the new app. For now, use the classic app.</p>
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
          You're viewing sample data. <a href="/">Upload your own data</a>
        </p>
      )}
      <p>{data.summary.total_days} days of data</p>
    </section>
  )
}
