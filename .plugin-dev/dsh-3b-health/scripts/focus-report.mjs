#!/usr/bin/env node
/**
 * 3B健康侧栏日报（文本）：计算当天侧栏模型并投递到 DSH-IM 主动投递接口。
 *
 * 用法：
 *   node scripts/focus-report.mjs                      # 只打印消息，不发送
 *   node scripts/focus-report.mjs --send               # 投递到 DSH-IM 主动投递接口
 *   node scripts/focus-report.mjs --send --target=daily-health
 *
 * 投递参数（优先级：命令行 > 环境变量 > runtime/dsh-im-target.json）：
 *   botId     --bot / DSH_IM_BOT_ID     默认 wecom_fa20fb118694eb265eaffae2
 *   targetId  --target / DSH_IM_TARGET_ID
 *   baseUrl   --base / DSH_WEB_BASE      默认 http://127.0.0.1:3090
 *   格式      --format=plain|markdown   默认 plain
 *
 * 只读：健康快照与偏好只读不写；发送仅在显式 --send 时发生。
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEFAULT_BOT_ID, formatTextReport, loadFocusModel, readJsonFile, resolveRuntimeDir } from './lib/focus-model.mjs'

const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const runtimeDir = resolveRuntimeDir(pluginRoot)
const args = process.argv.slice(2)
const flag = (name) => args.includes('--' + name)
const option = (name) => {
  const prefix = '--' + name + '='
  const hit = args.find((arg) => arg === '--' + name || arg.startsWith(prefix))
  if (!hit) return undefined
  return hit === '--' + name ? true : hit.slice(prefix.length)
}

function fail(message) {
  console.error('[focus-report] ' + message)
  process.exit(1)
}

let loaded
try {
  loaded = await loadFocusModel(pluginRoot)
} catch (error) {
  fail(error.message)
}
const text = formatTextReport(loaded.model, loaded.health)
const format = option('format') === 'markdown' ? 'markdown' : 'plain'

let config = {}
const configPath = join(runtimeDir, 'dsh-im-target.json')
if (existsSync(configPath)) {
  try {
    config = readJsonFile(configPath, '投递目标配置')
  } catch (error) {
    fail(error.message)
  }
}
const botId = option('bot') || process.env.DSH_IM_BOT_ID || config.botId || DEFAULT_BOT_ID
const targetId = option('target') || process.env.DSH_IM_TARGET_ID || config.targetId
const baseUrl = option('base') || process.env.DSH_WEB_BASE || config.baseUrl || 'http://127.0.0.1:3090'

if (!flag('send')) {
  console.log(text)
  console.log('')
  console.log('[focus-report] 未发送（dry-run）。加 --send 才会投递到企业微信。')
  process.exit(0)
}

if (!targetId || typeof targetId !== 'string') {
  fail('缺少投递目标 targetId。请在 DSH「设置 → IM机器人 → 企业微信机器人 → 投递目标」新建并测试目标，复制 targetId 后写入 '
    + configPath + ' 的 {"botId":"' + botId + '","targetId":"..."}，或设置环境变量 DSH_IM_TARGET_ID。')
}

const response = await fetch(baseUrl.replace(/\/+$/, '') + '/api/dsh-im/delivery/messages', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ botId, targetId, text, format }),
  signal: AbortSignal.timeout(20000),
}).catch((error) => fail('调用 DSH-IM 投递接口失败：' + error.message))

const body = await response.text().catch(() => '')
let payload = null
try {
  payload = JSON.parse(body)
} catch (_e) {
  payload = null
}
if (!response.ok || !payload || payload.sent !== true) {
  fail('投递失败：HTTP ' + response.status + ' ' + (body || '<empty>').slice(0, 400))
}
console.log('[focus-report] 已提交企业微信投递：botId=' + botId + ' targetId=' + targetId + ' format=' + format + ' 字数=' + text.length)
