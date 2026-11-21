# 健康数据 Webhook 接收服务（Cloudflare Tunnel + WAF 方案）

本目录为 `dsh-3b-health` 的独立配套工具，用于承接 iPhone **HealthDataExport** 通过 **Webhook（HTTP POST + Bearer Token）** 跨网推送的健康导出 JSON，并已作为主通道接入 DataCenter 双源扫描。

> **隔离原则**：本服务独立于 DeepSeek Harness 插件进程运行，仅写入本地私有收件箱 `inbox/`，**绝不反写** iCloud `Health Data Export` 目录，也不直接读写 SQLite 数据库或 `dsh-3b-health/runtime/`。

## 目录与文件说明

| 路径 | 说明 |
| :--- | :--- |
| `ingest/server.mjs` | 零外部依赖的本地 HTTP 接收服务（仅监听 `127.0.0.1:18765`） |
| `ingest/init.mjs` | 初始化脚本：生成密钥配置、`inbox/` 目录与 `launchd` 自启 plist |
| `~/Library/Application Support/ThreeBody/HealthIngest/config.json` | 运行时配置与密钥（`0600` 权限，不入 Git；`mode: "active-inbox"`） |
| `~/Library/Application Support/ThreeBody/HealthIngest/inbox/` | 正式本地收件箱（`0700` 权限，由 DataCenter `local.datacenter.health` 每 5 分钟扫描） |
| `~/Library/Application Support/ThreeBody/HealthIngest/staging/` | 历史影子测试期归档目录（不再写入） |
| `~/Library/Application Support/ThreeBody/HealthIngest/ingest.log` | JSON Lines 审计日志（不记录 Token 与健康数据正文） |

## 安全防护（五层）

1. **只写不读**：仅响应 `POST <ingest_path>`，成功只返回 `{"ok":true}`；所有 `GET`、错误路径或错误 Token 统一返回 `404`。
2. **边缘 + 本机双层鉴权**：
   - **Cloudflare 边缘拦截**：在 `shutiaojun.cn` 上配置免费 WAF Custom Rule（`block-non-health-webhook`），非 `POST`、路径不匹配或缺少合法 `Authorization: Bearer <token>` 的请求在 Cloudflare 边缘直接 `Block`，不触达本机。
   - **本机二次校验**：`server.mjs` 同时支持 `Authorization: Bearer <token>`（HealthDataExport Webhook 使用）和 `X-Health-Token`（手工测试兼容），均使用 `crypto.timingSafeEqual` 做常量时间比对。
3. **本机回环隔离**：仅绑定 `127.0.0.1:18765`，由 `cloudflared`（`http://127.0.0.1:18765`）主动出站隧道转发，不开放路由器或局域网端口。
4. **体积、格式与频率限制**：仅接受 `application/json`，单次上限 `20 MiB`，校验顶层健康 JSON 结构（兼容平铺 `{ metrics/workouts }` 与 `{ data: { metrics/workouts } }` 两种格式），单 IP 每分钟限流 10 次、全局 30 次。
5. **服务端命名与原子落盘**：忽略客户端文件名，统一生成 `RestExport_YYYY-MM-DD_HHMMSS_<12位sha256>.json`，写 `.tmp`（`0600`）后原子重命名，并按内容哈希自动去重。

## 当前部署与日常维护

### 本地服务管理（launchd）

```bash
cd /Users/brucechen/Desktop/deepseek-harness/.plugin-dev/dsh-3b-health

# 重新加载/重启服务（不覆盖 config.json 密钥）
node ingest/init.mjs --install-launchd

# 修改 config.json 后重启服务使其生效
launchctl kickstart -k "gui/$(id -u)/local.health-ingest"

# 查看监听状态与最近日志
lsof -iTCP:18765 -sTCP:LISTEN
tail -n 20 "$HOME/Library/Application Support/ThreeBody/HealthIngest/ingest.log"
ls -lh "$HOME/Library/Application Support/ThreeBody/HealthIngest/inbox"
```

### Cloudflare 侧配置摘要

- **DNS（`shutiaojun.cn`）**：原有 5 条 GitHub Pages 记录保持灰云（DNS Only）；Tunnel 子域名（`k9x2.shutiaojun.cn`）为橙云（Proxied）。
- **Tunnel**：`cloudflared` 以 macOS 系统 LaunchDaemon 运行（日志在 `/Library/Logs/com.cloudflare.cloudflared.err.log`），Public Hostname 转发 `k9x2.shutiaojun.cn/ingest/<随机串>` → **`HTTP`** `127.0.0.1:18765`（注意必须是 `HTTP` 而非 `HTTPS`）。
- **WAF 边缘规则**：`Security → WAF → Custom rules` 中的 `block-non-health-webhook` 拦截所有不满足 `POST` + 精确路径 + `Authorization: Bearer <token>` 的请求。

### iPhone HealthDataExport 配置

- **Export Options**：`JSON` / `Hourly` / `Webhook` / `Single File`
- **URL**：`https://k9x2.shutiaojun.cn/ingest/<随机串>`
- **Bearer token**：填入 `config.json` 中的 64 位 `token`（无需手动加 `Bearer ` 前缀）

## 双源接入状态与一键回滚

- **当前状态（2026-11-21 已切换）**：`HealthIngest` 已切换至 `inbox/`（`mode: "active-inbox"`），DataCenter（`scripts/sync_health_exports.py`）已支持同时扫描本地 `inbox/` 与原 iCloud `Health Data Export/`，并保留全部历史 `seen` 记录。观察 2～3 天稳定后，可在 iPhone 上关闭旧的 iCloud 自动化（历史文件无需删除）。
- **一键回滚**：停掉本机 `launchd` 服务即可切回纯 iCloud 链路（原有 iCloud 自动化与历史记录全程未动）：
  ```bash
  launchctl bootout "gui/$(id -u)/local.health-ingest"
  ```
