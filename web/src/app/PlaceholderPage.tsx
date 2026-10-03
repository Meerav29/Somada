import type { ReactNode } from 'react'

export function PlaceholderPage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h1>{title}</h1>
      <p>{children}</p>
      <p>
        <a href="/">Open the classic app</a>
      </p>
    </section>
  )
}
