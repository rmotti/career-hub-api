import { FastifyRequest, FastifyReply } from 'fastify'
import * as transfersService from './transfers.service'
import { TransferType } from '@prisma/client'

export async function listTransfers(
  request: FastifyRequest<{
    Params: { saveId: string }
    Querystring: { season?: string }
  }>,
  reply: FastifyReply
) {
  const transfers = await transfersService.listTransfers(
    request.params.saveId,
    request.query.season
  )
  return reply.send(transfers)
}

export async function createTransfer(
  request: FastifyRequest<{
    Params: { saveId: string }
    Body: {
      playerName: string
      type: TransferType
      from: string
      to: string
      fee?: number
      season: string
      playerId?: string
    }
  }>,
  reply: FastifyReply
) {
  const transfer = await transfersService.createTransfer(
    request.params.saveId,
    request.body
  )
  return reply.status(201).send(transfer)
}

export async function updateTransfer(
  request: FastifyRequest<{
    Params: { saveId: string; tid: string }
    Body: {
      playerName?: string
      type?: TransferType
      from?: string
      to?: string
      fee?: number
      season?: string
    }
  }>,
  reply: FastifyReply
) {
  const transfer = await transfersService.updateTransfer(
    request.params.saveId,
    request.params.tid,
    request.body
  )
  return reply.send(transfer)
}

export async function deleteTransfer(
  request: FastifyRequest<{ Params: { saveId: string; tid: string } }>,
  reply: FastifyReply
) {
  await transfersService.deleteTransfer(request.params.saveId, request.params.tid)
  return reply.status(204).send()
}
