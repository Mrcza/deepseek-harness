# `/Volumes/DataDisk/DataCenter` 高频磁盘读写优化与本地化迁徙留档说明

- **执行日期**：2026-11-10
- **优化策略**：方案一（轻量集中方案：高频运行态文件迁入 `dsh-3b-health/runtime`，历史演练快照归档至 `生活助手codex/data/datacenter-cold-archive`）+ 内存缓存与无增量短路优化
- **核心目标**：消除外置磁盘 `/Volumes/DataDisk/DataCenter`（`/dev/disk5s2`，HFS+ 日志式文件系统）全天候高频无效读写与 `diskutil` 子进程派生，在保持核心账本与健康数据库、原始凭证证据链 100% 留存主数据盘的前提下，将高频状态/快照/锁文件集中迁移至 Mac mini 本地内置 SSD 的 `/Users/brucechen/Desktop/deepseek-harness/.plugin-dev/dsh-3b-health/runtime/`。

## 一、 问题根因诊断与实测基线

优化前通过 `iostat`、`lsof`、`launchctl print` 及数据库运行日志实测发现，`/Volumes/DataDisk` 长期处于 **44 TPS（历史均值）**、每秒 **1～94 TPS（底噪）** 及每隔数秒 **317～665 TPS（6.36～16.51 MB/s 峰值）** 的零休眠状态，主要由以下 5 项机制叠加造成：

| 序号 | 消耗源与所属模块 | 优化前行为与实测指标 | 造成的不必要磁盘消耗 |
| :--- | :--- | :--- | :--- |
| **1** | **财务 5 分钟定时扫描**<br>`local.datacenter.finance`<br>(`scripts/finance_import.py`) | 每 **300 秒** 启动一次。即便 iCloud 无新增账单，仍会对 80 个已导入文件重算 SHA256 并重写 `file_observations`，对 3 个未变化的格式异常文件反复执行解析/OCR，并在末尾无条件对 12.3 万行账本执行 `reconcile()` 与资产快照重算。实测单次耗时 **77～105 秒**（占全天总时长的 **25%～35%**）。 | 每 5 分钟产生持续近 2 分钟的高强度 SQLite WAL 读写（4.1 MB `-wal` 反复刷盘）。 |
| **2** | **DSH `3B健康` 插件轮询**<br>`@local/dsh-3b-health`<br>(`index.js` / `client.js`) | “手机同步”面板每 **15 秒** 轮询 `/api/3b-health/sync`（仪表盘加载时也调用），每次直接连接外置盘 `life.sqlite3`（2.50 GiB）执行 `SELECT count(*), max(substr(end,1,10)) FROM health_events` 及 `health-exports.sqlite3`（124 MiB）全表 `COUNT(*)`。 | 每 15 秒触发一次 2.5 GiB SQLite 全表扫描，造成周期性十余 MB/s 的突发读取峰值。 |
| **3** | **API 物理卷身份强校验**<br>`local.datacenter.service`<br>(`scripts/datacenter_storage.py`) | 端口 `4314` 每次处理 API 请求均执行 `store.check()`，同步调用 `/usr/sbin/diskutil info -plist /Volumes/DataDisk` 并重读 `.datacenter-id`。当前常驻进程已累计派生 **`forks = 8,170`** 次子进程。 | 每次前端轮询请求都触发进程派生、DiskArbitration 查询与外置盘元数据读取。 |
| **4** | **前端高频轮询与状态重写**<br>`serve_local.py` / `backup-settings.jsx`<br>`sync_health_exports.py` | 网页端两处组件每 **5 秒** 轮询 `/api/backups/status`（每次读取外置盘 3 个 `backup-*.json` 并遍历 `/Volumes`）；健康扫描每 **300 秒** 通过 `.pending` 临时文件重写 2 次 `health-export-sync.json`，并重算全部历史 `.zip`/`.json` 的 SHA256。 | 每 5 秒唤醒外置盘读取 JSON，每 5 分钟触发 HFS+ 日志写入并唤醒 macOS Spotlight (`mdworker`) 重索引。 |
| **5** | **历史演练快照堆积**<br>`/Volumes/DataDisk/DataCenter/data` | `data/` 及 `data/financial-ledger/` 下遗留了 **67 个** 10 月至 11 月初开发演练阶段的 `before-*.sqlite3`、`*-preview.sqlite3` 与版本升级备份库（合计约 **3.7 GiB**）。 | `backup_service.py` 执行 `PRIVATE.rglob('*.sqlite3')` 时每次都会递归扫描并复制这 67 个历史快照库（单次备份多产生约 11 GiB 读写）。 |

## 二、 文件迁徙清单与目录规划（轻量集中方案）

### 1. 高频运行态热文件目录（集中于 `dsh-3b-health/runtime`）
- **目标路径**：`/Users/brucechen/Desktop/deepseek-harness/.plugin-dev/dsh-3b-health/runtime/`（约 224 KB，权限 `0700` / `0600`）
- **迁徙方式**：保留外置盘原路径初始文件作为只读回退，由 `datacenter_storage.runtime_path()` 与 `dsh-3b-health/index.js` 将生产环境下的高频读写与文件锁操作实时路由至该本地 SSD 目录。由于 `dsh-3b-health/package.json` 声明了显式 `"files"` 白名单，`runtime/` 子目录不会被 `pnpm` 误打包进 `node_modules`。
- **包含文件（共 13 项）**：

| 相对路径（相对于 `runtime/`） | 文件类型与用途 | 迁往本地 SSD 的原因 |
| :--- | :--- | :--- |
| `health-export-sync.json` | 健康导出同步状态 JSON | 每 5 分钟被健康扫描重写 2 次，且被网页端与 DSH 插件高频读取 |
| `health-export-sync.lock` | 健康扫描排他锁 (`flock`) | 每 5 分钟健康扫描任务加锁/改权限，易唤醒外置盘 |
| `health-summary.json` | 健康仪表盘派生摘要快照 (180 KB) | 网页端 `/api/health`、AI 分析及 DSH 插件每次打开均需读取 |
| `backup-settings.json` | 自动备份计划配置 | 网页端备份状态轮询及后台每 60 秒备份调度线程持续读取 |
| `backup-status.json` | 最近一次备份状态报告 | 网页端备份状态轮询持续读取 |
| `backup-history.json` | 备份运行历史记录 | 网页端备份状态轮询持续读取 |
| `dsh-health-preferences.json` | DSH `3B健康` 插件 6 图趋势偏好 | 插件每次加载仪表盘读取、切换指标或周期时原子重写 |
| `dsh-plugin-traces.jsonl` | DSH `3B健康` 插件写入留痕日志 | 插件每次操作追加写入与留痕核对读取 |
| `.dsh-3b-health-migrated.json` | DSH `3B健康` 插件迁移完成标记 | 插件每次 API 请求均通过 `existsSync` 检查该文件 |
| `health-sync/last-attempt.json` | iPhone 快捷指令最近上传回执 | 手机同步页状态查询读取、每次快捷指令上传原子重写 |
| `financial-ledger/scan.lock` | 财务定时扫描排他锁 (`flock`) | 每 5 分钟财务扫描任务加锁/改权限 |
| `financial-ledger/ingestion.lock` | 财务写操作与扫描互斥/共享锁 | 每次财务扫描及账本命令执行均需 `open` + `flock` + `chmod` |
| `financial-ledger/serve.lock` | 服务单实例运行锁 (`flock`) | 常驻服务启动与 `ops_status` 状态检查高频探测 |

### 2. 历史开发快照与旧日志归档目录（从外置盘物理迁出）
- **目标路径**：`/Users/brucechen/Documents/生活助手codex/data/datacenter-cold-archive/`
- **迁徙方式**：按原相对目录结构完整移动（`shutil.move`）至本地归档目录，脱离 `/Volumes/DataDisk/DataCenter/data/`，同时避免大体积二进制文件污染 `dsh-3b-health` 插件目录。
- **迁出内容汇总（共 69 项文件/目录，释放外置盘约 3.7 GiB 冗余扫描体积）**：
  1. **顶层与旧版复核快照库（2 个文件）**：`financial-ledger-before-v4-20261019T153041.sqlite3`（68.6 MiB）、`finance-ledger/复核输入-2026-10-16.sqlite3`（6.4 MiB）。
  2. **`financial-ledger/` 下的开发演练与批次确认前快照库（58 个 `.sqlite3` 文件）**：`before-alias-food-card-2026-10-16.sqlite3` 至 `before-za-card-reversals-2026-10-17.sqlite3`（54 个批次前快照）及 `crosscheck-preview.sqlite3`、`icbc-preview.sqlite3`、`rules14-preview.sqlite3`、`development-baseline-before-semantic-fix.sqlite3`。
  3. **`financial-ledger/` 下的历史版本发布与基线备份目录（4 个目录，含 7 个 `.sqlite3` 快照）**：`acceptance/`、`golden-baseline-2026-10-18/`、`release-loan-v8-20261101/`、`releases/`。
  4. **历史静态运行日志（5 项文件/目录）**：`health-export-sync.log`、`health-export-sync-error.log`、`financial-ledger/scheduler.log`、`financial-ledger/scheduler-error.log`、`logs/`。

## 三、 代码级缓存与短路优化明细

1. **`scripts/datacenter_storage.py`（本地运行时路由 + 卷身份/标记/配置三级内存缓存）**
   - `LOCAL_RUNTIME_ROOT` 指向 `/Users/brucechen/Desktop/deepseek-harness/.plugin-dev/dsh-3b-health/runtime`，生产环境下自动将 13 项高频状态、快照与锁文件路由至该目录。
   - `volume_identity(mount)` 基于挂载点 `(mount_str, st_dev, st_ino)` 增加 **60 秒 TTL 内存缓存**；`Store.check()` 与 `load()` 基于 `lstat()` 元数据签名缓存文件内容，100 次连续校验耗时仅 **6.02 ms**。
2. **`scripts/finance_import.py`（5 分钟财务扫描“无变化零写盘”快速短路）**
   - 当每 5 分钟定时扫描启动时，先比对 iCloud 来源目录所有候选文件的 `(st_size, st_mtime)` 与 `file_observations` 表；若无新增或变更文件，**直接零写盘短路返回**。
3. **`scripts/sync_health_exports.py` & `scripts/health_summary.py`（健康扫描签名缓存与本地状态写入）**
   - 在 `health-export-sync.json` 中新增 `file_signatures`（记录 `[st_mtime_ns, st_size]`），跳过每 5 分钟对未变化历史 `.zip` / `.json` 导出文件的全量读取与 SHA256 重算。
4. **`scripts/backup_service.py` & `designs/life-dashboard/backup-settings.jsx` (`app.js`)（备份状态本地化与轮询降频）**
   - 备份状态 JSON 路由至本地 SSD，前端备份轮询从 **5 秒** 调整为 **30 秒**（后台标签页静默）。
5. **`.plugin-dev/dsh-3b-health/`（DSH `3B健康` 插件 SQLite 统计缓存与本地状态路由）**
   - `index.js`：状态、偏好与留痕文件直接读写插件目录下的 `./runtime/`；`readSyncStatus()` 新增基于数据库文件及 `-wal` 的 `(dev, ino, size, mtimeMs)` 签名内存缓存（`_sqliteStatsCache`），消除每 15 秒对 2.5 GiB `life.sqlite3` 的全表 `COUNT(*)` 扫描。
   - `client.js`：手机同步页轮询间隔从 15 秒放宽至 **60 秒**（后台标签页静默）。

## 四、 同步与回滚说明

### 1. 同步更新 `DataCenter` 运行脚本与重载插件
当 `LOCAL_RUNTIME_ROOT` 调整至 `dsh-3b-health/runtime` 后，在终端执行以下命令即可让 `DataCenter` 服务与 `dsh` 插件同步使用新路径：

```bash
cp /Users/brucechen/Documents/生活助手codex/scripts/datacenter_storage.py /Users/brucechen/Documents/DataCenter/scripts/datacenter_storage.py
launchctl kickstart -k gui/$(id -u)/local.datacenter.service
launchctl kickstart -k gui/$(id -u)/local.life-assistant.dashboard
cd /Users/brucechen/Desktop/deepseek-harness && pnpm dsh plugin --profile web add /Users/brucechen/Desktop/deepseek-harness/.plugin-dev/dsh-3b-health
```

### 2. 回滚方式（如需恢复原状）
- 高频状态文件：可随时将 `/Users/brucechen/Desktop/deepseek-harness/.plugin-dev/dsh-3b-health/runtime/` 下的最新 JSON 状态文件复制回 `/Volumes/DataDisk/DataCenter/data/`。
- 历史演练快照：全部保存在 `/Users/brucechen/Documents/生活助手codex/data/datacenter-cold-archive/`，结构与原 `data/` 完全一致，可随时按路径移回或转存至冷备份盘 `/Volumes/My Passport`。
