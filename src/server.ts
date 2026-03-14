import { IncomingMessage, ServerResponse } from 'http'
import { app } from './app'

if (!process.env.VERCEL) {
  const port = Number(process.env.PORT) || 3333

  app.listen({ port, host: '0.0.0.0' }, (err) => {
    if (err) {
      app.log.error(err)
      process.exit(1)
    }
  })
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  await app.ready()
  app.server.emit('request', req, res)
}
