import express from 'express'
import { normalizeSecretReferenceId } from './keychain.js'

export function createSecretReferenceRouter({ registry, usage = () => [], appendAudit = () => {} } = {}) {
  if (!registry) throw new Error('secret reference router requires a registry')
  const router = express.Router()
  router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next() })
  const intent = req => {
    if (!String(req.get('content-type') || '').toLowerCase().startsWith('application/json') || req.get('x-command-center-intent') !== 'secret-reference-change') throw Object.assign(new Error('secret reference change intent is required'), { code: 'SECRET_REFERENCE_INTENT_REQUIRED' })
  }
  const status = error => error.code === 'SECRET_REFERENCE_DENIED' || error.code === 'SECRET_REFERENCE_STORE_CORRUPT' ? 503 : 400
  router.get('/', (_req, res) => { try { res.json(registry.list().map(item => ({ ...item, usedByCount: usage(item.id).length }))) } catch (error) { res.status(status(error)).json({ error: error.message }) } })
  router.get('/:id/usage', (req, res) => { try { res.json(usage(normalizeSecretReferenceId(req.params.id))) } catch (error) { res.status(status(error)).json({ error: error.message }) } })
  router.post('/', (req, res) => {
    try {
      intent(req); const id = normalizeSecretReferenceId(req.body.id)
      if (registry.list().some(item => item.id === id)) return res.status(409).json({ error: 'secret reference already exists; use the rotate endpoint' })
      const saved = registry.put({ id, label: req.body.label, value: req.body.value })
      appendAudit('secret_reference_created', { id, revision: saved.revision }); res.status(201).json(saved)
    } catch (error) { res.status(status(error)).json({ error: error.message }) }
  })
  router.put('/:id/value', (req, res) => {
    try {
      intent(req); const id = normalizeSecretReferenceId(req.params.id), current = registry.list().find(item => item.id === id)
      if (!current) return res.status(404).json({ error: 'secret reference not found' })
      if (Math.floor(Number(req.body.expectedRevision) || 0) !== current.revision) return res.status(409).json({ error: 'secret reference revision changed', revision: current.revision })
      const saved = registry.put({ id, label: current.label, value: req.body.value })
      appendAudit('secret_reference_rotated', { id, revision: saved.revision }); res.json(saved)
    } catch (error) { res.status(status(error)).json({ error: error.message }) }
  })
  router.delete('/:id', (req, res) => {
    try {
      intent(req); const id = normalizeSecretReferenceId(req.params.id), current = registry.list().find(item => item.id === id)
      if (!current) return res.status(404).json({ error: 'secret reference not found' })
      if (Math.floor(Number(req.body?.expectedRevision) || 0) !== current.revision) return res.status(409).json({ error: 'secret reference revision changed', revision: current.revision })
      const bindings = usage(id)
      if (bindings.length) return res.status(409).json({ error: 'secret reference is still in use', usage: bindings.slice(0, 100) })
      registry.remove(id); appendAudit('secret_reference_deleted', { id, revision: current.revision }); res.json({ ok: true })
    } catch (error) { res.status(status(error)).json({ error: error.message }) }
  })
  return router
}
