import type { Metadata } from 'next'
import './globals.css'
import { ToastProvider } from './_components/toast'

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
      <body>
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  )
}