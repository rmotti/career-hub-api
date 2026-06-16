import pino from 'pino'

/**
 * Logger para contextos FORA de uma request Fastify — módulos-folha como o
 * fit-score client, que não têm acesso a `request.log`. Mesma saída do logger
 * do Fastify: JSON no stdout, capturado pelo Railway em produção. Silenciado
 * em test para não poluir a saída da suíte.
 *
 * Dentro de rotas/handlers continue usando `request.log` — não use este.
 */
export const logger = pino({
  level: process.env.NODE_ENV === 'test' ? 'silent' : (process.env.LOG_LEVEL ?? 'info'),
  base: undefined, // sem pid/hostname — log enxuto
})
