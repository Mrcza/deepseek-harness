#!/usr/bin/env node
/**
 * 初始化健康数据 REST 影子接收服务的本地配置、随机密钥与 launchd 自启模板。
 *
 * 用法：
 *   node ingest/init.mjs                    # 生成配置、staging 目录与 plist 模板（不覆盖已有密钥）
 *   node ingest/init.mjs --install-launchd  # 同时安装并启动 ~/Library/LaunchAgents/local.health-ingest.plist
 *   node ingest/init.mjs --force            # 强制重新生成随机路径与 Token（慎用：需同步更新手机端配置）
 */
import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HOME = process.env.HOME || homedir()
const BASE_DIR = join(HOME, 'Library', 'Application Support', 'ThreeBody', 'HealthIngest')
const CONFIG_PATH = join(BASE_DIR, 'config.json')
const STAGING_DIR = join(BASE_DIR, 'staging')
const LOG_PATH = join(BASE_DIR, 'ingest.log')
const LAUNCHD_LABEL = 'local.health-ingest'
const LOCAL_PLIST_PATH = join(BASE_DIR, `${LAUNCHD_LABEL}.plist`)
const SYSTEM_PLIST_PATH = join(HOME, 'Library', 'LaunchAgents', `${LAUNCHD_LABEL}.plist`)

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const SERVER_SCRIPT = join(SCRIPT_DIR, 'server.mjs')

const args = new Set(process.argv.slice(2))
const force = args.has('--force')
const installLaunchd = args.has('--install-launchd')

function xmlEscape(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function buildPlist(nodePath, serverPath, workingDir, configPath, logPath) {
  const programArgs = [nodePath, serverPath]
    .map((arg) => `\t\t<string>${xmlEscape(arg)}</string>`)
    .join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
\t<key>Label</key>
\t<string>${xmlEscape(LAUNCHD_LABEL)}</string>
\t<key>ProgramArguments</key>
\t<array>
${programArgs}
\t</array>
\t<key>WorkingDirectory</key>
\t<string>${xmlEscape(workingDir)}</string>
\t<key>EnvironmentVariables</key>
\t<dict>
\t\t<key>HEALTH_INGEST_CONFIG</key>
\t\t<string>${xmlEscape(configPath)}</string>
\t\t<key>TZ</key>
\t\t<string>Asia/Shanghai</string>
\t</dict>
\t<key>RunAtLoad</key>
\t<true/>
\t<key>KeepAlive</key>
\t<true/>
\t<key>StandardOutPath</key>
\t<string>${xmlEscape(logPath)}</string>
\t<key>StandardErrorPath</key>
\t<string>${xmlEscape(logPath)}</string>
</dict>
</plist>
`
}

mkdirSync(BASE_DIR, { recursive: true, mode: 0o700 })
mkdirSync(STAGING_DIR, { recursive: true, mode: 0o700 })

let config
let createdConfig = false
if (existsSync(CONFIG_PATH) && !force) {
  config = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'))
} else {
  config = {
    host: '127.0.0.1',
    port: 18765,
    ingest_path: `/ingest/${randomBytes(12).toString('hex')}`,
    token: randomBytes(32).toString('hex'),
    max_body_bytes: 20 * 1024 * 1024,
    rate_limit_per_minute: 10,
    output_dir: STAGING_DIR,
    log_file: LOG_PATH,
    mode: 'shadow-staging',
  }
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 })
  chmodSync(CONFIG_PATH, 0o600)
  createdConfig = true
}

const plistXml = buildPlist(process.execPath, SERVER_SCRIPT, SCRIPT_DIR, CONFIG_PATH, LOG_PATH)
writeFileSync(LOCAL_PLIST_PATH, plistXml, { encoding: 'utf8', mode: 0o644 })

if (installLaunchd) {
  mkdirSync(dirname(SYSTEM_PLIST_PATH), { recursive: true })
  writeFileSync(SYSTEM_PLIST_PATH, plistXml, { encoding: 'utf8', mode: 0o644 })
  const domain = `gui/${process.getuid()}`
  const service = `${domain}/${LAUNCHD_LABEL}`
  try {
    execFileSync('/bin/launchctl', ['bootout', service], { stdio: 'ignore' })
  } catch (_e) {
    // ignore if not previously loaded
  }
  execFileSync('/bin/launchctl', ['enable', service], { stdio: 'inherit' })
  execFileSync('/bin/launchctl', ['bootstrap', domain, SYSTEM_PLIST_PATH], { stdio: 'inherit' })
}

console.log(createdConfig ? '✅ 已生成全新影子接收配置（0600 权限）' : 'ℹ️ 已保留现有配置文件（未覆盖密钥）')
console.log(`- 配置文件：${CONFIG_PATH}`)
console.log(`- 影子目录：${config.output_dir}`)
console.log(`- 日志文件：${config.log_file}`)
console.log(`- 监听地址：http://${config.host}:${config.port}${config.ingest_path}`)
console.log(`- plist 模板：${LOCAL_PLIST_PATH}`)
if (installLaunchd) {
  console.log(`- launchd 服务已安装并启动：${LAUNCHD_LABEL}`)
} else {
  console.log('\n下一步：')
  console.log('1. 运行本地自测：node ingest/test-local.mjs')
  console.log('2. 安装并启动后台服务：node ingest/init.mjs --install-launchd')
  console.log(`3. 查看密钥（用于填入手机 Health Auto Export）：cat "${CONFIG_PATH}"`)
}
