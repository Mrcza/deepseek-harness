#!/usr/bin/env node
/**
 * 3B健康侧栏日报（JPEG）：把侧栏模型渲染成一张图片保存；可选投递到 Telegram 或企业微信群机器人。
 *
 * 用法：
 *   node scripts/focus-report-image.mjs                       # 生成 runtime/focus-report-YYYY-MM-DD.jpg
 *   node scripts/focus-report-image.mjs --out=/tmp/x.jpg
 *   node scripts/focus-report-image.mjs --send                # 按 runtime/dsh-delivery.json 投递
 *   node scripts/focus-report-image.mjs --send --mode=photo   # Telegram 以照片发送（默认 document）
 *
 * 投递配置（优先级：命令行 > 环境变量 > 配置文件）：
 *   runtime/dsh-delivery.json  {"channel":"telegram","botId":"...","targetId":"...","mode":"document"}
 *   Telegram 的 token 与 chatId 在发送时从 ~/.dsh/integrations/dsh-telegram 解析，不写入本插件。
 *   企业微信群机器人仍可用 runtime/wecom-webhook.json 或 WECOM_WEBHOOK。
 *
 * 只读健康数据；只有 --send 才发送。
 * 渲染用 Playwright + 本机 Chromium；可用 DSH_PLAYWRIGHT_PATH、DSH_CHROMIUM_BIN 覆盖。
 */
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync, unlinkSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadFocusModel, readJsonFile, resolveRuntimeDir } from './lib/focus-model.mjs'

const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const flag = (name) => args.includes('--' + name)
const option = (name) => {
  const prefix = '--' + name + '='
  const hit = args.find((arg) => arg === '--' + name || arg.startsWith(prefix))
  if (!hit) return undefined
  return hit === '--' + name ? true : hit.slice(prefix.length)
}

function fail(message) {
  console.error('[focus-report-image] ' + message)
  process.exit(1)
}

const watchdogMs = Number(option('timeout'))
const watchdog = setTimeout(() => {
  console.error('[focus-report-image] 执行超时（' + (watchdogMs || 120000) + ' ms），已退出')
  process.exit(2)
}, watchdogMs > 0 ? watchdogMs : 120000)
watchdog.unref()

const ZONE_COLORS = {
  athlete: '#2b6cb0',
  overweight: '#c06c2b',
  obese: '#b83a2e',
  muscular: '#236b48',
  healthy: '#2e6b4f',
  hiddenFat: '#b85d19',
  thin: '#8c3b5a',
  slimMuscular: '#2d7a6e',
  slim: '#9b6b2e',
}

const ZONE_LABELS = {
  athlete: '运动员型',
  overweight: '偏胖',
  obese: '肥胖',
  muscular: '肌肉型',
  healthy: '健康型',
  hiddenFat: '隐形肥胖',
  thin: '消瘦型',
  slimMuscular: '苗条肌肉型',
  slim: '苗条型',
}

function esc(value) {
  return String(value === undefined || value === null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function fill(html, token, value) {
  return html.split(token).join(value)
}

function num(value) {
  return Math.round(value * 100) / 100
}

function cardHtml(card) {
  const unit = card.unit === '%' ? '%' : card.unit ? ' ' + card.unit : ''
  const tone = card.tone === 'good' ? 'good' : 'warn'
  const action = card.actionText ? '<span class="action"> · ' + esc(card.actionText) + '</span>' : ''
  const delta = card.deltaText ? '<span class="delta">' + esc(card.deltaText) + '</span>' : ''
  const sub = card.subText ? '<p class="fc-sub">' + esc(card.subText) + '</p>' : ''
  return '<article class="fc">'
    + '<div class="fc-head"><h4>' + esc(card.label) + '</h4><span class="pill ' + tone + '">' + esc(card.status) + '</span></div>'
    + '<div class="fc-value"><strong>' + esc(card.valueText) + '</strong><span class="unit">' + esc(unit) + '</span>' + delta + '</div>'
    + sub
    + '<p class="fc-gap ' + (tone === 'good' ? 'good' : '') + '">' + esc(card.gapText) + action + '</p>'
    + '</article>'
}

function targetHtml(row) {
  const tone = row.tone === 'warn' ? ' warn' : row.tone === 'good' ? ' good' : ''
  return '<li><span class="t-label">' + esc(row.label) + '</span>'
    + '<span class="t-value' + tone + '">' + esc(row.valueText) + '</span>'
    + '<span class="t-gap">' + esc(row.gapText) + '</span></li>'
}

function gridSvg(grid) {
  if (!grid || !Array.isArray(grid.points) || grid.points.length === 0) {
    return '<p class="empty">近 15 天暂无可用体测记录</p>'
  }
  const width = 320
  const height = 250
  const pad = { left: 30, right: 10, top: 10, bottom: 26 }
  const plotW = width - pad.left - pad.right
  const plotH = height - pad.top - pad.bottom
  const ax = grid.xAxis
  const ay = grid.yAxis
  const sx = (value) => pad.left + ((value - ax.min) / (ax.max - ax.min)) * plotW
  const sy = (value) => pad.top + ((ay.max - value) / (ay.max - ay.min)) * plotH
  const colRanges = [[ax.min, ax.cut1], [ax.cut1, ax.cut2], [ax.cut2, ax.max]]
  const rowRanges = [[ay.cut2, ay.max], [ay.cut1, ay.cut2], [ay.min, ay.cut1]]
  const table = [
    ['athlete', 'overweight', 'obese'],
    ['muscular', 'healthy', 'hiddenFat'],
    ['thin', 'slimMuscular', 'slim'],
  ]
  const parts = []
  parts.push('<svg viewBox="0 0 320 250" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="身体类型九宫格与近15天轨迹">')
  const gradients = []
  for (let i = 1; i < grid.points.length; i += 1) {
    const from = grid.points[i - 1]
    const to = grid.points[i]
    gradients.push('<linearGradient id="seg' + i + '" gradientUnits="userSpaceOnUse" x1="' + num(sx(from.bodyFat))
      + '" y1="' + num(sy(from.bmi)) + '" x2="' + num(sx(to.bodyFat)) + '" y2="' + num(sy(to.bmi)) + '">'
      + '<stop offset="0%" stop-color="' + ZONE_COLORS[from.zone] + '" stop-opacity="' + from.alpha + '"/>'
      + '<stop offset="100%" stop-color="' + ZONE_COLORS[to.zone] + '" stop-opacity="' + to.alpha + '"/>'
      + '</linearGradient>')
  }
  parts.push('<defs>' + gradients.join('') + '</defs>')
  for (let row = 0; row < 3; row += 1) {
    for (let col = 0; col < 3; col += 1) {
      const left = num(sx(colRanges[col][0]))
      const right = num(sx(colRanges[col][1]))
      const top = num(sy(rowRanges[row][1]))
      const bottom = num(sy(rowRanges[row][0]))
      const key = table[row][col]
      const current = grid.current && grid.current.row === row && grid.current.col === col
      parts.push('<rect x="' + left + '" y="' + top + '" width="' + Math.max(0, right - left) + '" height="' + Math.max(0, bottom - top)
        + '" fill="' + ZONE_COLORS[key] + '" fill-opacity="' + (current ? '0.16' : '0') + '" stroke="'
        + (current ? ZONE_COLORS[key] : 'transparent') + '" stroke-width="' + (current ? '1.2' : '0') + '"/>')
      parts.push('<text x="' + num((left + right) / 2) + '" y="' + num((top + bottom) / 2)
        + '" fill="#8a857c" font-size="8.5" text-anchor="middle" dominant-baseline="middle">' + ZONE_LABELS[key] + '</text>')
    }
  }
  const rules = [
    [sx(ax.cut1), sy(ay.min), sx(ax.cut1), sy(ay.max)],
    [sx(ax.cut2), sy(ay.min), sx(ax.cut2), sy(ay.max)],
    [sx(ax.min), sy(ay.cut1), sx(ax.max), sy(ay.cut1)],
    [sx(ax.min), sy(ay.cut2), sx(ax.max), sy(ay.cut2)],
  ]
  for (const rule of rules) {
    parts.push('<line x1="' + num(rule[0]) + '" y1="' + num(rule[1]) + '" x2="' + num(rule[2]) + '" y2="' + num(rule[3])
      + '" stroke="rgba(10,10,11,0.55)" stroke-width="1"/>')
  }
  parts.push('<text x="' + (pad.left + 3) + '" y="' + (pad.top + 9) + '" fill="#8a857c" font-size="8" font-family="ui-monospace, monospace">BMI ' + ay.max + '</text>')
  parts.push('<text x="' + (pad.left - 3) + '" y="' + num(sy(ay.min) - 4) + '" fill="#8a857c" font-size="8" font-family="ui-monospace, monospace" text-anchor="end">' + ay.min + '</text>')
  parts.push('<text x="' + pad.left + '" y="' + (height - 4) + '" fill="#8a857c" font-size="8" font-family="ui-monospace, monospace">体脂 ' + ax.min + '%</text>')
  parts.push('<text x="' + (width - pad.right) + '" y="' + (height - 4) + '" fill="#8a857c" font-size="8" font-family="ui-monospace, monospace" text-anchor="end">' + ax.max + '%</text>')
  for (let i = 1; i < grid.points.length; i += 1) {
    const from = grid.points[i - 1]
    const to = grid.points[i]
    parts.push('<line x1="' + num(sx(from.bodyFat)) + '" y1="' + num(sy(from.bmi)) + '" x2="' + num(sx(to.bodyFat))
      + '" y2="' + num(sy(to.bmi)) + '" stroke="url(#seg' + i + ')" stroke-width="' + to.width + '" stroke-linecap="round"/>')
  }
  for (let i = 0; i < grid.points.length; i += 1) {
    const point = grid.points[i]
    const cx = num(sx(point.bodyFat))
    const cy = num(sy(point.bmi))
    const color = ZONE_COLORS[point.zone]
    if (i === grid.points.length - 1) {
      parts.push('<circle cx="' + cx + '" cy="' + cy + '" r="8" fill="' + color + '" fill-opacity="0.22"/>')
    }
    const fillColor = point.interpolated ? '#f1efea' : color
    const dash = point.interpolated ? ' stroke-dasharray="2 1"' : ''
    parts.push('<circle cx="' + cx + '" cy="' + cy + '" r="' + point.radius + '" fill="' + fillColor
      + '" fill-opacity="' + point.alpha + '" stroke="' + color + '" stroke-width="' + (point.interpolated ? '1' : '0')
      + '" stroke-opacity="' + point.alpha + '"' + dash + '><title>' + esc(point.date) + '</title></circle>')
  }
  parts.push('</svg>')
  return parts.join('')
}

function loadPlaywright(root) {
  const packageDir = process.env.DSH_PLAYWRIGHT_PATH
    || resolve(root, '..', '..', 'apps', 'web', 'node_modules', 'playwright')
  if (!existsSync(packageDir)) {
    throw new Error('未找到 playwright 包：' + packageDir + '（可用 DSH_PLAYWRIGHT_PATH 指定）')
  }
  const requireFrom = createRequire(resolve(packageDir, 'package.json'))
  return requireFrom(packageDir)
}

function findChromium() {
  if (process.env.DSH_CHROMIUM_BIN) return process.env.DSH_CHROMIUM_BIN
  const cacheDir = join(homedir(), 'Library', 'Caches', 'ms-playwright')
  if (!existsSync(cacheDir)) return undefined
  const candidates = []
  for (const name of readdirSync(cacheDir)) {
    if (name.indexOf('chromium') !== 0) continue
    const base = join(cacheDir, name)
    const paths = [
      join(base, 'chrome-headless-shell-mac-arm64', 'chrome-headless-shell'),
      join(base, 'chrome-headless-shell-mac-x64', 'chrome-headless-shell'),
      join(base, 'chrome-mac-arm64', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'),
      join(base, 'chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'),
      join(base, 'chrome-linux', 'headless_shell'),
      join(base, 'chrome-linux', 'chrome'),
    ]
    for (const candidate of paths) {
      if (existsSync(candidate)) {
        candidates.push({ path: candidate, mtime: statSync(candidate).mtimeMs })
        break
      }
    }
  }
  candidates.sort((a, b) => b.mtime - a.mtime)
  return candidates.length ? candidates[0].path : undefined
}

async function postWebhook(url, payload) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(30000),
  }).catch((error) => {
    throw new Error('调用企业微信 webhook 失败：' + error.message)
  })
  const text = await response.text().catch(() => '')
  let body = null
  try {
    body = JSON.parse(text)
  } catch (_e) {
    body = null
  }
  if (!response.ok || !body || body.errcode !== 0) {
    throw new Error('企业微信 webhook 返回失败：HTTP ' + response.status + ' ' + (text || '<empty>').slice(0, 300))
  }
}

let loaded
try {
  loaded = await loadFocusModel(pluginRoot)
} catch (error) {
  fail(error.message)
}
const model = loaded.model
const runtimeDir = loaded.runtimeDir
const today = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10)
const profile = model.profile
const deliveryConfigPath = join(runtimeDir, 'dsh-delivery.json')
const webhookConfigPath = join(runtimeDir, 'wecom-webhook.json')
let delivery = null
if (existsSync(deliveryConfigPath)) {
  try {
    delivery = readJsonFile(deliveryConfigPath, '投递配置')
  } catch (error) {
    fail(error.message)
  }
}
const channel = option('channel') || process.env.DSH_DELIVERY_CHANNEL || (delivery && delivery.channel) || ''
const botId = option('bot') || process.env.DSH_IM_BOT_ID || (delivery && delivery.botId) || ''
const targetId = option('target') || process.env.DSH_IM_TARGET_ID || (delivery && delivery.targetId) || ''
const modeOption = option('mode') || process.env.DSH_DELIVERY_MODE || (delivery && delivery.mode) || 'document'
const mode = modeOption === 'photo' ? 'photo' : 'document'
const caption = option('caption') || ('3B健康 · ' + today + ' · 综合评分 ' + (model.score === null ? '—' : model.score) + ' 分')
const templateName = mode === 'photo' ? 'report-template-photo.html' : 'report-template.html'
const template = readFileSync(join(pluginRoot, 'scripts', templateName), 'utf8')
let html = template
html = fill(html, '{{DATE}}', esc(today + ' · 侧栏摘要'))
html = fill(html, '{{PROFILE}}', esc('生理基准：' + (profile.sex === 'male' ? '男' : '女') + ' · ' + profile.age + '岁 (' + profile.birth_year + ') · ' + profile.height_cm + ' cm'))
html = fill(html, '{{SCORE}}', esc(model.score === null ? '—' : model.score))
html = fill(html, '{{ADVICE}}', esc(model.advice))
html = fill(html, '{{CARDS}}', model.cards.map(cardHtml).join(''))
html = fill(html, '{{GRID}}', gridSvg(model.grid))
html = fill(html, '{{ZONE}}', esc(model.grid && model.grid.current ? '当前：' + model.grid.zoneLabel : ''))
const currentZone = model.grid && model.grid.current ? model.grid.current : null
html = fill(html, '{{ZONE_NAME}}', esc(currentZone ? model.grid.zoneLabel : '—'))
html = fill(html, '{{ZONE_META}}', esc(currentZone ? '体脂 ' + currentZone.bodyFat.toFixed(1) + '% · 校准 BMI ' + currentZone.bmi.toFixed(1) : ''))
html = fill(html, '{{TARGET_COUNT}}', esc(model.targets.length ? '共 ' + model.targets.length + ' 项' : ''))
html = fill(html, '{{TARGETS}}', model.targets.map(targetHtml).join(''))
html = fill(html, '{{FOOTER}}', esc('数据截至 ' + (model.windowEnd || '—')
  + (model.truncated ? '（当日未完结，日均类取最近 7 个完结日）' : '')
  + ' · 快照生成 ' + ((loaded.health && loaded.health.generated_at) || '—')
  + ' · DSH 3B健康插件'))

const outPath = option('out') || join(runtimeDir, 'focus-report-' + today + '.jpg')
const qualityOption = Number(option('quality'))
const quality = Number.isFinite(qualityOption) && qualityOption >= 50 && qualityOption <= 100 ? Math.round(qualityOption) : 88

let browser
try {
  const { chromium } = loadPlaywright(pluginRoot)
  const executablePath = findChromium()
  browser = await chromium.launch(executablePath ? { headless: true, executablePath } : { headless: true })
  const page = await browser.newPage({ viewport: { width: 820, height: 1200 }, deviceScaleFactor: 2 })
  await page.setContent(html, { waitUntil: 'load' })
  await page.waitForTimeout(200)
  await page.locator('#report').screenshot({ path: outPath, type: 'jpeg', quality })
} catch (error) {
  fail('渲染 JPEG 失败：' + error.message)
} finally {
  if (browser) await browser.close().catch(() => undefined)
}

const sizeKb = Math.round(statSync(outPath).size / 1024)
console.log('[focus-report-image] 已生成 ' + outPath + '（' + sizeKb + ' KB）')

const keepOption = Number(option('keep'))
const keep = Number.isFinite(keepOption) && keepOption >= 1 && keepOption <= 365 ? Math.round(keepOption) : 30
try {
  const reports = readdirSync(runtimeDir)
    .filter((name) => name.indexOf('focus-report-') === 0 && name.endsWith('.jpg'))
    .sort()
  while (reports.length > keep) {
    const name = reports.shift()
    if (name === outPath.slice(outPath.lastIndexOf('/') + 1)) continue
    try {
      unlinkSync(join(runtimeDir, name))
    } catch (_e) {
      // 历史图片清理失败不影响本次推送
    }
  }
} catch (_e) {
  // runtime 目录不可读时跳过清理
}

if (!flag('send')) {
  console.log('[focus-report-image] 未发送（dry-run）。加 --send 才会按 runtime/dsh-delivery.json（或企业微信 webhook）投递。')
  process.exit(0)
}

function parseRef(text, ref) {
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (trimmed.indexOf(ref + ':') !== 0) continue
    return trimmed.slice(ref.length + 1).trim()
  }
  return undefined
}

async function sendTelegram(token, chatId, modeName, captionText) {
  const fileBytes = readFileSync(outPath)
  const form = new FormData()
  form.append('chat_id', String(chatId))
  if (captionText) form.append('caption', captionText)
  const field = modeName === 'photo' ? 'photo' : 'document'
  form.append(field, new Blob([fileBytes], { type: 'image/jpeg' }), '3B健康-' + today + '.jpg')
  const method = modeName === 'photo' ? 'sendPhoto' : 'sendDocument'
  const response = await fetch('https://api.telegram.org/bot' + token + '/' + method, {
    method: 'POST',
    body: form,
    signal: AbortSignal.timeout(60000),
  }).catch((error) => {
    throw new Error('调用 Telegram Bot API 失败：' + error.message)
  })
  const text = await response.text().catch(() => '')
  let body = null
  try {
    body = JSON.parse(text)
  } catch (_e) {
    body = null
  }
  if (!response.ok || !body || body.ok !== true) {
    throw new Error('Telegram 发送失败：HTTP ' + response.status + ' '
      + (body && body.description ? body.description : (text || '').slice(0, 300)))
  }
  return body
}

async function sendWecomWebhook(webhook) {
  const fileBytes = readFileSync(outPath)
  if (fileBytes.length > 2 * 1024 * 1024) {
    fail('图片超过企业微信 2MB 限制：' + fileBytes.length + ' 字节，可减小 --quality')
  }
  await postWebhook(webhook, {
    msgtype: 'image',
    image: { base64: fileBytes.toString('base64'), md5: createHash('md5').update(fileBytes).digest('hex') },
  })
}

const verbose = flag('verbose') || process.env.DSH_3B_VERBOSE === '1'
const stage = (message) => {
  if (verbose) console.error('[focus-report-image] ' + message)
}

const isTelegram = channel === 'telegram' || String(botId).indexOf('telegram_') === 0
if (isTelegram) {
  stage('telegram target=' + botId + '/' + targetId)
  if (!botId || !targetId) {
    fail('Telegram 投递缺少 botId/targetId：写入 ' + deliveryConfigPath + '，或使用 --bot= / --target=。')
  }
  const dshHome = process.env.DSH_HOME || join(homedir(), '.dsh')
  const channelDir = join(dshHome, 'integrations', 'dsh-telegram')
  const botConfig = readJsonFile(join(channelDir, 'config.json'), 'Telegram 机器人配置')
  const bots = Array.isArray(botConfig.bots) ? botConfig.bots : []
  const bot = bots.find((item) => item.botId === botId)
  if (!bot || !bot.tokenRef) {
    fail('在 ' + join(channelDir, 'config.json') + ' 没找到机器人 ' + botId + ' 的 tokenRef')
  }
  const credentials = readFileSync(join(dshHome, '.credentials.yaml'), 'utf8')
  const token = parseRef(credentials, bot.tokenRef)
  if (!token) {
    fail('在 ' + join(dshHome, '.credentials.yaml') + ' 没找到凭据 ' + bot.tokenRef)
  }
  const workspaces = readJsonFile(join(channelDir, 'workspaces.json'), 'Telegram 目标配置')
  const targets = workspaces.deliveryTargets && workspaces.deliveryTargets[botId]
  const target = targets && targets[targetId]
  const chatId = target && target.route && target.route.chatId
  if (!chatId) {
    fail('在 ' + join(channelDir, 'workspaces.json') + ' 没找到目标 ' + targetId + ' 的 chatId')
  }
  stage('chatId resolved, sending ' + mode + ' (' + sizeKb + ' KB)')
  try {
    await sendTelegram(token, chatId, mode, caption)
  } catch (error) {
    fail(error.message)
  }
  stage('send finished')
  console.log('[focus-report-image] 已发送到 Telegram（' + mode + '，' + sizeKb + ' KB）')
  process.exit(0)
}

let webhook = option('webhook') || process.env.WECOM_WEBHOOK
if (!webhook && existsSync(webhookConfigPath)) {
  try {
    const config = readJsonFile(webhookConfigPath, '群机器人配置')
    webhook = typeof config.url === 'string' ? config.url.trim() : undefined
  } catch (error) {
    fail(error.message)
  }
}
if (!webhook) {
  fail('未配置投递通道：写入 ' + deliveryConfigPath + '（Telegram）或 ' + webhookConfigPath
    + '（企业微信群机器人），或设置 DSH_DELIVERY_CHANNEL / WECOM_WEBHOOK。')
}

try {
  if (flag('with-text')) {
    await postWebhook(webhook, {
      msgtype: 'text',
      text: { content: '3B健康 · ' + today + ' · 综合评分 ' + (model.score === null ? '—' : model.score) + ' 分' },
    })
  }
  await sendWecomWebhook(webhook)
} catch (error) {
  fail(error.message)
}
console.log('[focus-report-image] 已发送到企业微信群机器人（' + sizeKb + ' KB）')
