import { setResponseStatus } from 'h3'
import { setCaptureCorsHeaders } from '~/server/utils/cors'

// CORS preflight for POST /api/ingest/capture. Browsers send this
// automatically before the real POST because Authorization is a
// non-simple header — no auth check here, preflights never carry it.
export default defineEventHandler((event) => {
  setCaptureCorsHeaders(event)
  setResponseStatus(event, 204)
  return null
})
