#!/usr/bin/env node
import { createHash, timingSafeEqual } from 'node:crypto'
import { appendFileSync, chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

const DEFAULT_BASE_DIR = join(process.env.HOME || homedir(), 'Library', 'Application Support', 'ThreeBody', 'HealthIngest')
const CONFIG_PATH = process.env.HEALTH_INGEST_CONFIG || join(DEFAULT_BASE_DIR, 'config.json')
const WINDOW_MS = 60 * 1000
const GLOBAL_RATE_LIMIT = 30
const nowShanghaiIso = () => new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 19) + '+08:00'
const nowShanghaiStamp = () => {
  const iso = new Date(Date.now() + 8 * 3600 * 1000).toISOString()
  return `${iso.slice(0, 10)}_${iso.slice(11, 19).replace(/:/g, '')}`
}

function loadConfig(configPath) {
  if (!existsSync(configPath)) throw new Error(`配置文件不存在：${configPath}`)
  const raw = JSON.parse(readFileSync(configPath, 'utf8'))
  const host = (raw.host || '127.0.0.1').trim()
  const port = Number(raw.port)
  const ingestPath = String(raw.ingest_path || '').trim()
  const token = String(raw.token || '').trim()
  if (!['127.0.0.1', '::1', 'localhost'].includes(host)) throw new Error(`仅允许监听回环地址：${host}`)
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error(`无效端口：${raw.port}`)
  if (!ingestPath.startsWith('/ingest/') || ingestPath.length < 16) throw new Error('ingest_path 无效')
  if (token.length < 32) throw new Error('token 长度不足')
  return {
    host, port, ingestPath,
    tokenBuf: Buffer.from(token, 'utf8'),
    outputDir: raw.output_dir || join(DEFAULT_BASE_DIR, 'staging'),
    logFile: raw.log_file || join(DEFAULT_BASE_DIR, 'ingest.log'),
    maxBodyBytes: Number.isInteger(raw.max_body_bytes) ? raw.max_body_bytes : 20 * 1024 * 1024,
    rateLimitPerMin: Number.isInteger(raw.rate_limit_per_minute) ? raw.rate_limit_per_minute : 10,
  }
}

function verifyToken(presented, expectedBuf) {
  if (typeof presented !== 'string' || !presented) return false
  const actualBuf = Buffer.from(presented, 'utf8')
  return actualBuf.length === expectedBuf.length && timingSafeEqual(actualBuf, expectedBuf)
}

function validateHealthPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return { ok: false, shape: 'invalid' }
  if (Array.isArray(payload.metrics) || Array.isArray(payload.workouts)) {
    return { ok: true, shape: 'flat', metrics: payload.metrics?.length || 0, workouts: payload.workouts?.length || 0 }
  }
  const inner = payload.data
  if (inner && typeof inner === 'object' && !Array.isArray(inner) && (Array.isArray(inner.metrics) || Array.isArray(inner.workouts))) {
    return { ok: true, shape: 'wrapped_data', metrics: inner.metrics?.length || 0, workouts: inner.workouts?.length || 0 }
  }
  return { ok: false, shape: 'missing_health_fields' }
}

function createRateLimiter(perIpLimit) {
  const byIp = new Map(); const globalHits = []
  return (ip) => {
    const now = Date.now(), cutoff = now - WINDOW_MS
    while (globalHits.length && globalHits[0] < cutoff) globalHits.shift()
    if (globalHits.length >= GLOBAL_RATE_LIMIT) return false
    const hits = byIp.get(ip) || []
    while (hits.length && hits[0] < cutoff) hits.shift()
    if (hits.length >= perIpLimit) { byIp.set(ip, hits); return false }
    hits.push(now); byIp.set(ip, hits); globalHits.push(now)
    return true
  }
}

function sendJson(res, status, body) {
  const text = JSON.stringify(body)
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(text), 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
  res.end(text)
}

function readBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = []; let total = 0; let done = false
    req.on('data', (chunk) => {
      if (done) return
      total += chunk.length
      if (total > maxBytes) { done = true; reject(Object.assign(new Error('TOO_LARGE'), { code: 'TOO_LARGE' })); req.destroy(); return }
      chunks.push(chunk)
    })
    req.on('end', () => { if (!done) { done = true; resolve(Buffer.concat(chunks, total)) } })
    req.on('error', (err) => { if (!done) { done = true; reject(err) } })
  })
}

const config = loadConfig(CONFIG_PATH)
mkdirSync(config.outputDir, { recursive: true, mode: 0o700 })
mkdirSync(dirname(config.logFile), { recursive: true, mode: 0o700 })
const allowRequest = createRateLimiter(config.rateLimitPerMin)
const seenHashes = new Set(readdirSync(config.outputDir).map((n) => /^RestExport_\d{4}-\d{2}-\d{2}_\d{6}_([0-9a-f]{12})\.json$/.exec(n)?.[1]).filter(Boolean))
const auditLog = (rec) => {
  const line = JSON.stringify({ at: nowShanghaiIso(), ...rec }) + '\n'
  try { appendFileSync(config.logFile, line, { encoding: 'utf8', mode: 0o600 }) } catch { process.stderr.write(line) }
}

const server = createServer(async (req, res) => {
  const ip = String(req.headers['cf-connecting-ip'] || req.socket.remoteAddress || 'unknown').split(',')[0].trim()
  const method = (req.method || 'GET').toUpperCase()
  const pathname = new URL(req.url || '/', 'http://127.0.0.1').pathname
  if (!allowRequest(ip)) { auditLog({ event: 'rejected_rate_limit', status: 429, ip }); return sendJson(res, 429, { error: 'too_many_requests' }) }
  const authH = String(req.headers.authorization || '')
  const token = (authH.startsWith('Bearer ') ? authH.slice(7).trim() : '') || String(Array.isArray(req.headers['x-health-token']) ? req.headers['x-health-token'][0] : req.headers['x-health-token'] || '')
  if (method !== 'POST' || pathname !== config.ingestPath || !verifyToken(token, config.tokenBuf)) {
    auditLog({ event: 'rejected_not_found', status: 404, ip, method })
    return sendJson(res, 404, { error: 'not_found' })
  }
  if (!String(req.headers['content-type'] || '').toLowerCase().startsWith('application/json')) {
    auditLog({ event: 'rejected_content_type', status: 415, ip })
    return sendJson(res, 415, { error: 'unsupported_media_type' })
  }
  let rawBody
  try { rawBody = await readBody(req, config.maxBodyBytes) } catch (err) {
    const code = err?.code === 'TOO_LARGE' ? 413 : 400
    auditLog({ event: code === 413 ? 'rejected_too_large' : 'read_error', status: code, ip })
    return sendJson(res, code, { error: code === 413 ? 'payload_too_large' : 'bad_request' })
  }
  let parsed
  try { parsed = JSON.parse(rawBody.toString('utf8')) } catch {
    auditLog({ event: 'rejected_invalid_json', status: 400, ip, bytes: rawBody.length })
    return sendJson(res, 400, { error: 'invalid_json' })
  }
  const check = validateHealthPayload(parsed)
  if (!check.ok) { auditLog({ event: 'rejected_schema', status: 400, ip, reason: check.shape }); return sendJson(res, 400, { error: 'invalid_health_payload' }) }
  const shortHash = createHash('sha256').update(rawBody).digest('hex').slice(0, 12)
  if (seenHashes.has(shortHash)) { auditLog({ event: 'duplicate', status: 200, ip, sha256: shortHash }); return sendJson(res, 200, { ok: true, duplicate: true }) }
  const file = `RestExport_${nowShanghaiStamp()}_${shortHash}.json`
  const target = join(config.outputDir, file)
  const tmp = `${target}.tmp`
  try { writeFileSync(tmp, rawBody, { mode: 0o600 }); try { chmodSync(tmp, 0o600) } catch {}; renameSync(tmp, target); seenHashes.add(shortHash) } catch (err) {
    auditLog({ event: 'write_error', status: 500, ip, message: String(err?.message || err) })
    return sendJson(res, 500, { error: 'storage_error' })
  }
  auditLog({ event: 'accepted', status: 200, ip, bytes: rawBody.length, sha256: shortHash, shape: check.shape, metrics: check.metrics, workouts: check.workouts, file })
  sendJson(res, 200, { ok: true })
})
server.requestTimeout = 30000
server.headersTimeout = 10000
server.listen(config.port, config.host, () => auditLog({ event: 'started', host: config.host, port: config.port, output_dir: config.outputDir }))
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { auditLog({ event: 'stopping', sig }); server.close(() => process.exit(0)) })
