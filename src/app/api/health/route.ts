// Server-side example: a health check for Cloud Run / load balancers. Add more API routes next to this one.
export const dynamic = 'force-dynamic'

export function GET() {
  return Response.json({ ok: true, service: 'studio-recorder', time: new Date().toISOString() })
}
