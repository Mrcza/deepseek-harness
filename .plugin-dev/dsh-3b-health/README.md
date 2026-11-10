# @local/dsh-3b-health (3B健康)

DeepSeek Harness (`dsh`) 原生健康管理与 AI 分析插件，读取 DataCenter 活动健康数据目录（`~/Library/Application Support/ThreeBody/DataCenter/center.json` 的 `root/data`，当前为 `/Volumes/DataDisk/DataCenter/data`）。

## 功能概览
- **左侧栏入口**：注册 `sidebar.panellist` (`id: '3b-health'`)，显示“3B健康”。
- **健康仪表盘**：7 日运动与睡眠卡片、可交互饮食记录与精力自评打卡、44 项指标 × 30/90/365 天六图趋势（后端持久化偏好）、健康阶段总结、近 7 日训练明细。
- **手机同步**：只读展示 DataCenter 的 iCloud 健康导出同步状态与 SQLite 主库/增量库统计；导入与摘要由 `local.datacenter.health` 每 5 分钟执行。
- **AI 健康分析**：一键生成只读脱敏分析数据包并直接跳回 DSH 会话窗口填入提示词发起分析，支持直接读取 `outputs/report.md`。
- **写入留痕**：所有写入操作均标记 `通过 dsh 3B健康插件写入`，记录于活动 `life.sqlite3` (`dsh_plugin_traces` / `health_daily_checkins`) 与插件 `runtime/` 目录的 `dsh-plugin-traces.jsonl`。

## 数据源解析

`index.js` 的 `resolveStore()` 按以下顺序解析数据目录：

1. 环境变量 `THREEBODY_DATA_ROOT`（显式覆盖，便于测试）；
2. `~/Library/Application Support/ThreeBody/DataCenter/center.json` 的 `root/data`（当前活动库）；
3. 旧目录 `~/Documents/生活助手codex/data/private`（仅在未出现 `.datacenter-retired` 时可用）。

已配置但不可用的数据目录（数据盘未挂载、配置损坏）会显式报错，不回退到已停写的旧目录。首次读取活动库时，插件会把旧目录里的偏好、留痕与打卡一次性迁移到活动库（旧库只读，迁移失败会在仪表盘提示）。

## 数据流

```text
iCloud Health Data Export/*.json
  → local.datacenter.health（每 5 分钟）→ <store>/health-exports.sqlite3
  → health_summary.generate() → <store>/health-summary.json
  → 本插件只读 → 六图 / 七日卡 / 阶段总结 / AI 分析包
```

手动触发一次导入与摘要（该任务归 DataCenter 所有）：

```sh
cd /Users/brucechen/Documents/DataCenter
.venv/bin/python -B scripts/datacenter_jobs.py --config "$HOME/Library/Application Support/ThreeBody/DataCenter/center.json" health
```

## 快照新鲜度

仪表盘显示 `资料截至`、`快照生成` 与数据目录；按 DataCenter 同步状态文件的 `pending`、`snapshot_pending`、`snapshot_error`，以及 `last_success` 晚于快照生成时间判断是否提示「有新导出未汇总」。最新资料日可能因导出截止时间而滞后于当天，图表只按有记录的数据点绘制，缺失不补零。

## 本地 runtime 副本

DataCenter 数据盘在外置卷上；`health-summary.json` 与 `health-export-sync.json` 会在插件 `runtime/` 目录保留只读副本，源文件更新时自动刷新。偏好与 JSONL 留痕写入该 runtime 目录；打卡与审计表仍写入活动 `life.sqlite3`。导出库统计按最近一次成功导入（`last_success`）缓存到 `runtime/dsh-health-export-stats.json`，新导入后自动重算。

## 性能

仪表盘请求只读 `health-export-sync.json`（约 4KB）、`health-summary.json` 与插件自有小表，不再扫描 2.69GB 的 `life.sqlite3.health_events`。导入统计来自 `files`/`workouts` 与 `imports` 小表（ZIP 事件总数取 `imports.added` 累计）；导出库统计按导入修订持久化缓存，新导入前不再打开 129MB 的导出库。打开面板的首屏数据通常在 300ms 内返回，重复打开直接使用 120 秒内存缓存并后台校验。

## 界面与主题

- 视觉语言为归藏杂志风：`client.js` 末尾的「杂志风皮肤」集中定义纸色、墨色、锚点色与衬线字族（墨水经典 / 午夜墨两套），其余控件仍复用 DSH 语义令牌。
- 明暗主题跟随 DSH 的 light/dark 切换：浅色是暖纸墨字，深色是午夜墨配金色锚点；不依赖系统 `prefers-color-scheme`。
- 六图柱状图填充使用 PANTONE 2190 C 的 sRGB 近似 `#56B7E6`（`--3b-chart-bar`），明暗主题同色。
- 页面宽 960px，顶部预留 `--dsh-frame-top-clearance`；只改展示层时，刷新页面或在「设置 → 插件」重载即可生效。
