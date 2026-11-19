# 健康数据 REST 影子接收服务（Cloudflare Tunnel + WAF 方案）

本目录为 `dsh-3b-health` 的独立配套工具，用于承接 iPhone **HealthDataExport** 通过 **Webhook（HTTP POST + Bearer Token）** 跨网推送的健康导出 JSON。

> **隔离原则**：本服务独立于 DeepSeek Harness 插件进程运行，测试期默认只写入独立影子目录，**绝不触碰** iCloud `Health Data Export` 目录、DataCenter SQLite 数据库或 `dsh-3b-health/runtime/` 状态文件。

## 目录与文件说明

| 路径 | 说明 |
| :--- | :--- |
| `ingest/server.mjs` | 零外部依赖的本地 HTTP 接收服务（仅监听 `127.0.0.1:18765`） |
| `ingest/init.mjs` | 初始化脚本：生成密钥配置、`staging/` 目录与 `launchd` 自启 plist |
| `~/Library/Application Support/ThreeBody/HealthIngest/config.json` | 运行时配置与密钥（`0600` 权限，不入 Git） |
| `~/Library/Application Support/ThreeBody/HealthIngest/staging/` | 测试期影子落盘目录（`0700` 权限） |
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

# 查看监听状态与最近日志
lsof -iTCP:18765 -sTCP:LISTEN
tail -n 20 "$HOME/Library/Application Support/ThreeBody/HealthIngest/ingest.log"
ls -lh "$HOME/Library/Application Support/ThreeBody/HealthIngest/staging"
```

### Cloudflare 侧配置摘要

- **DNS（`shutiaojun.cn`）**：原有 5 条 GitHub Pages 记录保持灰云（DNS Only）；Tunnel 子域名（`k9x2.shutiaojun.cn`）为橙云（Proxied）。
- **Tunnel**：`cloudflared` 以 macOS 系统 LaunchDaemon 运行（日志在 `/Library/Logs/com.cloudflare.cloudflared.err.log`），Public Hostname 转发 `k9x2.shutiaojun.cn/ingest/<随机串>` → **`HTTP`** `127.0.0.1:18765`（注意必须是 `HTTP` 而非 `HTTPS`）。
- **WAF 边缘规则**：`Security → WAF → Custom rules` 中的 `block-non-health-webhook` 拦截所有不满足 `POST` + 精确路径 + `Authorization: Bearer <token>` 的请求。

### iPhone HealthDataExport 配置（双轨并行测试期）

保留原有 iCloud 自动化不动，新增独立 Webhook 自动化：
- **Export Options**：`JSON` / `Hourly` / `Webhook` / `Single File`
- **URL**：`https://k9x2.shutiaojun.cn/ingest/<随机串>`
- **Bearer token**：填入 `config.json` 中的 64 位 `token`（无需手动加 `Bearer ` 前缀）

## 7 天验收与阶段 4 切换

**切换前验收清单（全部通过再进入阶段 4）**：
- [ ] **格式兼容**：比对同一天 `staging/RestExport_*.json` 与 iCloud `Automation______*.json` 的顶层结构、指标名、单位和 workouts，并用临时副本库验证 DataCenter 可正常解析。
- [ ] **跨网送达率**：连续 7 天外网 5G / 非家庭 Wi-Fi 环境下均按时送达（如遇代理 TUN 下 QUIC 偶发断连，可为 `cloudflared` 增加 `--protocol http2`）。
- [ ] **日志审计**：检查 `ingest.log` 与 Cloudflare Security Events，确认无异常写入。

**阶段 4 切换与一键回滚**：
- **切换**：不要将 `output_dir` 指向 iCloud 目录（避免 macOS 反向上传造成重复）。建议在 `local.datacenter.health` 中增加纯本地收件箱目录（或将 `staging/` 切为 `inbox/` 并由 DataCenter 扫描），双通道观察 3～7 天后再关闭 iPhone 上旧的 iCloud 自动化。
- **一键回滚**：停掉本机 `launchd` 服务并在 Cloudflare 禁用对应 WAF/Tunnel 路由，旧 iCloud 链路全程未动，立即恢复：
  ```bash
  launchctl bootout "gui/$(id -u)/local.health-ingest"
  ```
