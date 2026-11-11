# @local/dsh-3b-health (3B健康)

DeepSeek Harness (`dsh`) 原生健康管理与 AI 分析插件，读取 DataCenter 活动健康数据目录（`~/Library/Application Support/ThreeBody/DataCenter/center.json` 的 `root/data`，当前为 `/Volumes/DataDisk/DataCenter/data`）。

## 功能概览
- **左侧栏入口**：注册 `sidebar.panellist` (`id: '3b-health'`)，显示“3B健康”。
- **健康仪表盘**：7 日运动与睡眠卡片、可交互饮食记录与精力自评打卡、44 项指标 × 30/90/365 天六图趋势（后端持久化偏好）、健康阶段总结、近 7 日训练明细。
- **健康关注侧栏**（仪表盘右侧）：生理基准（出生年份/性别/身高，保存于偏好并写入留痕）、六项二次派生指标（校准 BMI、脂肪量、FFMI、FMI、去脂基础代谢、步行心率负荷差）、五维 PAS 关注度 Top 6（分域保底 + 全局补位）、身体类型九宫格与近 15 天渐变轨迹（缺失日线性估算）、向健康改进的目标清单。全部数值由实时快照按固定公式计算，不写死。
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

DataCenter 的本地化迁移把 `health-summary.json` 与 `health-export-sync.json` 写到插件 `runtime/` 目录。**插件只读这两个文件，绝不写回**；store 下的同名 JSON 是历史遗留副本，仅在 runtime 缺失时作为兜底。偏好（六图配置 + `profile` 生理基准）与 JSONL 留痕写入 runtime；缺失时从 store 复制一次。保存生理基准同样走 `POST /api/3b-health/preferences`，留痕摘要追加 `；生理基准：<年份>年(<年龄>岁)/<性别>/<身高>cm`。打卡与审计表仍写入活动 `life.sqlite3`。导出库统计按最近一次成功导入（`last_success`）缓存到 `runtime/dsh-health-export-stats.json`，新导入后自动重算。

## 每日侧栏推送（可选）

`scripts/focus-report.mjs` 从 `client.js` 的 `focus-engine` 区域提取关注引擎，用 `runtime/health-summary.json` 与 `runtime/dsh-health-preferences.json` 计算当日侧栏，并通过 DSH-IM 主动投递接口发送到企业微信等渠道。

```sh
node scripts/focus-report.mjs                 # 只打印消息，不发送
node scripts/focus-report.mjs --send          # 投递（需要已配置的投递目标）
```

投递参数保存在 `runtime/dsh-im-target.json`：`{"botId":"wecom_...","targetId":"..."}`，也可用 `--target=`、`--bot=`、`--base=` 或 `DSH_IM_TARGET_ID`、`DSH_WEB_BASE` 覆盖。DSH 定时任务每天 10:00 在新会话中执行该脚本并回报结果；DSH 未运行时投递顺延到下次启动。健康快照与偏好只读，发送仅在显式 `--send` 时发生。

### 图片版（JPEG）

`scripts/focus-report-image.mjs` 用同一份侧栏模型渲染一张 720px 宽（2x 输出 1440px）的 JPEG：

```sh
node scripts/focus-report-image.mjs          # 生成 runtime/focus-report-YYYY-MM-DD.jpg
node scripts/focus-report-image.mjs --send   # 投递到企业微信群机器人
```

渲染走 Playwright + 本机 Chromium（`DSH_PLAYWRIGHT_PATH`、`DSH_CHROMIUM_BIN` 可覆盖）。**DSH-IM 主动投递接口只接受文本**，图片因此直接走渠道自身的发送接口：

- **Telegram（默认）**：`runtime/dsh-delivery.json` 写 `{"channel":"telegram","botId":"telegram_...","targetId":"tgt_..."}`；脚本在发送时从 `~/.dsh/integrations/dsh-telegram` 解析 bot token 与目标 chatId，不把凭据写入插件。`mode: "document"` 用 `report-template.html`（1440×3586，保留原分辨率）；`mode: "photo"` 用 `report-template-photo.html`（1440×2512，长边在 Telegram 2560 上限内，不会被压到 1028 宽，正文更大更紧凑）。
- **企业微信群机器人**：`runtime/wecom-webhook.json` 写 `{"url":"https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=..."}`；图片上限 2MB，`--with-text` 追加一行摘要。

默认保留最近 30 张（`--keep=30`），当前样张约 300KB。

## 性能

仪表盘请求只读 `health-export-sync.json`（约 4KB）、`health-summary.json` 与插件自有小表，不再扫描 2.69GB 的 `life.sqlite3.health_events`。导入统计来自 `files`/`workouts` 与 `imports` 小表（ZIP 事件总数取 `imports.added` 累计）；导出库统计按导入修订持久化缓存，新导入前不再打开 129MB 的导出库。打开面板的首屏数据通常在 300ms 内返回，重复打开直接使用 120 秒内存缓存并后台校验。

## 界面与主题

- 视觉语言为归藏杂志风：`client.js` 末尾的「杂志风皮肤」集中定义纸色、墨色、锚点色与衬线字族（墨水经典 / 午夜墨两套），其余控件仍复用 DSH 语义令牌。
- 明暗主题跟随 DSH 的 light/dark 切换：浅色是暖纸墨字，深色是午夜墨配金色锚点；不依赖系统 `prefers-color-scheme`。九宫格区域色通过 `--3b-zone-*` 变量在深色下自动换成高亮变体。
- 六图柱状图填充使用 PANTONE 2190 C 的 sRGB 近似 `#56B7E6`（`--3b-chart-bar`），明暗主题同色。
- 页面宽 1320px：≥1100px 时仪表盘为「主列 + 368px 关注侧栏」双栏，**两列各自独立滚动**——页头与提示固定，滚轮只作用于指针所在的一列；窄屏回落单列整页滚动。顶部预留 `--dsh-frame-top-clearance`。只改展示层时，刷新页面或在「设置 → 插件」重载即可生效。
