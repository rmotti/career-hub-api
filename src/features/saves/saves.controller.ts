import { FastifyRequest, FastifyReply } from 'fastify'
import * as savesService from './saves.service.js'
import * as snapshotsService from './snapshots.service.js'

export async function listSaves(request: FastifyRequest, reply: FastifyReply) {
  const saves = await savesService.listSaves(request.user!.id)
  return reply.send(saves)
}

export async function getSave(
  request: FastifyRequest<{ Params: { saveId: string } }>,
  reply: FastifyReply
) {
  const save = await savesService.getSaveById(request.params.saveId, request.user!.id)
  return reply.send(save)
}

export async function createSave(
  request: FastifyRequest<{ Body: { name: string; club: string; budget: number; europeanCompetitionId?: string | null } }>,
  reply: FastifyReply
) {
  const save = await savesService.createSave({ ...request.body, userId: request.user!.id })
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
      europeanCompetitionId?: string | null
    }
  }>,
  reply: FastifyReply
) {
  const save = await savesService.updateSave(request.params.saveId, request.body, request.user!.id)
  return reply.send(save)
}

export async function deleteSave(
  request: FastifyRequest<{ Params: { saveId: string }; Querystring: { confirm?: string; purge?: string } }>,
  reply: FastifyReply
) {
  const result = await savesService.deleteSave(request.params.saveId, request.user!.id, {
    confirm: request.query.confirm,
    purge: request.query.purge === 'true',
  })
  return reply.send(result)
}

export async function listDeletedSaves(request: FastifyRequest, reply: FastifyReply) {
  const saves = await savesService.listDeletedSaves(request.user!.id)
  return reply.send(saves)
}

export async function restoreSave(
  request: FastifyRequest<{ Params: { saveId: string } }>,
  reply: FastifyReply
) {
  await savesService.restoreSave(request.params.saveId, request.user!.id)
  return reply.send({ restored: true })
}

export async function listSnapshots(
  request: FastifyRequest<{ Params: { saveId: string } }>,
  reply: FastifyReply
) {
  const snapshots = await snapshotsService.listSnapshots(request.params.saveId, request.user!.id)
  return reply.send(snapshots)
}

export async function listAuditLog(
  request: FastifyRequest<{ Params: { saveId: string } }>,
  reply: FastifyReply
) {
  const entries = await snapshotsService.listAuditLog(request.params.saveId, request.user!.id)
  return reply.send(entries)
}

export async function createSnapshot(
  request: FastifyRequest<{ Params: { saveId: string } }>,
  reply: FastifyReply
) {
  const snapshot = await snapshotsService.createManualSnapshot(request.params.saveId, request.user!.id)
  return reply.status(201).send(snapshot)
}

export async function restoreSnapshot(
  request: FastifyRequest<{ Params: { saveId: string; snapshotId: string } }>,
  reply: FastifyReply
) {
  await snapshotsService.restoreSnapshot(request.params.saveId, request.params.snapshotId, request.user!.id)
  return reply.send({ restored: true })
}
