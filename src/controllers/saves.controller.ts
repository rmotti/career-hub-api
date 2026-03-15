import { FastifyRequest, FastifyReply } from 'fastify'
import * as savesService from '../services/saves.service'

export async function listSaves(_request: FastifyRequest, reply: FastifyReply) {
  const saves = await savesService.listSaves()
  return reply.send(saves)
}

export async function getSave(
  request: FastifyRequest<{ Params: { saveId: string } }>,
  reply: FastifyReply
) {
  const save = await savesService.getSaveById(request.params.saveId)
  return reply.send(save)
}

export async function createSave(
  request: FastifyRequest<{ Body: { name: string; club: string; budget: number } }>,
  reply: FastifyReply
) {
  const save = await savesService.createSave(request.body)
  return reply.status(201).send(save)
}

export async function updateSave(
  request: FastifyRequest<{
    Params: { saveId: string }
    Body: {
      currentYear?: number
      currentSeason?: string
      budget?: number
      balance?: number
    }
  }>,
  reply: FastifyReply
) {
  const save = await savesService.updateSave(request.params.saveId, request.body)
  return reply.send(save)
}

export async function deleteSave(
  request: FastifyRequest<{ Params: { saveId: string } }>,
  reply: FastifyReply
) {
  await savesService.deleteSave(request.params.saveId)
  return reply.status(204).send()
}
