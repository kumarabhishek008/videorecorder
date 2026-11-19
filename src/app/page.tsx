'use client'

import dynamic from 'next/dynamic'

// The recorder and editor use camera, screen and storage APIs that only exist in the browser,
// so the app renders on the client only.
const ClientApp = dynamic(() => import('../ClientApp'), {
  ssr: false,
  loading: () => (
    <div className="saving" role="status">
      <div className="spinner" aria-hidden /> Loading Studio Recorder…
    </div>
  ),
})

export default function Page() {
  return <ClientApp />
}
