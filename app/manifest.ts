import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Rajeshri Transport',
    short_name: 'Rajeshri',
    description:
      'Trip card scanning, billing, expense tracking and analytics for Rajeshri Enterprises',
    start_url: '/',
    display: 'standalone',
    background_color: '#141a26',
    theme_color: '#141a26',
    icons: [
      {
        src: '/icons/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
      },
      {
        src: '/icons/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
      },
    ],
  }
}
