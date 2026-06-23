import { IncomingMessage, ServerResponse } from 'http'
import { app } from './app.js'
import { startEventLoopMonitor } from './shared/lib/event-loop-monitor.js' // TEMP diagnostic (#perf-investigation)

if (!process.env.VERCEL) {
  const port = Number(process.env.PORT) || 3333

  app.listen({ port, host: '0.0.0.0' }, (err) => {
    if (err) {
      app.log.error(err)
      process.exit(1)
    }
    // TEMP diagnostic (#perf-investigation): logs when the event loop is blocked > 100ms. Remove later.
    startEventLoopMonitor(app.log, { intervalMs: 2000, thresholdMs: 100 })
  })
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  await app.ready()
  app.server.emit('request', req, res)
}
