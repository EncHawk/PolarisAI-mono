import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Polaris AI',
  description: 'Read the paper. Trace the evidence. Plan the build. Run the proof.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}