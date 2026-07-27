import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Polaris AI',
  description: 'Read the paper. Trace the evidence. Plan the build. Run the proof.',
  icons: {
    icon: '/logo.png',
    shortcut: '/logo.png',
    apple: '/logo.png',
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}