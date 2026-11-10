# DeepSeek Harness (`.plugin-dev`) — 3B健康插件开发与使用说明

本目录用于存放基于 `/Users/brucechen/Documents/生活助手codex` 在 DeepSeek Harness (`dsh`) 上开发的原生扩展插件。当前已完成并交付 **`3B健康` (`@local/dsh-3b-health`)** 插件（`3B财务` 待后续想法成熟后在同一目录下扩展）。

---

## 1. 目录结构

```text
/Users/brucechen/Desktop/deepseek-harness/.plugin-dev/
├── README.md                    # 插件开发与架构总览说明（本文档）
└── dsh-3b-health/               # 3B健康 (@local/dsh-3b-health) 独立插件包
    ├── package.json             # DSH 插件包声明（含 dsh.bundle.patch 与 dsh.client）
    ├── cordis.patch.yml         # Cordis 插件装配补丁
    ├── index.js                 # Host 端服务：基于 Node 24 原生 node:sqlite 与 ctx.connection.fetch 提供 /api/3b-health/*
    ├── client.js                # Client 端 UI：注册左侧栏 sidebar.panellist 入口与右侧 main 主视图
    ├── icon.svg                 # 插件矢量图标（心率脉搏）
    ├── README.md                # 插件包独立说明
    └── locale/
        ├── zh.json              # 中文元数据
        └── en.json              # 英文元数据
```

---

## 2. 核心特性与设计说明

### 2.1 左侧栏入口与右侧三大板块
* **左侧栏入口 (`sidebar.panellist`)**：在 DSH 左侧导航栏显示 **“3B健康”** 图标与名称（`id: '3b-health'`）。
* **右侧主页面 (`main`)**：点击后在右侧主面板展示三大核心板块（已按要求精简移除“原始记录与收件箱”）：
  1. **健康仪表盘**：
     * **顶部四张核心卡片**：7 日运动汇总、可用睡眠平均时长、**饮食记录（可交互打卡）**、**精力自评（可交互打卡）**。
     * **六组独立健康趋势图**：支持从 44 项指标中自由选择 6 项，单图独立切换 `30天 / 90天 / 365天`，绘制每日柱状图、区间均值虚线与线性回归趋势线；每次修改指标或周期均通过后端持久化到活动数据目录的 `dsh-health-preferences.json`。
     * **健康阶段总结**：跟随 6 图所选指标，按 `30/90/365天` 统计有效日均值、覆盖天数与首末差，并支持一键跳往 AI 分析。
     * **近 7 日训练记录**：展示 `workouts` 训练次数、总时长、总消耗及近期明细表。
  2. **手机同步**：
     * 只读展示 DataCenter 的 iCloud 同步状态（最近扫描、最近成功导入、待处理文件、异常详情），支持手动点击 **“刷新状态（只读）”**；导入与摘要由 `local.datacenter.health` 每 5 分钟执行。
     * 展示 `health-exports.sqlite3`（JSON 增量库）与 `life.sqlite3`（Apple Health 历史 ZIP 主库）的归档文件数与去重记录数。
  3. **AI 健康分析（DSH 原生直连）**：
     * **完全摒弃外接 Codex CLI**：在本地 `~/Library/Application Support/ThreeBody/AgentAnalysis/job-<24hex>` 生成只读脱敏分析包（`context.md`、`summary.json`、`AGENTS.md`、`manifest.json`），默认自动附带近期饮食记录与精力自评摘要。
     * **一键在 DSH 会话中发起分析**：调用 DSH 原生 `ctx.uiWorkspace.startSession(undefined, { prompt, whenDraftExists: 'replace' })` 自动切回 DSH 对话主视图并填入完整分析提示词；分析完成后可在插件内直接读取 `outputs/report.md` 报告。

### 2.2 与已有网页端零冲突机制
* **不占用已有端口**：插件通过 DSH 内置的 `ctx.connection.fetch` 注册 `/api/3b-health/*` 路由，不绑定 `4312` 或 `4313` 端口，与原网页端常驻进程互不干扰。
* **数据库读写安全**：高频查询（仪表盘、同步状态、历史任务）全部采用 SQLite 只读连接（`readOnly: true`）或直接读取原子快照文件 `health-summary.json`。
* **活动数据目录**：`resolveStore()` 依次使用 `THREEBODY_DATA_ROOT`、DataCenter `center.json` 的 `root/data`、旧 codex 目录（仅未停写时）。2026-11-08 11:03 起活动库为 `/Volumes/DataDisk/DataCenter/data`；旧目录带 `.datacenter-retired` 标记，插件只在其上做一次性只读迁移，不再写入。
* **快照新鲜度与性能**：仪表盘只读 `health-export-sync.json`、`health-summary.json` 和插件小表，按状态文件的 `pending`/`snapshot_pending`/`snapshot_error` 及 `last_success` 与快照生成时间判断「有新导出未汇总」；同步页只读取 DataCenter 的 `health-export-sync.json`，**不写该状态文件**。导入统计来自 `files`/`workouts`/`imports` 小表（ZIP 事件数取 `imports.added` 累计），不扫描 2.69GB 的 `health_events`；统计缓存 60 秒，客户端另有 120 秒仪表盘缓存。

### 2.3 写入留痕机制（Provenance）
所有通过本插件触发的写操作均带有明确标识 **`通过 dsh 3B健康插件写入`**（`plugin_id: "@local/dsh-3b-health"`）：
1. **饮食记录与精力自评**：保存在 `life.sqlite3` 的 `health_daily_checkins` 表中，每条记录均包含 `source_plugin = '@local/dsh-3b-health'` 与 `source_label = '通过 dsh 3B健康插件写入'`。
2. **6 图趋势偏好配置**：保存在活动数据目录的 `dsh-health-preferences.json`，内含 `plugin_id` 与 `source_label` 字段。
3. **AI 健康分析任务包**：在 `manifest.json` 与 `context.md` 的分析要求末尾自动追加 `（任务来源：通过 dsh 3B健康插件写入）`。
4. **全局审计表与日志**：每次写入动作同步记录到活动 `life.sqlite3` 的 `dsh_plugin_traces` 表及活动数据目录的 `dsh-plugin-traces.jsonl` 文件，可在插件右上角点击 **“写入留痕”** 随时核对。首次切换到活动库时会从旧目录迁移既有偏好、留痕与打卡（旧库只读）。

---

## 3. 安装、启用与调试命令

在 `/Users/brucechen/Desktop/deepseek-harness` 根目录下可通过以下命令管理插件：

```bash
# 1. 从本地目录安装插件到当前 DSH profile
pnpm dsh plugin add /Users/brucechen/Desktop/deepseek-harness/.plugin-dev/dsh-3b-health

# 2. 启用插件
pnpm dsh plugin enable @local/dsh-3b-health

# 3. 查看已安装插件状态
pnpm dsh plugin list
```

若修改了 `.plugin-dev/dsh-3b-health` 下的代码，重新执行 `pnpm dsh plugin add /Users/brucechen/Desktop/deepseek-harness/.plugin-dev/dsh-3b-health`（或在 DSH「设置 → 插件」中重载）即可生效。
