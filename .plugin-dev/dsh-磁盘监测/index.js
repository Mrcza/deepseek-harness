/**
 * Host service for @local/dsh-disk-monitor.
 *
 * Design principles:
 * - Lightweight "meter-reading" sampling: runs short-lived macOS native commands
 *   (`ioreg`, `diskutil`, `plutil`, `df`) on demand and at 60s / daily 07:00 ticks.
 *   Never spawns persistent background daemons or streaming `iostat` processes.
 * - Zero-residue teardown: `ctx.on('dispose')` clears every timer and terminates
 *   any in-flight child process immediately (`SIGTERM`, fallback `SIGKILL`).
 * - Permanent natural-day accumulation (00:00-24:00) keyed by stable volume identity,
 *   including connected physical disks whose volumes are currently unmounted at rest
 *   (such as `BackupDisk`), with reboot/replug counter-reset handling.
 */
import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PLUGIN_ID = '@local/dsh-disk-monitor'
const PLUGIN_ROOT = dirname(fileURLToPath(import.meta.url))
const RUNTIME_DIR = join(PLUGIN_ROOT, 'runtime')
const DATA_FILE = join(RUNTIME_DIR, 'disk-monitor-data.json')
const PREFS_FILE = join(RUNTIME_DIR, 'disk-monitor-prefs.json')

const SAMPLE_INTERVAL_MS = 60 * 1000
const STATE_STALE_MS = 10 * 1000
const COMMAND_TIMEOUT_MS = 6000
const DEFAULT_HISTORY_DAYS = 30
const SUPPORTED_DAYS = new Set([30, 365])
const REFRESH_HOUR = 7
const REFRESH_MINUTE = 0

const IGNORED_VOLUME_NAMES = new Set([
  'Preboot',
  'Recovery',
  'VM',
  'Update',
  'EFI',
  'EFI System Partition',
  'iSCPreboot',
  'Hardware',
  'xART',
  'iBootSystemContainer',
  'RecoveryOSContainer',
  'Container',
])

const IGNORED_MOUNT_PREFIXES = [
  '/System/Volumes/Preboot',
  '/System/Volumes/Recovery',
  '/System/Volumes/VM',
  '/System/Volumes/Update',
  '/System/Volumes/xarts',
  '/System/Volumes/iSCPreboot',
  '/System/Volumes/Hardware',
  '/private/var/vm',
]

function localDateStr(date = new Date()) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function localIsoStr(date = new Date()) {
  const y = date.getFullYear()
  const mo = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  const h = String(date.getHours()).padStart(2, '0')
  const mi = String(date.getMinutes()).padStart(2, '0')
  const s = String(date.getSeconds()).padStart(2, '0')
  const offsetMin = -date.getTimezoneOffset()
  const sign = offsetMin >= 0 ? '+' : '-'
  const absMin = Math.abs(offsetMin)
  const oh = String(Math.floor(absMin / 60)).padStart(2, '0')
  const om = String(absMin % 60).padStart(2, '0')
  return `${y}-${mo}-${d}T${h}:${mi}:${s}${sign}${oh}:${om}`
}

function buildRecentDates(days = DEFAULT_HISTORY_DAYS, now = new Date()) {
  const list = []
  for (let i = days - 1; i >= 0; i--) {
    const dt = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i)
    list.push(localDateStr(dt))
  }
  return list
}

function next7amTimestamp(now = new Date()) {
  const target = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    REFRESH_HOUR,
    REFRESH_MINUTE,
    0,
    0,
  )
  if (target.getTime() <= now.getTime()) {
    target.setDate(target.getDate() + 1)
  }
  return target
}

function atomicWriteJson(filePath, data) {
  mkdirSync(dirname(filePath), { recursive: true, mode: 0o700 })
  const tmp = `${filePath}.tmp.${process.pid}`
  writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', 'utf8')
  renameSync(tmp, filePath)
}

function readJsonSafe(filePath, fallback) {
  if (!existsSync(filePath)) return fallback
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'))
  } catch (_e) {
    return fallback
  }
}

function isIgnoredVolume(volName, mountPoint) {
  const cleanName = String(volName || '').trim()
  const cleanMount = String(mountPoint || '').trim()
  if (!cleanName && !cleanMount) return true
  if (cleanName && IGNORED_VOLUME_NAMES.has(cleanName)) return true
  if (/^Untitled\b/i.test(cleanName)) return true
  if (cleanMount) {
    for (const prefix of IGNORED_MOUNT_PREFIXES) {
      if (cleanMount === prefix || cleanMount.startsWith(prefix + '/')) return true
    }
  }
  return false
}

/**
 * Parse `ioreg -c IOBlockStorageDriver -r -l -w 0` text output.
 * Extracts each physical IOBlockStorageDriver's own Statistics line
 * (`"Bytes (Read)"` and `"Bytes (Write)"`), physical disk size, media model,
 * and any child APFS volume names (so unmounted physical disks like `BackupDisk` are still identified).
 */
export function parseIoregText(ioregText) {
  const results = new Map()
  const text = String(ioregText || '')
  if (!text) return results

  const blocks = text.split(/\+-o\s+IOBlockStorageDriver\b/)
  for (let i = 1; i < blocks.length; i++) {
    const block = blocks[i]
    const statsLineMatch = block.match(/"Statistics"\s*=\s*\{[^\n]*"Bytes \(Read\)"[^\n]*\}/)
    if (!statsLineMatch) continue
    const statsLine = statsLineMatch[0]
    const readMatch = statsLine.match(/"Bytes \(Read\)"\s*=\s*(\d+)/)
    const writeMatch = statsLine.match(/"Bytes \(Write(?:n)?\)"\s*=\s*(\d+)/)
    const readBytes = readMatch ? Number(readMatch[1]) : 0
    const writeBytes = writeMatch ? Number(writeMatch[1]) : 0

    const protoMatch = block.match(/"Physical Interconnect"\s*=\s*"([^"]+)"/)
    const locMatch = block.match(/"Physical Interconnect Location"\s*=\s*"([^"]+)"/)
    const proto = protoMatch ? protoMatch[1] : ''
    const location = locMatch ? locMatch[1] : ''

    const bsdMatch = block.match(/"BSD Name"\s*=\s*"(disk\d+)"/)
    if (!bsdMatch) continue
    const bsd = bsdMatch[1]

    const sizeMatch = block.match(/"Size"\s*=\s*(\d+)/)
    const sizeBytes = sizeMatch ? Number(sizeMatch[1]) : 0

    const mediaMatch = block.match(/\+-o\s+([^\n<]+?)\s+<class IOMedia,/)
    const mediaName = mediaMatch ? mediaMatch[1].trim().replace(/\s+Media$/i, '') : ''

    const apfsVolumes = []
    const apfsMatches = block.matchAll(/\+-o\s+([^\n@<]+?)@\d+\s+<class AppleAPFSVolume,/g)
    for (const m of apfsMatches) {
      let vName = m[1].trim()
      if (vName.endsWith(' - Data')) vName = vName.slice(0, -' - Data'.length)
      if (!isIgnoredVolume(vName, '') && !apfsVolumes.includes(vName)) {
        apfsVolumes.push(vName)
      }
    }

    results.set(bsd, {
      readBytes: Number.isFinite(readBytes) ? readBytes : 0,
      writeBytes: Number.isFinite(writeBytes) ? writeBytes : 0,
      sizeBytes: Number.isFinite(sizeBytes) ? sizeBytes : 0,
      mediaName,
      apfsVolumes,
      protocol: proto,
      isInternal: location === 'Internal' || proto === 'Apple Fabric' || proto === 'PCI-Express' || bsd === 'disk0',
    })
  }
  return results
}

export const name = 'dsh-disk-monitor'

export function apply(ctx) {
  let disposed = false
  let sampleTimer = null
  let dailyTimer = null
  let inFlightSample = null
  const activeChildren = new Set()

  function execTracked(cmd, args, input = null) {
    if (disposed) {
      return Promise.reject(new Error('插件已关闭'))
    }
    return new Promise((resolve, reject) => {
      const child = execFile(
        cmd,
        args,
        {
          timeout: COMMAND_TIMEOUT_MS,
          maxBuffer: 16 * 1024 * 1024,
          encoding: 'utf8',
        },
        (error, stdout, stderr) => {
          activeChildren.delete(child)
          if (error) {
            reject(new Error(stderr?.trim() || error.message))
            return
          }
          resolve(stdout)
        },
      )
      activeChildren.add(child)
      if (input !== null && child.stdin) {
        child.stdin.end(input)
      }
    })
  }

  async function plistToJson(plistXml) {
    if (!plistXml) return {}
    const jsonText = await execTracked('/usr/bin/plutil', ['-convert', 'json', '-o', '-', '-'], plistXml)
    return JSON.parse(jsonText)
  }

  function parseDfOutput(dfText) {
    const byMount = new Map()
    const byDev = new Map()
    const lines = String(dfText || '').split('\n').slice(1)
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue
      const match = trimmed.match(/^(\S+)\s+(\d+)\s+(\d+)\s+(\d+)\s+\d+%\s+(.+)$/)
      if (!match) continue
      const dev = match[1].replace(/^\/dev\//, '')
      const totalKb = Number(match[2])
      const usedKb = Number(match[3])
      const availKb = Number(match[4])
      const mount = match[5].trim()
      const info = {
        dev,
        mountPoint: mount,
        totalBytes: totalKb * 1024,
        usedBytes: Math.max(usedKb, totalKb - availKb) * 1024,
      }
      byMount.set(mount, info)
      const wholeMatch = dev.match(/^(disk\d+)/)
      if (wholeMatch && mount.startsWith('/Volumes/')) {
        byDev.set(wholeMatch[1], info)
      }
    }
    return { byMount, byDev }
  }

  async function collectPhysicalDisks() {
    const [physicalPlist, allPlist, ioregText, dfText] = await Promise.all([
      execTracked('/usr/sbin/diskutil', ['list', '-plist', 'physical']).catch(() => ''),
      execTracked('/usr/sbin/diskutil', ['list', '-plist']).catch(() => ''),
      execTracked('/usr/sbin/ioreg', ['-c', 'IOBlockStorageDriver', '-r', '-l', '-w', '0']),
      execTracked('/bin/df', ['-kP']).catch(() => ''),
    ])

    const [physicalData, allData] = await Promise.all([
      plistToJson(physicalPlist).catch(() => ({})),
      plistToJson(allPlist).catch(() => ({})),
    ])

    const { byMount: dfByMount, byDev: dfByDev } = parseDfOutput(dfText)
    const ioByDisk = parseIoregText(ioregText)

    const physicalWholes = new Set(Array.isArray(physicalData?.WholeDisks) ? physicalData.WholeDisks : [])
    for (const bsd of ioByDisk.keys()) {
      physicalWholes.add(bsd)
    }

    const allEntries = Array.isArray(allData?.AllDisksAndPartitions) ? allData.AllDisksAndPartitions : []
    const partToPhysical = new Map()
    const physicalMeta = new Map()

    for (const bsd of physicalWholes) {
      partToPhysical.set(bsd, bsd)
      const io = ioByDisk.get(bsd)
      physicalMeta.set(bsd, {
        diskId: bsd,
        size: io?.sizeBytes || 0,
        candidates: [],
      })
    }

    for (const entry of allEntries) {
      const devId = entry?.DeviceIdentifier
      if (!devId || !physicalWholes.has(devId)) continue
      const meta = physicalMeta.get(devId)
      if (entry.Size && !meta.size) meta.size = Number(entry.Size)
      if (Array.isArray(entry.Partitions)) {
        for (const part of entry.Partitions) {
          if (part?.DeviceIdentifier) partToPhysical.set(part.DeviceIdentifier, devId)
          if (!isIgnoredVolume(part?.VolumeName, part?.MountPoint) && (part?.MountPoint || part?.VolumeName)) {
            meta.candidates.push({
              volumeName: part.VolumeName || '',
              mountPoint: part.MountPoint || '',
              size: Number(part.Size || entry.Size || 0),
            })
          }
        }
      }
    }

    // Map Synthesized APFS containers back to their backing physical disk
    for (const entry of allEntries) {
      const stores = Array.isArray(entry?.APFSPhysicalStores) ? entry.APFSPhysicalStores : []
      if (!stores.length) continue
      let ownerPhysical = null
      for (const store of stores) {
        const rawStoreId = String(store?.DeviceIdentifier || '')
        const mapped = partToPhysical.get(rawStoreId) || partToPhysical.get(rawStoreId.replace(/s\d+.*$/, ''))
        if (mapped) {
          ownerPhysical = mapped
          break
        }
      }
      if (!ownerPhysical || !physicalMeta.has(ownerPhysical)) continue
      const meta = physicalMeta.get(ownerPhysical)
      const volumes = Array.isArray(entry.APFSVolumes) ? entry.APFSVolumes : []
      for (const vol of volumes) {
        if (!isIgnoredVolume(vol?.VolumeName, vol?.MountPoint) && (vol?.MountPoint || vol?.VolumeName)) {
          meta.candidates.push({
            volumeName: vol.VolumeName || '',
            mountPoint: vol.MountPoint || '',
            size: Number(vol.Size || meta.size || 0),
          })
        }
      }
    }

    // Also supplement from ioreg APFS volume names & df mounts so BackupDisk (even unmounted) is always included
    for (const [diskId, meta] of physicalMeta.entries()) {
      const io = ioByDisk.get(diskId)
      if (io && Array.isArray(io.apfsVolumes)) {
        for (const vName of io.apfsVolumes) {
          if (!meta.candidates.some(c => c.volumeName === vName || c.volumeName === `${vName} - Data`)) {
            meta.candidates.push({
              volumeName: vName,
              mountPoint: diskId === 'disk0' && vName === 'Macintosh HD' ? '/' : '',
              size: meta.size || io.sizeBytes || 0,
            })
          }
        }
      }
      const dfDev = dfByDev.get(diskId)
      if (dfDev && dfDev.mountPoint.startsWith('/Volumes/')) {
        const vName = dfDev.mountPoint.slice('/Volumes/'.length)
        if (!meta.candidates.some(c => c.mountPoint === dfDev.mountPoint)) {
          meta.candidates.push({
            volumeName: vName,
            mountPoint: dfDev.mountPoint,
            size: dfDev.totalBytes || meta.size || 0,
          })
        }
      }
    }

    const disks = []
    for (const [diskId, meta] of physicalMeta.entries()) {
      if (!meta.candidates.length) continue

      // Prefer mounted volumes first ('/' > '/Volumes/*' > '/System/Volumes/Data'), then unmounted named volumes (e.g. BackupDisk)
      meta.candidates.sort((a, b) => {
        const rank = (c) => {
          const m = c.mountPoint || ''
          if (m === '/') return 0
          if (m.startsWith('/Volumes/')) return 1
          if (m === '/System/Volumes/Data') return 2
          if (m) return 3
          if (c.volumeName) return 4
          return 5
        }
        return rank(a) - rank(b)
      })

      const primary = meta.candidates[0]
      let volumeName = primary.volumeName
      if (!volumeName && primary.mountPoint === '/') volumeName = 'Macintosh HD'
      if (!volumeName && primary.mountPoint.startsWith('/Volumes/')) {
        volumeName = primary.mountPoint.slice('/Volumes/'.length)
      }
      if (volumeName.endsWith(' - Data')) {
        volumeName = volumeName.slice(0, -' - Data'.length)
      }
      if (!volumeName) continue

      const io = ioByDisk.get(diskId) || {
        readBytes: 0,
        writeBytes: 0,
        sizeBytes: 0,
        mediaName: '',
        protocol: '',
        isInternal: diskId === 'disk0',
      }
      const dfInfo = (primary.mountPoint && dfByMount.get(primary.mountPoint))
        || (diskId === 'disk0' ? dfByMount.get('/System/Volumes/Data') || dfByMount.get('/') : null)
      const totalBytes = dfInfo?.totalBytes || meta.size || primary.size || io.sizeBytes || 0
      const usedBytes = dfInfo?.usedBytes || 0
      const kind = io.isInternal ? 'internal' : 'external'

      disks.push({
        id: `vol::${kind}::${volumeName}`,
        legacyId: `${diskId}::${volumeName}`,
        diskId,
        volumeName,
        mountPoint: primary.mountPoint || '',
        mounted: Boolean(primary.mountPoint),
        mediaName: io.mediaName || '',
        kind,
        protocol: io.protocol || (io.isInternal ? '内置存储' : '外接存储'),
        totalBytes,
        usedBytes,
        rawReadBytes: io.readBytes,
        rawWriteBytes: io.writeBytes,
      })
    }

    disks.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'internal' ? -1 : 1
      return a.volumeName.localeCompare(b.volumeName, 'zh-CN')
    })
    return disks
  }

  function loadStore() {
    const store = readJsonSafe(DATA_FILE, null)
    if (store && typeof store === 'object' && store.disks && typeof store.disks === 'object') {
      return store
    }
    return {
      version: 3,
      lastSampleAt: null,
      lastScheduled7amDate: null,
      lastScheduled7amAt: null,
      disks: {},
    }
  }

  function normalizeDaily(dailyObj) {
    const cleaned = {}
    for (const [dateKey, val] of Object.entries(dailyObj || {})) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(dateKey) && val && typeof val === 'object') {
        cleaned[dateKey] = {
          readBytes: Math.max(0, Number(val.readBytes || 0)),
          writeBytes: Math.max(0, Number(val.writeBytes || 0)),
        }
      }
    }
    return cleaned
  }

  /**
   * Distribute cumulative boot-session read/write bytes across each active calendar day
   * between `bootTimeMs` and `now` proportionally by active hours per day.
   */
  function distributeByBootWindow(rawReadBytes, rawWriteBytes, bootTimeMs, now = new Date()) {
    const today = localDateStr(now)
    const nowMs = now.getTime()
    if (!Number.isFinite(bootTimeMs) || bootTimeMs <= 0 || bootTimeMs >= nowMs) {
      return { [today]: { readBytes: rawReadBytes, writeBytes: rawWriteBytes } }
    }
    const startDt = new Date(bootTimeMs)
    const curDay = new Date(startDt.getFullYear(), startDt.getMonth(), startDt.getDate(), 0, 0, 0, 0)
    const endDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0)
    const segments = []
    let totalMs = 0

    for (let d = new Date(curDay); d.getTime() <= endDay.getTime(); d.setDate(d.getDate() + 1)) {
      const dayStart = Math.max(d.getTime(), bootTimeMs)
      const nextMidnight = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 0, 0, 0, 0).getTime()
      const dayEnd = Math.min(nextMidnight, nowMs)
      const activeMs = Math.max(0, dayEnd - dayStart)
      if (activeMs > 0) {
        segments.push({ dateKey: localDateStr(d), activeMs })
        totalMs += activeMs
      }
    }

    if (segments.length <= 1 || totalMs <= 0) {
      return { [today]: { readBytes: rawReadBytes, writeBytes: rawWriteBytes } }
    }

    const daily = {}
    let allocRead = 0
    let allocWrite = 0
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i]
      if (i === segments.length - 1) {
        daily[seg.dateKey] = {
          readBytes: Math.max(0, rawReadBytes - allocRead),
          writeBytes: Math.max(0, rawWriteBytes - allocWrite),
        }
      } else {
        const r = Math.round((rawReadBytes * seg.activeMs) / totalMs)
        const w = Math.round((rawWriteBytes * seg.activeMs) / totalMs)
        daily[seg.dateKey] = { readBytes: r, writeBytes: w }
        allocRead += r
        allocWrite += w
      }
    }
    return daily
  }

  async function getBootTimeMs() {
    try {
      const out = await execTracked('/usr/sbin/sysctl', ['-n', 'kern.boottime'])
      const m = String(out || '').match(/sec\s*=\s*(\d+)/)
      return m ? Number(m[1]) * 1000 : 0
    } catch (_e) {
      return 0
    }
  }

  async function sampleAll(trigger = 'manual') {
    if (disposed) return null
    if (inFlightSample) return inFlightSample

    inFlightSample = (async () => {
      const now = new Date()
      const today = localDateStr(now)
      const nowIso = localIsoStr(now)

      const [liveDisks, bootTimeMs] = await Promise.all([
        collectPhysicalDisks(),
        getBootTimeMs(),
      ])
      if (disposed) return null

      const store = loadStore()
      store.version = 3
      const liveIds = new Set()

      for (const disk of liveDisks) {
        liveIds.add(disk.id)
        if (disk.legacyId && store.disks[disk.legacyId]) {
          if (!store.disks[disk.id]) {
            store.disks[disk.id] = { ...store.disks[disk.legacyId], id: disk.id }
          }
          delete store.disks[disk.legacyId]
        }
        const existing = store.disks[disk.id]
        if (!existing) {
          store.disks[disk.id] = {
            id: disk.id,
            diskId: disk.diskId,
            volumeName: disk.volumeName,
            mountPoint: disk.mountPoint,
            mounted: disk.mounted,
            mediaName: disk.mediaName,
            kind: disk.kind,
            protocol: disk.protocol,
            totalBytes: disk.totalBytes,
            usedBytes: disk.usedBytes,
            connected: true,
            lastSeenAt: nowIso,
            lastRawReadBytes: disk.rawReadBytes,
            lastRawWriteBytes: disk.rawWriteBytes,
            daily: distributeByBootWindow(disk.rawReadBytes, disk.rawWriteBytes, bootTimeMs, now),
          }
          continue
        }

        const prevRead = Number(existing.lastRawReadBytes ?? disk.rawReadBytes)
        const prevWrite = Number(existing.lastRawWriteBytes ?? disk.rawWriteBytes)
        const deltaRead = disk.rawReadBytes >= prevRead ? disk.rawReadBytes - prevRead : disk.rawReadBytes
        const deltaWrite = disk.rawWriteBytes >= prevWrite ? disk.rawWriteBytes - prevWrite : disk.rawWriteBytes

        let daily = normalizeDaily(existing.daily)
        const priorDates = Object.keys(daily).filter(k => k < today)
        if (priorDates.length === 0 && bootTimeMs > 0 && localDateStr(new Date(bootTimeMs)) < today) {
          // Backfill single-day unsplit record across the current boot window
          daily = distributeByBootWindow(disk.rawReadBytes, disk.rawWriteBytes, bootTimeMs, now)
        } else {
          if (!daily[today]) {
            daily[today] = { readBytes: 0, writeBytes: 0 }
          }
          daily[today].readBytes += deltaRead
          daily[today].writeBytes += deltaWrite
        }

        store.disks[disk.id] = {
          ...existing,
          diskId: disk.diskId,
          volumeName: disk.volumeName,
          mountPoint: disk.mountPoint,
          mounted: disk.mounted,
          mediaName: disk.mediaName,
          kind: disk.kind,
          protocol: disk.protocol,
          totalBytes: disk.totalBytes,
          usedBytes: disk.usedBytes,
          connected: true,
          lastSeenAt: nowIso,
          lastRawReadBytes: disk.rawReadBytes,
          lastRawWriteBytes: disk.rawWriteBytes,
          daily,
        }
      }

      for (const [id, entry] of Object.entries(store.disks)) {
        if (!id.startsWith('vol::')) {
          delete store.disks[id]
          continue
        }
        if (!liveIds.has(id)) {
          entry.connected = false
          entry.daily = normalizeDaily(entry.daily)
        }
      }

      store.lastSampleAt = nowIso
      if (trigger === 'scheduled-7am') {
        store.lastScheduled7amDate = today
        store.lastScheduled7amAt = nowIso
      }

      atomicWriteJson(DATA_FILE, store)
      return store
    })().finally(() => {
      inFlightSample = null
    })

    return inFlightSample
  }

  function loadPrefs(connectedIds) {
    const saved = readJsonSafe(PREFS_FILE, null)
    const days = SUPPORTED_DAYS.has(Number(saved?.days)) ? Number(saved.days) : DEFAULT_HISTORY_DAYS
    if (saved && Array.isArray(saved.selectedIds)) {
      const knownSet = new Set(Array.isArray(saved.knownIds) ? saved.knownIds : saved.selectedIds)
      const selected = new Set(saved.selectedIds.filter(id => connectedIds.includes(id)))
      for (const id of connectedIds) {
        if (!knownSet.has(id)) {
          selected.add(id)
        }
      }
      return {
        selectedIds: Array.from(selected),
        days,
        updatedAt: saved.updatedAt || null,
      }
    }
    return {
      selectedIds: [...connectedIds],
      days,
      updatedAt: null,
    }
  }

  function buildResponseState(store, overrideDays = null) {
    const now = new Date()
    const connectedEntries = Object.values(store.disks || {}).filter(d => Boolean(d.connected))

    connectedEntries.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'internal' ? -1 : 1
      return String(a.volumeName).localeCompare(String(b.volumeName), 'zh-CN')
    })

    const connectedIds = connectedEntries.map(d => d.id)
    const prefs = loadPrefs(connectedIds)
    const days = SUPPORTED_DAYS.has(Number(overrideDays)) ? Number(overrideDays) : prefs.days
    const dates = buildRecentDates(days, now)
    const today = dates[dates.length - 1]

    const disks = connectedEntries.map((d) => {
      const series = dates.map((dateStr) => {
        const rec = d.daily?.[dateStr]
        return {
          date: dateStr,
          readBytes: Number(rec?.readBytes || 0),
          writeBytes: Number(rec?.writeBytes || 0),
        }
      })
      const todayRec = series[series.length - 1] || { readBytes: 0, writeBytes: 0 }
      const totalReadPeriod = series.reduce((acc, item) => acc + item.readBytes, 0)
      const totalWritePeriod = series.reduce((acc, item) => acc + item.writeBytes, 0)
      return {
        id: d.id,
        diskId: d.diskId,
        volumeName: d.volumeName,
        mountPoint: d.mountPoint || '',
        mounted: d.mounted !== false && Boolean(d.mountPoint),
        mediaName: d.mediaName || '',
        kind: d.kind,
        protocol: d.protocol,
        totalBytes: Number(d.totalBytes || 0),
        usedBytes: Number(d.usedBytes || 0),
        connected: true,
        lastSeenAt: d.lastSeenAt || null,
        todayReadBytes: todayRec.readBytes,
        todayWriteBytes: todayRec.writeBytes,
        rawReadBytes: Number(d.lastRawReadBytes || 0),
        rawWriteBytes: Number(d.lastRawWriteBytes || 0),
        totalReadPeriod,
        totalWritePeriod,
        series,
      }
    })

    const next7am = next7amTimestamp(now)

    return {
      pluginId: PLUGIN_ID,
      today,
      days,
      dates,
      lastSampleAt: store.lastSampleAt,
      lastScheduled7amDate: store.lastScheduled7amDate,
      lastScheduled7amAt: store.lastScheduled7amAt,
      nextScheduled7amAt: localIsoStr(next7am),
      selectedIds: prefs.selectedIds,
      disks,
    }
  }

  function scheduleNext7am() {
    if (disposed) return
    if (dailyTimer) {
      clearTimeout(dailyTimer)
      dailyTimer = null
    }
    const target = next7amTimestamp(new Date())
    const delayMs = Math.max(1000, target.getTime() - Date.now())
    dailyTimer = setTimeout(() => {
      dailyTimer = null
      if (disposed) return
      sampleAll('scheduled-7am')
        .catch(() => {})
        .finally(() => scheduleNext7am())
    }, delayMs)
    if (typeof dailyTimer.unref === 'function') dailyTimer.unref()
  }

  function startMonitors() {
    if (disposed) return
    sampleAll('startup').catch(() => {})

    sampleTimer = setInterval(() => {
      if (disposed) return
      sampleAll('periodic').catch(() => {})
    }, SAMPLE_INTERVAL_MS)
    if (typeof sampleTimer.unref === 'function') sampleTimer.unref()

    scheduleNext7am()
  }

  async function handleFetchRequest(request) {
    try {
      const url = new URL(request.url)
      const subPath = url.pathname.replace(/^\/api\/disk-monitor\/?/, '')
      const method = (request.method || 'GET').toUpperCase()
      const queryDays = Number(url.searchParams.get('days'))

      if (method === 'GET' && (subPath === '' || subPath === 'state')) {
        let store = loadStore()
        const lastMs = store.lastSampleAt ? Date.parse(store.lastSampleAt) : 0
        if (!lastMs || Date.now() - lastMs > STATE_STALE_MS) {
          store = (await sampleAll('state-refresh')) || store
        }
        return Response.json(buildResponseState(store, queryDays), { headers: { 'Cache-Control': 'no-store' } })
      }

      if (method === 'POST' && subPath === 'sample') {
        const body = await request.json().catch(() => ({}))
        const store = (await sampleAll('manual')) || loadStore()
        return Response.json(buildResponseState(store, body?.days ?? queryDays), { headers: { 'Cache-Control': 'no-store' } })
      }

      if (method === 'POST' && subPath === 'preferences') {
        const body = await request.json()
        const store = loadStore()
        const connectedIds = Object.values(store.disks || {}).filter(d => Boolean(d.connected)).map(d => d.id)
        const currentPrefs = loadPrefs(connectedIds)
        const selectedIds = Array.isArray(body?.selectedIds)
          ? body.selectedIds.map(x => String(x))
          : currentPrefs.selectedIds
        const days = SUPPORTED_DAYS.has(Number(body?.days)) ? Number(body.days) : currentPrefs.days
        atomicWriteJson(PREFS_FILE, {
          selectedIds,
          knownIds: connectedIds,
          days,
          updatedAt: localIsoStr(new Date()),
        })
        return Response.json(buildResponseState(store, days), { headers: { 'Cache-Control': 'no-store' } })
      }

      return Response.json(
        { error: `Unknown disk-monitor endpoint: ${method} /api/disk-monitor/${subPath}` },
        { status: 404 },
      )
    } catch (err) {
      return Response.json(
        { error: err instanceof Error ? err.message : String(err) },
        { status: 500 },
      )
    }
  }

  const ROUTES = [
    { path: '/api/disk-monitor', methods: ['GET'] },
    { path: '/api/disk-monitor/state', methods: ['GET'] },
    { path: '/api/disk-monitor/sample', methods: ['POST'] },
    { path: '/api/disk-monitor/preferences', methods: ['POST'] },
  ]

  startMonitors()

  ctx.inject(['connection'], (connCtx) => {
    for (const route of ROUTES) {
      connCtx.connection.fetch.register({
        path: route.path,
        methods: route.methods,
        requestBody: 'buffered',
        fetch: handleFetchRequest,
      })
    }
  })

  // Ensure all timers and in-flight monitor processes exit completely when plugin closes
  ctx.on('dispose', () => {
    disposed = true
    if (sampleTimer) {
      clearInterval(sampleTimer)
      sampleTimer = null
    }
    if (dailyTimer) {
      clearTimeout(dailyTimer)
      dailyTimer = null
    }
    for (const child of activeChildren) {
      try {
        child.kill('SIGTERM')
        const forceKill = setTimeout(() => {
          try {
            if (!child.killed) child.kill('SIGKILL')
          } catch (_e) {}
        }, 200)
        if (typeof forceKill.unref === 'function') forceKill.unref()
      } catch (_e) {}
    }
    activeChildren.clear()
  })
}
