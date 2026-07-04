import { Analytics } from '@vercel/analytics/next'
import type { Metadata, Viewport } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import { Toaster } from '@/components/ui/sonner'
import { AppNav } from '@/components/app-nav'
import './globals.css'

const _geistSans = Geist({ subsets: ['latin'] })
const _geistMono = Geist_Mono({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'Rajeshri Transport',
  description:
    'Trip card scanning, billing, expense tracking and analytics for Rajeshri Enterprises transport business',
  generator: 'v0.app',
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Rajeshri Transport',
  },
  icons: {
    icon: [{ url: '/icons/icon-192.png', type: 'image/png' }],
    apple: '/icons/icon-192.png',
  },
}

export const viewport: Viewport = {
  colorScheme: 'dark',
  themeColor: '#141a26',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className="bg-background">
      <body className="antialiased font-sans min-h-dvh">
        <div className="flex min-h-dvh w-full flex-col">
          <div className="flex-1 pb-20 md:pb-6 md:pl-52">
            <div className="mx-auto w-full max-w-4xl">{children}</div>
          </div>
          <AppNav />
        </div>
        <Toaster position="top-center" />
        {process.env.NODE_ENV === 'production' && <Analytics />}
      </body>
    </html>
  )
}
