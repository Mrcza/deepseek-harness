/**
 * Browser client module of @local/dsh-3b-health.
 * Registers:
 *   - Left sidebar entry (`sidebar.panellist`, id: '3b-health', label: '3B健康')
 *   - Right main view (`main`, key: '3b-health')
 * Features:
 *   1. 健康仪表盘: 4 core cards (with interactive 饮食记录 & 精力自评 check-ins),
 *      6 customizable trend charts (43 metrics × 30/90/365d persisted on backend),
 *      stage summary, and 7-day workouts.
 *   2. 健康关注侧栏: 生理基准（出生年份/性别/身高，持久化并留痕）、六项二次派生指标、
 *      五维 PAS 关注度 Top 6、身体类型九宫格近 15 天渐变轨迹、向健康改进的目标清单。
 *   3. 手机同步: iCloud folder sync status, manual check trigger, Health JSON & ZIP DB stats.
 *   4. AI 健康分析: Native DSH analysis package builder + one-click jump into DSH session.
 *   5. 写入留痕: Audit drawer viewing all records written via `@local/dsh-3b-health`.
 */
window.__ModuleLoader__.load({
  id: '@local/dsh-3b-health',
  factory(require) {
    const React = require('react')
    const { useState, useEffect, useLayoutEffect, useCallback, useMemo, useRef } = React
    const ReactDOM = require('react-dom')
    const h = React.createElement

    const STYLE_ID = 'dsh-3b-health-styles'
    /** Last dashboard response, reused for instant re-opens while revalidating. */
    let dashboardCache = null
    const DASHBOARD_CACHE_TTL_MS = 120000
    const PERIOD_OPTIONS = [30, 90, 365]
    const DIET_MEALS = ['早餐', '午餐', '晚餐', '加餐']
    const DIET_TAGS = ['高蛋白', '控糖', '清淡', '蔬菜充足', '饮水达标', '粗粮为主', '外食', '夜宵', '高油盐']
    const ENERGY_TAGS = ['精力充沛', '专注高效', '状态平稳', '运动后轻松', '午后困倦', '早起疲惫', '压力偏大', '睡眠欠佳']

    const SYNC_PROBLEM_LABELS = {
      'waiting-download': '尚未从 iCloud 下载完成，将自动重试',
      'materialization-timeout': '连续多次等待下载未完成，请检查 iCloud 下载状态',
      'invalid-json': '文件 JSON 不完整，可能是导出中断；原件已保留',
      'invalid-export': '导出内容不符合格式要求',
      'storage-error': '本地保存失败',
      'read-error': '读取导出文件失败',
      'import-error': '导入失败',
    }

    const AI_GOAL_TEMPLATES = [
      {
        label: '综合睡眠、运动与精力评估',
        text: '根据所选期间和指标说明睡眠、运动与静息心率的变化与数据缺口，结合近期饮食与精力自评区分事实和推测，提出可供本人考虑的下一步；不作诊断。',
      },
      {
        label: '体重、体脂与代谢趋势',
        text: '重点分析近期体重、体脂率、去脂体重与活动能量/饮食记录的联动变化，指出有效记录覆盖度与变化趋势，给出温和可持续的习惯建议。',
      },
      {
        label: '心肺恢复与训练负荷核对',
        text: '结合静息心率、心率变异性（HRV）、最大摄氧量与近7日训练记录，评估当前运动负荷与身体恢复状态，标出缺失数据日。',
      },
    ]

    function injectStyles() {
      if (typeof document === 'undefined') return
      const css = `
        /* 3B健康 · 归藏瑞士风落在 DSH 设计令牌上：单一锚点色、细线网格、等宽数字。 */
        .dsh-3b-health-root {
          position: relative;
          --3b-page-max: 1320px;
          --3b-ink: var(--dsw-alias-label-primary);
          --3b-ink-2: var(--dsw-alias-label-secondary);
          --3b-ink-3: var(--dsw-alias-label-tertiary);
          --3b-ink-4: var(--dsw-alias-label-caption);
          --3b-surface: var(--dsw-alias-settings-card-fill);
          --3b-stroke: var(--dsw-alias-settings-card-stroke);
          --3b-accent: var(--dsw-alias-state-business-primary);
          --3b-rule: var(--dsw-alias-border-l2);
          box-sizing: border-box;
          height: 100%;
          width: 100%;
          overflow-x: hidden;
          overflow-y: auto;
          padding: calc(28px + var(--dsh-frame-top-clearance, 0px)) clamp(20px, 4vw, 48px) 48px;
          background: var(--dsw-alias-bg-base);
          color: var(--3b-ink);
          font-family: var(--dsw-font-family);
          font-size: 13px;
          line-height: 20px;
          scrollbar-color: var(--dsw-alias-scrollbar-bg-l1) transparent;
        }
        .dsh-3b-health-container {
          max-width: var(--3b-page-max);
          margin: 0 auto;
          display: flex;
          flex-direction: column;
          gap: 32px;
        }
        .dsh-3b-section {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        /* 页头：标题与操作同排，元信息第二行，页签整宽第三行 */
        .dsh-3b-topbar {
          display: flex;
          flex-wrap: wrap;
          align-items: flex-start;
          justify-content: space-between;
          gap: 16px 24px;
        }
        .dsh-3b-brand {
          order: 1;
          flex: 1 1 320px;
          min-width: 0;
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .dsh-3b-brand-row {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 8px;
        }
        .dsh-3b-title {
          margin: 0;
          font-size: 20px;
          line-height: 28px;
          font-weight: 500;
        }
        .dsh-3b-subtitle {
          margin: 0;
          font-size: 13px;
          line-height: 20px;
          color: var(--3b-ink-2);
        }
        .dsh-3b-path {
          margin: 0;
          font-family: var(--ds-font-family-code);
          font-size: 11px;
          line-height: 16px;
          color: var(--3b-ink-4);
          overflow-wrap: anywhere;
        }
        .dsh-3b-actions {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 8px;
        }
        .dsh-3b-topbar > .dsh-3b-actions {
          order: 2;
        }
        .dsh-3b-tab-row {
          order: 3;
          flex: 1 1 100%;
          display: flex;
          min-width: 0;
        }
        .dsh-3b-nav {
          display: flex;
          align-items: center;
          width: fit-content;
          max-width: 100%;
          padding: 4px;
          box-sizing: border-box;
          border-radius: var(--dsw-radius-lg);
          background: var(--dsw-alias-bg-module-platform);
          overflow-x: auto;
          scrollbar-width: none;
        }
        .dsh-3b-nav::-webkit-scrollbar {
          display: none;
        }
        .dsh-3b-tab {
          height: 34px;
          padding: 0 12px;
          border: none;
          border-radius: var(--dsw-radius-md);
          background: transparent;
          color: var(--3b-ink-2);
          font-family: inherit;
          font-size: 14px;
          line-height: 20px;
          font-weight: 400;
          white-space: nowrap;
          cursor: pointer;
          transition: color 180ms var(--ds-ease-in-out);
        }
        .dsh-3b-tab.active {
          background: var(--dsw-alias-bg-layer-3);
          color: var(--3b-ink);
          font-weight: 500;
          box-shadow: inset 0 0 0 0.5px var(--dsw-alias-border-l3);
        }
        @media (hover: hover) {
          .dsh-3b-tab:hover {
            color: var(--3b-ink);
          }
        }

        /* 徽章与提示条：一个 accent + 语义色只做状态 */
        .dsh-3b-badge {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          height: 20px;
          padding: 0 8px;
          box-sizing: border-box;
          border: 0.5px solid var(--dsw-alias-border-l3);
          border-radius: 999px;
          corner-shape: round;
          background: var(--dsw-alias-bg-module-platform);
          color: var(--3b-ink-2);
          font-size: 11px;
          line-height: 14px;
          font-weight: 500;
          white-space: nowrap;
        }
        .dsh-3b-badge.accent {
          background: color-mix(in srgb, var(--3b-accent) 10%, transparent);
          border-color: color-mix(in srgb, var(--3b-accent) 35%, transparent);
          color: var(--3b-accent);
        }
        .dsh-3b-badge.success {
          background: var(--dsw-alias-state-success-tertiary);
          border-color: color-mix(in srgb, var(--dsw-alias-state-success-primary) 35%, transparent);
          color: var(--3b-ink);
        }
        .dsh-3b-badge.warn {
          background: var(--dsw-alias-state-warn-tertiary);
          border-color: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 45%, transparent);
          color: var(--3b-ink);
        }
        .dsh-3b-notice,
        .dsh-3b-success {
          display: flex;
          align-items: flex-start;
          gap: 8px;
          padding: 10px 14px;
          box-sizing: border-box;
          border: 0.5px solid var(--dsw-alias-border-l3);
          border-left-width: 2px;
          border-radius: var(--dsw-radius-md);
          background: var(--dsw-alias-bg-module-platform);
          color: var(--3b-ink);
          font-size: 12px;
          line-height: 18px;
        }
        .dsh-3b-notice {
          border-left-color: var(--dsw-alias-state-warn-primary);
        }
        .dsh-3b-notice.error {
          border-left-color: var(--dsw-alias-state-error-primary);
        }
        .dsh-3b-notice.row {
          align-items: center;
          justify-content: space-between;
          flex-wrap: wrap;
        }
        .dsh-3b-success {
          border-left-color: var(--dsw-alias-state-success-primary);
        }
        .dsh-3b-dot {
          flex: none;
          display: inline-block;
          width: 6px;
          height: 6px;
          border-radius: 50%;
          corner-shape: round;
          background: var(--dsw-alias-state-success-primary);
        }
        .dsh-3b-dot.warn {
          background: var(--dsw-alias-state-warn-primary);
        }
        .dsh-3b-dot.error {
          background: var(--dsw-alias-state-error-primary);
        }
        .dsh-3b-warn {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          color: var(--3b-ink);
        }

        /* 卡片与按钮 */
        .dsh-3b-card {
          box-sizing: border-box;
          display: flex;
          flex-direction: column;
          gap: 12px;
          padding: 20px;
          border: 0.5px solid var(--3b-stroke);
          border-radius: var(--dsw-radius-xl);
          background: var(--3b-surface);
          color: var(--3b-ink);
          font-family: inherit;
          text-align: left;
        }
        button.dsh-3b-card {
          cursor: pointer;
        }
        .dsh-3b-card.interactive {
          transition: background-color 120ms var(--ds-ease-in-out);
        }
        @media (hover: hover) {
          .dsh-3b-card.interactive:hover {
            background: color-mix(in srgb, var(--3b-accent) 5%, var(--3b-surface));
          }
        }
        .dsh-3b-card.interactive:active {
          background: color-mix(in srgb, var(--3b-accent) 9%, var(--3b-surface));
        }
        .dsh-3b-btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 4px;
          height: 28px;
          padding: 0 10px;
          box-sizing: border-box;
          border: none;
          border-radius: var(--dsw-radius-sm);
          box-shadow: inset 0 0 0 0.5px var(--dsw-alias-border-l3);
          background: transparent;
          color: var(--3b-ink);
          font-family: inherit;
          font-size: 12px;
          line-height: 18px;
          font-weight: 500;
          white-space: nowrap;
          cursor: pointer;
          transition: background-color 120ms var(--ds-ease-in-out);
        }
        .dsh-3b-btn:disabled {
          opacity: 0.4;
          cursor: not-allowed;
        }
        .dsh-3b-btn.primary {
          box-shadow: none;
          background: var(--dsw-alias-button-primary-fill);
          color: var(--dsw-alias-label-primary-foreground);
        }
        .dsh-3b-btn.ghost {
          box-shadow: none;
          color: var(--3b-ink-2);
        }
        .dsh-3b-btn.danger {
          box-shadow: none;
          color: var(--dsw-alias-state-error-primary);
        }
        .dsh-3b-btn.tiny {
          height: 24px;
          padding: 0 8px;
          border-radius: var(--dsw-radius-xs);
          font-size: 11px;
          line-height: 14px;
        }
        @media (hover: hover) {
          .dsh-3b-btn:hover:not(:disabled) {
            background: var(--dsw-alias-interactive-bg-hover);
          }
          .dsh-3b-btn.primary:hover:not(:disabled) {
            background: var(--dsw-alias-button-primary-hover);
          }
          .dsh-3b-btn.danger:hover:not(:disabled) {
            background: var(--dsw-alias-interactive-bg-hover-danger);
          }
        }
        .dsh-3b-btn:active:not(:disabled) {
          background: var(--dsw-alias-interactive-bg-active);
        }

        /* 区块标题：编号 + 标题基线对齐 */
        .dsh-3b-section-head {
          display: flex;
          flex-wrap: wrap;
          align-items: flex-start;
          justify-content: space-between;
          gap: 12px 16px;
        }
        .dsh-3b-section-head > div {
          min-width: 0;
        }
        .dsh-3b-section-head h2 {
          display: flex;
          align-items: baseline;
          gap: 8px;
          margin: 0;
          font-size: 16px;
          line-height: 24px;
          font-weight: 500;
        }
        .dsh-3b-section-index {
          font-family: var(--ds-font-family-code);
          font-size: 11px;
          line-height: 14px;
          font-weight: 400;
          font-variant-numeric: tabular-nums;
          color: var(--3b-ink-4);
        }
        .dsh-3b-section-head .dsh-3b-subtitle {
          margin-top: 4px;
          max-width: 62ch;
        }

        /* 核心指标 */
        .dsh-3b-metrics-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 16px;
        }
        @media (min-width: 900px) {
          .dsh-3b-metrics-grid {
            grid-template-columns: repeat(4, minmax(0, 1fr));
          }
        }
        .dsh-3b-kpi {
          min-height: 176px;
        }
        .dsh-3b-metric-head {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 8px;
          min-height: 36px;
          font-size: 12px;
          line-height: 18px;
          color: var(--3b-ink-2);
        }
        .dsh-3b-metric-val {
          display: flex;
          flex-wrap: wrap;
          align-items: baseline;
          gap: 2px 6px;
          margin: 4px 0 0;
          color: var(--3b-ink);
        }
        .dsh-3b-metric-val strong {
          font-size: 24px;
          line-height: 32px;
          font-weight: 400;
          font-variant-numeric: tabular-nums;
          white-space: nowrap;
        }
        .dsh-3b-metric-val span {
          font-size: 13px;
          line-height: 20px;
          color: var(--3b-ink-2);
        }
        .dsh-3b-metric-note {
          margin: 0;
          font-size: 12px;
          line-height: 18px;
          color: var(--3b-ink-3);
        }
        .dsh-3b-kpi .dsh-3b-metric-note {
          margin-top: auto;
        }

        /* 六图 */
        .dsh-3b-trends-grid {
          display: grid;
          grid-template-columns: 1fr;
          gap: 16px;
        }
        @media (min-width: 840px) {
          .dsh-3b-trends-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
        }
        .dsh-3b-chart-controls {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 8px;
          width: 100%;
        }
        .dsh-3b-chart-controls .dsh-3b-select {
          flex: 1 1 180px;
        }
        .dsh-3b-select,
        .dsh-3b-input,
        .dsh-3b-textarea {
          box-sizing: border-box;
          background: var(--dsw-specific-selector);
          color: var(--3b-ink);
          border: 0.5px solid var(--dsw-alias-border-l3);
          border-radius: var(--dsw-radius-md);
          padding: 0 10px;
          font-family: inherit;
          font-size: 13px;
          line-height: 20px;
        }
        .dsh-3b-select,
        .dsh-3b-input {
          height: 32px;
        }
        .dsh-3b-select {
          min-width: 0;
          cursor: pointer;
        }
        .dsh-3b-textarea {
          width: 100%;
          min-height: 64px;
          padding: 8px 12px;
          resize: vertical;
        }
        .dsh-3b-seg {
          display: inline-flex;
          flex: none;
          padding: 4px;
          box-sizing: border-box;
          border-radius: var(--dsw-radius-lg);
          background: var(--dsw-alias-bg-module-platform);
        }
        .dsh-3b-seg button {
          height: 26px;
          padding: 0 8px;
          border: none;
          border-radius: var(--dsw-radius-sm);
          background: transparent;
          color: var(--3b-ink-2);
          font-family: inherit;
          font-size: 12px;
          line-height: 18px;
          font-weight: 400;
          font-variant-numeric: tabular-nums;
          cursor: pointer;
        }
        .dsh-3b-seg button[aria-pressed='true'] {
          background: var(--dsw-alias-bg-layer-3);
          box-shadow: inset 0 0 0 0.5px var(--dsw-alias-border-l3);
          color: var(--3b-ink);
          font-weight: 500;
        }
        .dsh-3b-plot-wrap {
          display: grid;
          grid-template-columns: 44px minmax(0, 1fr);
          gap: 8px;
          align-items: stretch;
          height: 160px;
          margin-top: 4px;
        }
        .dsh-3b-yaxis {
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          padding: 2px 0;
          font-size: 11px;
          line-height: 14px;
          font-variant-numeric: tabular-nums;
          color: var(--3b-ink-4);
          text-align: right;
        }
        .dsh-3b-bars {
          position: relative;
          display: grid;
          align-items: end;
          height: 100%;
          box-sizing: border-box;
          padding: 6px 6px 0;
          border-radius: var(--dsw-radius-md);
          background: var(--dsw-alias-bg-module-platform);
          overflow: hidden;
        }
        .dsh-3b-gridline {
          position: absolute;
          left: 6px;
          right: 6px;
          height: 0;
          border-top: 0.5px solid var(--3b-rule);
          pointer-events: none;
          z-index: 0;
        }
        .dsh-3b-gridline-1 {
          top: 33.333%;
        }
        .dsh-3b-gridline-2 {
          top: 66.666%;
        }
        .dsh-3b-bar-slot {
          position: relative;
          z-index: 1;
          height: 100%;
          display: flex;
          align-items: flex-end;
        }
        .dsh-3b-bar {
          width: 100%;
          background: color-mix(in srgb, var(--3b-accent) 36%, transparent);
          border-radius: 2px 2px 0 0;
        }
        @media (hover: hover) {
          .dsh-3b-bar:hover {
            background: color-mix(in srgb, var(--3b-accent) 68%, transparent);
          }
        }
        .dsh-3b-bar.empty {
          height: 0 !important;
        }
        .dsh-3b-stat-svg {
          position: absolute;
          inset: 6px 6px 0 6px;
          width: calc(100% - 12px);
          height: calc(100% - 6px);
          pointer-events: none;
          overflow: visible;
        }
        .dsh-3b-mean-line {
          stroke: var(--3b-ink-4);
          stroke-width: 1;
          stroke-dasharray: 4 3;
          vector-effect: non-scaling-stroke;
        }
        .dsh-3b-reg-line {
          stroke: var(--3b-accent);
          stroke-width: 1.5;
          vector-effect: non-scaling-stroke;
        }
        .dsh-3b-xaxis {
          display: flex;
          justify-content: space-between;
          gap: 12px;
          padding-left: 52px;
          font-size: 11px;
          line-height: 14px;
          font-variant-numeric: tabular-nums;
          color: var(--3b-ink-4);
        }
        .dsh-3b-chart-legend {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 16px;
          font-size: 11px;
          line-height: 14px;
          color: var(--3b-ink-4);
        }
        .dsh-3b-legend-item {
          display: inline-flex;
          align-items: center;
          gap: 6px;
        }
        .dsh-3b-legend-swatch {
          width: 16px;
          height: 0;
          border-top: 1px dashed currentColor;
          color: var(--3b-ink-4);
        }
        .dsh-3b-legend-swatch.accent {
          border-top: 1.5px solid var(--3b-accent);
          color: var(--3b-accent);
        }
        .dsh-3b-chart-meta {
          display: flex;
          flex-wrap: wrap;
          gap: 8px 16px;
          padding-top: 10px;
          border-top: 0.5px solid var(--3b-rule);
          font-size: 11px;
          line-height: 14px;
          font-variant-numeric: tabular-nums;
          color: var(--3b-ink-4);
        }
        .dsh-3b-empty {
          padding: 40px 0;
          text-align: center;
          font-size: 12px;
          line-height: 18px;
          color: var(--3b-ink-4);
        }

        /* 阶段总结与训练统计 */
        .dsh-3b-period-grid {
          display: grid;
          grid-template-columns: 1fr;
          gap: 12px;
        }
        @media (min-width: 720px) {
          .dsh-3b-period-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
        }
        .dsh-3b-period-item {
          display: flex;
          flex-direction: column;
          gap: 6px;
          padding: 14px 16px;
          box-sizing: border-box;
          border-radius: var(--dsw-radius-md);
          background: var(--dsw-alias-bg-module-platform);
        }
        .dsh-3b-period-item h4 {
          margin: 0;
          font-size: 13px;
          line-height: 20px;
          font-weight: 500;
          color: var(--3b-ink);
        }
        .dsh-3b-stat-value {
          display: flex;
          align-items: baseline;
          gap: 4px;
          font-size: 16px;
          line-height: 24px;
          font-weight: 500;
          font-variant-numeric: tabular-nums;
          color: var(--3b-ink);
        }
        .dsh-3b-stat-value .unit {
          font-size: 12px;
          line-height: 18px;
          font-weight: 400;
          color: var(--3b-ink-3);
        }
        .dsh-3b-stat-grid {
          display: grid;
          grid-template-columns: 1fr;
          gap: 16px;
        }
        @media (min-width: 640px) {
          .dsh-3b-stat-grid {
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
          }
        }
        .dsh-3b-meter {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .dsh-3b-meter-track {
          flex: 1 1 auto;
          height: 2px;
          border-radius: 999px;
          corner-shape: round;
          background: var(--3b-rule);
          overflow: hidden;
        }
        .dsh-3b-meter-fill {
          display: block;
          height: 100%;
          border-radius: 999px;
          corner-shape: round;
          background: var(--3b-accent);
        }

        /* 表格 */
        .dsh-3b-table-wrap {
          overflow-x: auto;
        }
        .dsh-3b-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 13px;
          line-height: 20px;
          font-variant-numeric: tabular-nums;
        }
        .dsh-3b-table th,
        .dsh-3b-table td {
          padding: 10px 12px;
          border-bottom: 0.5px solid var(--3b-rule);
          text-align: left;
          vertical-align: top;
        }
        .dsh-3b-table tr:last-child td {
          border-bottom: none;
        }
        .dsh-3b-table th {
          font-size: 12px;
          line-height: 18px;
          font-weight: 500;
          color: var(--3b-ink-4);
          white-space: nowrap;
        }
        .dsh-3b-table td {
          color: var(--3b-ink);
          overflow-wrap: anywhere;
        }
        .dsh-3b-table .dsh-3b-num {
          text-align: right;
        }
        .dsh-3b-table .dsh-3b-nowrap {
          white-space: nowrap;
        }
        .dsh-3b-table code,
        .dsh-3b-section-head code {
          font-family: var(--ds-font-family-code);
          font-size: 12px;
          line-height: 18px;
          overflow-wrap: normal;
        }

        /* 表单 */
        .dsh-3b-form {
          display: flex;
          flex-direction: column;
          gap: 16px;
        }
        .dsh-3b-field-row {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 12px 16px;
        }
        .dsh-3b-field {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          font-size: 12px;
          line-height: 18px;
          color: var(--3b-ink-2);
        }
        .dsh-3b-field-label {
          flex: none;
          white-space: nowrap;
        }
        .dsh-3b-field-text {
          margin: 0 0 8px;
          font-size: 12px;
          line-height: 18px;
          color: var(--3b-ink-2);
        }
        .dsh-3b-form-actions {
          display: flex;
          flex-wrap: wrap;
          justify-content: flex-end;
          gap: 8px;
        }
        .dsh-3b-field-stack {
          display: flex;
          flex-direction: column;
          gap: 6px;
          min-width: 0;
          font-size: 12px;
          line-height: 18px;
          color: var(--3b-ink-2);
        }
        .dsh-3b-goal-head {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          margin-bottom: 8px;
        }
        .dsh-3b-goal-head .dsh-3b-field-text {
          margin: 0;
        }
        .dsh-3b-tag-list {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
        }
        .dsh-3b-tag-chip {
          height: 26px;
          padding: 0 10px;
          box-sizing: border-box;
          border: 0.5px solid var(--dsw-alias-border-l3);
          border-radius: 999px;
          corner-shape: round;
          background: transparent;
          color: var(--3b-ink-2);
          font-family: inherit;
          font-size: 12px;
          line-height: 18px;
          cursor: pointer;
        }
        .dsh-3b-tag-chip.selected {
          background: color-mix(in srgb, var(--3b-accent) 12%, transparent);
          border-color: color-mix(in srgb, var(--3b-accent) 45%, transparent);
          color: var(--3b-accent);
          font-weight: 500;
        }
        @media (hover: hover) {
          .dsh-3b-tag-chip:hover {
            background: var(--dsw-alias-interactive-bg-hover);
          }
        }

        /* 页签内容与任务报告 */
        .dsh-3b-tab-body {
          display: flex;
          flex-direction: column;
          gap: 16px;
        }
        .dsh-3b-status-line {
          display: flex;
          align-items: center;
          gap: 8px;
          margin: 0;
          font-size: 13px;
          line-height: 20px;
          font-weight: 500;
          color: var(--3b-ink);
        }
        .dsh-3b-problem {
          display: flex;
          align-items: flex-start;
          gap: 8px;
          margin: 4px 0 0;
          font-size: 12px;
          line-height: 18px;
          color: var(--3b-ink-2);
        }
        .dsh-3b-problem .dsh-3b-dot {
          margin-top: 6px;
        }
        .dsh-3b-stat-row {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
          gap: 12px 20px;
        }
        .dsh-3b-stat-cell {
          display: flex;
          flex-direction: column;
          gap: 4px;
          padding-top: 10px;
          border-top: 0.5px solid var(--3b-rule);
          min-width: 0;
        }
        .dsh-3b-stat-label {
          font-size: 11px;
          line-height: 14px;
          color: var(--3b-ink-4);
        }
        .dsh-3b-stat-cell .dsh-3b-stat-value {
          font-size: 13px;
          line-height: 20px;
          font-weight: 400;
          overflow-wrap: anywhere;
        }
        .dsh-3b-pre {
          margin: 0;
          padding: 12px 14px;
          box-sizing: border-box;
          border: 0.5px solid var(--3b-rule);
          border-radius: var(--dsw-radius-lg);
          background: var(--dsw-alias-markdown-code-block);
          color: var(--3b-ink);
          font-family: var(--ds-font-family-code);
          font-size: 12px;
          line-height: 19px;
          white-space: pre-wrap;
          overflow-wrap: anywhere;
          overflow: auto;
          max-height: 360px;
        }
        .dsh-3b-history {
          display: flex;
          flex-direction: column;
          gap: 8px;
          padding-top: 16px;
          border-top: 0.5px solid var(--3b-rule);
        }
        .dsh-3b-history h3 {
          margin: 0;
          font-size: 13px;
          line-height: 20px;
          font-weight: 500;
          color: var(--3b-ink);
        }
        .dsh-3b-title-row {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 10px;
          min-width: 0;
        }
        .dsh-3b-title-row h2 {
          min-width: 0;
          overflow-wrap: anywhere;
        }
        .dsh-3b-report,
        .dsh-3b-details {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .dsh-3b-report h3 {
          margin: 0;
          font-size: 13px;
          line-height: 20px;
          font-weight: 500;
        }
        .dsh-3b-details summary {
          cursor: pointer;
          font-size: 12px;
          line-height: 18px;
          color: var(--3b-ink-2);
        }
        .dsh-3b-details-list {
          margin: 0;
          padding-left: 18px;
          font-size: 12px;
          line-height: 18px;
          color: var(--3b-ink-3);
        }
        .dsh-3b-card > summary {
          cursor: pointer;
          font-size: 13px;
          line-height: 20px;
          font-weight: 500;
          color: var(--3b-ink);
        }
        .dsh-3b-details-body {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .dsh-3b-ai-metrics {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
          gap: 12px;
        }
        .dsh-3b-privacy {
          align-items: center;
          padding: 48px 24px;
          text-align: center;
        }
        .dsh-3b-privacy h2 {
          margin: 0 0 8px;
          font-size: 16px;
          line-height: 24px;
          font-weight: 500;
        }

        /* 弹窗 */
        .dsh-3b-modal-backdrop {
          position: fixed;
          inset: 0;
          z-index: 9999;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 24px;
          box-sizing: border-box;
          background: var(--dsw-alias-bg-mask-1);
        }
        .dsh-3b-modal.wide {
          max-width: 860px;
        }
        .dsh-3b-modal {
          display: flex;
          flex-direction: column;
          gap: 16px;
          width: 100%;
          max-width: 680px;
          max-height: 86vh;
          padding: 24px;
          box-sizing: border-box;
          overflow-y: auto;
          border: 0;
          border-radius: var(--dsw-radius-panel);
          background: var(--dsw-alias-bg-layer-1);
          box-shadow: var(--dsw-elevation-panel);
          color: var(--3b-ink);
        }
        .dsh-3b-modal .dsh-3b-nav {
          flex: 0 0 auto;
          align-self: flex-start;
        }
        .dsh-3b-modal-head {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 16px;
        }
        .dsh-3b-modal-title {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 10px;
          min-width: 0;
        }
        .dsh-3b-modal-title h2 {
          margin: 0;
          font-size: 16px;
          line-height: 24px;
          font-weight: 500;
        }

        @media (max-width: 639px) {
          .dsh-3b-health-root {
            padding-top: calc(20px + var(--dsh-frame-top-clearance, 0px));
            padding-bottom: 32px;
          }
          .dsh-3b-field {
            display: flex;
            width: 100%;
            max-width: 100%;
          }
          .dsh-3b-field .dsh-3b-select,
          .dsh-3b-field .dsh-3b-input {
            flex: 1 1 auto;
            min-width: 0;
            max-width: 100%;
          }
          .dsh-3b-actions {
            width: 100%;
          }
          .dsh-3b-metrics-grid {
            grid-template-columns: 1fr;
          }
          .dsh-3b-kpi {
            min-height: 0;
          }
          .dsh-3b-plot-wrap {
            grid-template-columns: 36px minmax(0, 1fr);
            height: 140px;
          }
          .dsh-3b-xaxis {
            padding-left: 44px;
          }
          .dsh-3b-modal-backdrop {
            padding: 16px;
          }
          .dsh-3b-modal {
            padding: 20px;
            max-height: 92vh;
          }
        }
        @media (pointer: coarse) {
          .dsh-3b-btn {
            height: 36px;
            padding: 0 12px;
            font-size: 13px;
          }
          .dsh-3b-btn.tiny {
            height: 32px;
            font-size: 12px;
          }
          .dsh-3b-select,
          .dsh-3b-input {
            height: 36px;
            font-size: 16px;
          }
          .dsh-3b-textarea {
            font-size: 16px;
          }
          .dsh-3b-tab {
            height: 38px;
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .dsh-3b-card,
          .dsh-3b-btn,
          .dsh-3b-tab {
            transition: none;
          }
        }
        /* ===== 杂志风皮肤（墨水经典 · 午夜墨） =====
           纸面 + 衬线标题 + 三线表；UI 正文保持无衬线以保证密度可读。
           切换纸色/墨色/锚点色只需改这一段。 */
        .dsh-3b-health-root {
          --3b-paper: #f1efea;
          --3b-paper-2: #f7f5f1;
          --3b-ink: #0a0a0b;
          --3b-ink-2: #3f3d39;
          --3b-ink-3: #6b675f;
          --3b-ink-4: #8a857c;
          --3b-rule: rgba(10, 10, 11, 0.16);
          --3b-rule-strong: rgba(10, 10, 11, 0.55);
          --3b-texture: rgba(10, 10, 11, 0.028);
          --3b-accent: #111111;
          --3b-accent-on: #f1efea;
          --3b-chart-bar: #56b7e6;
          --3b-success: #2e6b4f;
          --3b-warn: #9b5a2e;
          --3b-error: #a33a2f;
          --3b-mask: rgba(10, 10, 11, 0.45);
          --3b-code-bg: #0a0a0b;
          --3b-code-ink: #f1efea;
          --3b-serif: 'Noto Serif SC', 'Source Han Serif SC', 'Songti SC', 'STSong', Georgia, 'Times New Roman', serif;
          --3b-sans: var(--dsw-font-family);
          --3b-mono: var(--ds-font-family-code);
          --3b-surface: var(--3b-paper-2);
          --3b-stroke: var(--3b-rule);
          --dsw-focus-ring-color: var(--3b-ink);
          accent-color: var(--3b-ink);
          caret-color: var(--3b-ink);
          background: var(--3b-paper);
          scrollbar-color: var(--3b-ink-4) transparent;
        }
        body[data-ds-dark-theme] .dsh-3b-health-root {
          --3b-paper: #0e0d0c;
          --3b-paper-2: #171512;
          --3b-ink: #ece2cf;
          --3b-ink-2: #c8bda9;
          --3b-ink-3: #948b7c;
          --3b-ink-4: #8a8172;
          --3b-rule: rgba(236, 226, 207, 0.16);
          --3b-rule-strong: rgba(236, 226, 207, 0.55);
          --3b-texture: rgba(236, 226, 207, 0.04);
          --3b-accent: #d4a04a;
          --3b-accent-on: #0e0d0c;
          --3b-chart-bar: #56b7e6;
          --3b-success: #7fbf9a;
          --3b-warn: #d9a76a;
          --3b-error: #e08a7d;
          --3b-mask: rgba(0, 0, 0, 0.66);
          --3b-code-bg: #1a1714;
          --3b-code-ink: #ece2cf;
        }
        .dsh-3b-health-root ::selection {
          background: var(--3b-ink);
          color: var(--3b-paper);
        }

        /* 页头与页签 */
        .dsh-3b-topbar {
          padding-bottom: 18px;
          border-bottom: 1px solid var(--3b-rule-strong);
        }
        .dsh-3b-title {
          font-family: var(--3b-serif);
          font-size: 26px;
          line-height: 34px;
          font-weight: 500;
          letter-spacing: 0.02em;
        }
        .dsh-3b-subtitle {
          font-size: 12px;
          line-height: 18px;
          color: var(--3b-ink-3);
        }
        .dsh-3b-path {
          font-family: var(--3b-mono);
          font-size: 11px;
          line-height: 16px;
          color: var(--3b-ink-4);
        }
        .dsh-3b-nav {
          padding: 0;
          border-radius: 0;
          background: transparent;
        }
        .dsh-3b-tab {
          position: relative;
          height: 38px;
          border-radius: 0;
          font-size: 14px;
          color: var(--3b-ink-3);
        }
        .dsh-3b-tab.active {
          background: transparent;
          color: var(--3b-ink);
          box-shadow: none;
        }
        .dsh-3b-tab.active::after {
          content: '';
          position: absolute;
          left: 0;
          right: 0;
          bottom: 0;
          height: 2px;
          background: var(--3b-ink);
        }
        @media (hover: hover) {
          .dsh-3b-tab:hover {
            color: var(--3b-ink);
          }
        }

        /* 标题、编号与数字 */
        .dsh-3b-section-head h2 {
          font-family: var(--3b-serif);
          font-size: 18px;
          line-height: 26px;
          font-weight: 500;
          letter-spacing: 0.02em;
        }
        .dsh-3b-section-index {
          font-family: var(--3b-mono);
          color: var(--3b-ink-4);
        }
        .dsh-3b-metric-val strong {
          font-family: var(--3b-serif);
          font-size: 26px;
          line-height: 34px;
          font-weight: 400;
        }
        .dsh-3b-metric-val span {
          font-size: 12px;
          line-height: 18px;
          color: var(--3b-ink-3);
        }
        .dsh-3b-stat-value {
          font-family: var(--3b-serif);
          font-size: 18px;
          line-height: 26px;
          font-weight: 500;
        }
        .dsh-3b-stat-value .unit {
          font-family: var(--3b-sans);
          font-size: 11px;
          line-height: 16px;
          color: var(--3b-ink-3);
        }
        .dsh-3b-modal-title h2,
        .dsh-3b-privacy h2 {
          font-family: var(--3b-serif);
          font-size: 18px;
          line-height: 26px;
          font-weight: 500;
        }
        .dsh-3b-period-item h4,
        .dsh-3b-report h3,
        .dsh-3b-history h3 {
          font-size: 13px;
          line-height: 20px;
          font-weight: 500;
        }
        .dsh-3b-metric-head {
          font-size: 11.5px;
          line-height: 17px;
          color: var(--3b-ink-3);
        }
        .dsh-3b-metric-note {
          font-size: 11.5px;
          line-height: 17px;
          color: var(--3b-ink-3);
        }

        /* 卡片、按钮与标签 */
        .dsh-3b-card {
          background: var(--3b-surface);
          border: 1px solid var(--3b-stroke);
          border-radius: 3px;
        }
        @media (hover: hover) {
          .dsh-3b-card.interactive:hover {
            background: color-mix(in srgb, var(--3b-ink) 4%, var(--3b-surface));
          }
        }
        .dsh-3b-card.interactive:active {
          background: color-mix(in srgb, var(--3b-ink) 7%, var(--3b-surface));
        }
        .dsh-3b-btn {
          height: 28px;
          border-radius: 2px;
          box-shadow: inset 0 0 0 1px var(--3b-rule);
          color: var(--3b-ink);
          font-size: 12px;
        }
        .dsh-3b-btn.primary {
          box-shadow: none;
          background: var(--3b-ink);
          color: var(--3b-accent-on);
        }
        .dsh-3b-btn.ghost {
          box-shadow: none;
          color: var(--3b-ink-3);
        }
        .dsh-3b-btn.danger {
          box-shadow: none;
          color: var(--3b-error);
        }
        @media (hover: hover) {
          .dsh-3b-btn:hover:not(:disabled) {
            background: color-mix(in srgb, var(--3b-ink) 6%, transparent);
          }
          .dsh-3b-btn.primary:hover:not(:disabled) {
            background: color-mix(in srgb, var(--3b-ink) 82%, var(--3b-paper));
          }
          .dsh-3b-btn.danger:hover:not(:disabled) {
            background: color-mix(in srgb, var(--3b-error) 8%, transparent);
          }
        }
        .dsh-3b-btn:active:not(:disabled) {
          background: color-mix(in srgb, var(--3b-ink) 10%, transparent);
        }
        .dsh-3b-badge {
          height: 19px;
          padding: 0 6px;
          border: 1px solid var(--3b-rule);
          border-radius: 2px;
          corner-shape: round;
          background: transparent;
          color: var(--3b-ink-3);
          font-size: 10.5px;
          line-height: 14px;
        }
        .dsh-3b-badge.accent {
          background: transparent;
          border-color: var(--3b-ink-2);
          color: var(--3b-ink);
        }
        .dsh-3b-badge.success {
          background: transparent;
          border-color: color-mix(in srgb, var(--3b-success) 60%, transparent);
          color: var(--3b-success);
        }
        .dsh-3b-badge.warn {
          background: transparent;
          border-color: color-mix(in srgb, var(--3b-warn) 60%, transparent);
          color: var(--3b-warn);
        }

        /* 提示、输入与分段控件 */
        .dsh-3b-notice,
        .dsh-3b-success {
          border: 1px solid var(--3b-rule);
          border-left: 2px solid var(--3b-warn);
          border-radius: 2px;
          background: transparent;
          color: var(--3b-ink);
          font-size: 12px;
        }
        .dsh-3b-notice.error {
          border-left-color: var(--3b-error);
        }
        .dsh-3b-success {
          border-left-color: var(--3b-success);
        }
        .dsh-3b-dot {
          background: var(--3b-success);
        }
        .dsh-3b-dot.warn {
          background: var(--3b-warn);
        }
        .dsh-3b-dot.error {
          background: var(--3b-error);
        }
        .dsh-3b-select,
        .dsh-3b-input,
        .dsh-3b-textarea {
          background: var(--3b-paper);
          border: 1px solid var(--3b-rule);
          border-radius: 2px;
          color: var(--3b-ink);
        }
        .dsh-3b-textarea::placeholder {
          color: var(--3b-ink-4);
        }
        .dsh-3b-seg {
          padding: 2px;
          border: 1px solid var(--3b-rule);
          border-radius: 2px;
          background: transparent;
        }
        .dsh-3b-seg button {
          height: 24px;
          border-radius: 0;
          color: var(--3b-ink-3);
          font-size: 12px;
        }
        .dsh-3b-seg button[aria-pressed='true'] {
          background: var(--3b-ink);
          box-shadow: none;
          color: var(--3b-accent-on);
        }
        .dsh-3b-tag-chip {
          height: 26px;
          border: 1px solid var(--3b-rule);
          border-radius: 2px;
          corner-shape: round;
          color: var(--3b-ink-3);
        }
        .dsh-3b-tag-chip.selected {
          background: var(--3b-ink);
          border-color: var(--3b-ink);
          color: var(--3b-accent-on);
        }
        @media (hover: hover) {
          .dsh-3b-tag-chip:hover {
            background: color-mix(in srgb, var(--3b-ink) 6%, transparent);
          }
        }

        /* 图表：纸面 + 交叉线纹理 + 墨色柱 */
        .dsh-3b-bars {
          background-color: var(--3b-paper);
          background-image:
            repeating-linear-gradient(45deg, transparent 0 10px, var(--3b-texture) 10px 10.5px),
            repeating-linear-gradient(-45deg, transparent 0 10px, var(--3b-texture) 10px 10.5px);
          border: 1px solid var(--3b-rule);
          border-radius: 2px;
        }
        .dsh-3b-gridline {
          border-top: 1px solid var(--3b-rule);
        }
        .dsh-3b-bar {
          border-radius: 0;
          background: var(--3b-chart-bar);
        }
        @media (hover: hover) {
          .dsh-3b-bar:hover {
            background: color-mix(in srgb, var(--3b-chart-bar) 84%, var(--3b-ink));
          }
        }
        .dsh-3b-mean-line {
          stroke: var(--3b-ink-4);
        }
        .dsh-3b-reg-line {
          stroke: var(--3b-accent);
        }
        .dsh-3b-yaxis,
        .dsh-3b-xaxis,
        .dsh-3b-chart-meta,
        .dsh-3b-chart-legend {
          font-family: var(--3b-mono);
          font-size: 10.5px;
          color: var(--3b-ink-4);
        }
        .dsh-3b-chart-meta {
          border-top: 1px solid var(--3b-rule);
        }

        /* 三线表 */
        .dsh-3b-table {
          border-top: 2px solid var(--3b-ink);
        }
        .dsh-3b-table th {
          border-bottom: 1px solid var(--3b-rule-strong);
          color: var(--3b-ink-3);
          font-size: 11px;
          line-height: 16px;
        }
        .dsh-3b-table td {
          border-bottom: 1px solid var(--3b-rule);
        }

        /* 弹窗、代码块与进度条 */
        .dsh-3b-modal-backdrop {
          background: var(--3b-mask);
        }
        .dsh-3b-modal {
          border: 1px solid var(--3b-rule-strong);
          border-radius: 3px;
          background: var(--3b-paper);
          box-shadow: none;
        }
        .dsh-3b-pre {
          border: 0;
          border-radius: 2px;
          background: var(--3b-code-bg);
          color: var(--3b-code-ink);
        }
        .dsh-3b-period-item {
          background: var(--3b-paper);
        }
        .dsh-3b-meter-track {
          background: var(--3b-rule);
        }
        .dsh-3b-meter-fill {
          background: var(--3b-ink);
        }

        /* ===== 右侧健康关注侧栏 ===== */
        .dsh-3b-health-root {
          --3b-zone-athlete: #2b6cb0;
          --3b-zone-overweight: #c06c2b;
          --3b-zone-obese: #b83a2e;
          --3b-zone-muscular: #236b48;
          --3b-zone-healthy: #2e6b4f;
          --3b-zone-hidden-fat: #b85d19;
          --3b-zone-thin: #8c3b5a;
          --3b-zone-slim-muscular: #2d7a6e;
          --3b-zone-slim: #9b6b2e;
        }
        body[data-ds-dark-theme] .dsh-3b-health-root {
          --3b-zone-athlete: #56b7e6;
          --3b-zone-overweight: #e09f5a;
          --3b-zone-obese: #e57368;
          --3b-zone-muscular: #6fcf97;
          --3b-zone-healthy: #7fbf9a;
          --3b-zone-hidden-fat: #d9a76a;
          --3b-zone-thin: #d484a3;
          --3b-zone-slim-muscular: #72c4b6;
          --3b-zone-slim: #cbb06a;
        }
        .dsh-3b-dashboard-grid {
          display: grid;
          grid-template-columns: minmax(0, 1fr);
          gap: 28px;
          align-items: start;
        }
        .dsh-3b-dashboard-main {
          display: flex;
          flex-direction: column;
          gap: 32px;
          min-width: 0;
        }
        .dsh-3b-focus-sidebar {
          display: flex;
          flex-direction: column;
          gap: 18px;
          min-width: 0;
          overflow: visible;
        }
        @media (min-width: 1100px) {
          .dsh-3b-dashboard-grid {
            grid-template-columns: minmax(0, 1fr) 368px;
          }
        }
        /* 仪表盘双栏各自独立滚动：页头与提示固定，左右两列分别响应各自滚轮 */
        @media (min-width: 1100px) {
          .dsh-3b-health-root--dashboard {
            display: flex;
            flex-direction: column;
            overflow: hidden;
          }
          .dsh-3b-health-root--dashboard .dsh-3b-health-container {
            flex: 1;
            min-height: 0;
            width: 100%;
          }
          .dsh-3b-health-root--dashboard .dsh-3b-health-container > :not(.dsh-3b-dashboard-grid) {
            flex: none;
          }
          .dsh-3b-health-root--dashboard .dsh-3b-dashboard-grid {
            flex: 1;
            min-height: 0;
            align-items: stretch;
            overflow: hidden;
          }
          .dsh-3b-health-root--dashboard .dsh-3b-dashboard-main,
          .dsh-3b-health-root--dashboard .dsh-3b-focus-sidebar {
            overflow-y: auto;
            overscroll-behavior: contain;
            scrollbar-gutter: stable;
            padding-right: 4px;
          }
        }

        .dsh-3b-profile-bar {
          display: flex;
          flex-direction: column;
          gap: 8px;
          padding-bottom: 12px;
          border-bottom: 1px solid var(--3b-rule-strong);
        }
        .dsh-3b-profile-line {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
        }
        .dsh-3b-profile-text {
          font-family: var(--3b-mono);
          font-size: 11.5px;
          line-height: 16px;
          letter-spacing: 0.02em;
          color: var(--3b-ink-2);
        }
        .dsh-3b-profile-editor {
          display: flex;
          flex-direction: column;
          gap: 8px;
          padding: 12px;
          border: 1px solid var(--3b-rule);
          background: var(--3b-paper-2);
        }
        .dsh-3b-profile-field {
          display: flex;
          flex-direction: column;
          gap: 4px;
          font-size: 11px;
          color: var(--3b-ink-3);
        }
        .dsh-3b-profile-actions {
          display: flex;
          gap: 8px;
        }
        .dsh-3b-profile-editor .dsh-3b-seg {
          justify-content: flex-start;
        }

        .dsh-3b-score-hero {
          display: flex;
          align-items: flex-start;
          gap: 14px;
          padding-bottom: 16px;
          border-bottom: 1px solid var(--3b-rule-strong);
        }
        .dsh-3b-score-value {
          display: flex;
          align-items: baseline;
          gap: 3px;
          flex: none;
        }
        .dsh-3b-score-value strong {
          font-family: var(--3b-serif);
          font-size: 36px;
          line-height: 40px;
          font-weight: 500;
          letter-spacing: -0.01em;
        }
        .dsh-3b-score-value span {
          font-family: var(--3b-mono);
          font-size: 11px;
          color: var(--3b-ink-3);
        }
        .dsh-3b-score-body {
          min-width: 0;
        }
        .dsh-3b-score-body h3 {
          margin: 0 0 4px;
          font-family: var(--3b-serif);
          font-size: 14px;
          font-weight: 500;
          line-height: 20px;
        }
        .dsh-3b-score-body p {
          margin: 0;
          font-size: 11.5px;
          line-height: 17px;
          color: var(--3b-ink-2);
        }
        .dsh-3b-score-body p.dsh-3b-score-note {
          margin-top: 4px;
          color: var(--3b-ink-4);
        }

        .dsh-3b-focus-section {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        .dsh-3b-focus-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 10px;
        }
        .dsh-3b-focus-card {
          position: relative;
          display: flex;
          flex-direction: column;
          gap: 6px;
          min-width: 0;
          padding: 12px;
          border: 1px solid var(--3b-rule);
          background: var(--3b-surface);
          overflow: visible;
        }
        .dsh-3b-focus-card-head {
          display: flex;
          align-items: center;
          flex-wrap: wrap;
          gap: 6px;
        }
        .dsh-3b-focus-card-head h3 {
          margin: 0;
          flex: 1 1 auto;
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          font-size: 12px;
          line-height: 16px;
          font-weight: 500;
          color: var(--3b-ink-2);
        }
        .dsh-3b-status-pill {
          flex: none;
          padding: 1px 7px;
          border: 1px solid currentColor;
          border-radius: 999px;
          font-size: 10px;
          line-height: 15px;
        }
        .dsh-3b-status-pill.good {
          color: var(--3b-success);
        }
        .dsh-3b-status-pill.warn {
          color: var(--3b-warn);
        }
        .dsh-3b-focus-value {
          display: flex;
          align-items: baseline;
          gap: 4px;
          min-width: 0;
        }
        .dsh-3b-focus-value strong {
          font-family: var(--3b-serif);
          font-size: 20px;
          line-height: 26px;
          font-weight: 500;
        }
        .dsh-3b-focus-unit {
          font-family: var(--3b-mono);
          font-size: 10.5px;
          color: var(--3b-ink-3);
        }
        .dsh-3b-focus-delta {
          margin-left: auto;
          font-family: var(--3b-mono);
          font-size: 10.5px;
          color: var(--3b-ink-4);
        }
        .dsh-3b-focus-sub {
          margin: 0;
          font-size: 10.5px;
          line-height: 15px;
          color: var(--3b-ink-3);
        }
        .dsh-3b-focus-gap {
          margin: 0;
          font-size: 11px;
          line-height: 16px;
          color: var(--3b-warn);
        }
        .dsh-3b-focus-gap.good {
          color: var(--3b-success);
        }
        .dsh-3b-focus-gap .dsh-3b-focus-action {
          color: var(--3b-ink-3);
        }

        .dsh-3b-bang-wrap {
          position: relative;
          flex: none;
          display: inline-flex;
          align-items: center;
        }
        .dsh-3b-bang {
          width: 15px;
          height: 15px;
          padding: 0;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          border: 1px solid var(--3b-rule-strong);
          border-radius: 50%;
          background: transparent;
          color: var(--3b-ink-3);
          font-family: var(--3b-serif);
          font-size: 10px;
          line-height: 1;
          cursor: help;
        }
        .dsh-3b-bang:hover,
        .dsh-3b-bang:focus-visible {
          color: var(--3b-ink);
          border-color: var(--3b-ink);
        }
        .dsh-3b-bang-popover {
          position: absolute;
          z-index: 900;
          width: 256px;
          padding: 10px;
          display: flex;
          flex-direction: column;
          gap: 6px;
          background: var(--3b-paper);
          border: 1px solid var(--3b-rule-strong);
          box-shadow: 0 10px 24px rgba(10, 10, 11, 0.18);
          font-size: 10.5px;
          line-height: 15px;
          color: var(--3b-ink-2);
          text-align: left;
          white-space: normal;
        }
        .dsh-3b-bang-row {
          display: flex;
          flex-direction: column;
          gap: 1px;
        }
        .dsh-3b-bang-row strong {
          color: var(--3b-ink);
          font-weight: 500;
        }

        .dsh-3b-grid-card {
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        .dsh-3b-grid-head {
          display: flex;
          align-items: baseline;
          justify-content: space-between;
          gap: 8px;
        }
        .dsh-3b-grid-head h3 {
          margin: 0;
          font-family: var(--3b-serif);
          font-size: 14px;
          font-weight: 500;
        }
        .dsh-3b-grid-zone {
          font-family: var(--3b-mono);
          font-size: 10.5px;
          color: var(--3b-ink-3);
        }
        .dsh-3b-grid-toggle {
          align-self: flex-start;
        }
        .dsh-3b-body-grid {
          display: block;
          width: 100%;
          height: auto;
        }
        .dsh-3b-grid-rule {
          stroke: var(--3b-rule-strong);
          stroke-width: 1;
        }
        .dsh-3b-grid-label {
          fill: var(--3b-ink-4);
          font-size: 8.5px;
        }
        .dsh-3b-grid-axis {
          fill: var(--3b-ink-4);
          font-family: var(--3b-mono);
          font-size: 8px;
        }
        .dsh-3b-grid-date {
          fill: var(--3b-ink-3);
          font-family: var(--3b-mono);
          font-size: 8.5px;
        }
        .dsh-3b-grid-legend {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 10px;
          font-size: 10px;
          color: var(--3b-ink-3);
        }
        .dsh-3b-grid-legend > span {
          display: inline-flex;
          align-items: center;
          gap: 4px;
        }
        .dsh-3b-grid-dot {
          display: inline-block;
          width: 7px;
          height: 7px;
          border: 1px solid var(--3b-ink-3);
          border-radius: 50%;
          background: var(--3b-ink-3);
        }
        .dsh-3b-grid-dot.dashed {
          background: transparent;
          border-style: dashed;
        }

        .dsh-3b-target-list {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .dsh-3b-target-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
        }
        .dsh-3b-target-head h3 {
          margin: 0;
          font-family: var(--3b-serif);
          font-size: 14px;
          font-weight: 500;
        }
        .dsh-3b-target-rows {
          list-style: none;
          margin: 0;
          padding: 0;
          display: flex;
          flex-direction: column;
        }
        .dsh-3b-target-row {
          position: relative;
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto 15px;
          grid-template-areas:
            'label value bang'
            'gap gap bang';
          gap: 2px 8px;
          padding: 8px 0;
          border-top: 1px solid var(--3b-rule);
        }
        .dsh-3b-target-row:first-child {
          border-top: 0;
        }
        .dsh-3b-target-label {
          grid-area: label;
          font-size: 11.5px;
          line-height: 16px;
          color: var(--3b-ink-2);
        }
        .dsh-3b-target-value {
          grid-area: value;
          font-family: var(--3b-mono);
          font-size: 12px;
          line-height: 16px;
          color: var(--3b-ink);
          text-align: right;
        }
        .dsh-3b-target-value.warn {
          color: var(--3b-warn);
        }
        .dsh-3b-target-value.good {
          color: var(--3b-success);
        }
        .dsh-3b-target-gap {
          grid-area: gap;
          font-size: 10px;
          line-height: 14px;
          color: var(--3b-ink-4);
        }
        .dsh-3b-target-row .dsh-3b-bang-wrap {
          grid-area: bang;
          align-self: start;
        }
        .dsh-3b-target-note {
          margin: 0;
          font-size: 10px;
          color: var(--3b-ink-4);
        }
        .dsh-3b-focus-stale {
          margin: 0;
          font-size: 10px;
          line-height: 15px;
          color: var(--3b-ink-4);
        }
        @media (max-width: 640px) {
          .dsh-3b-focus-grid {
            grid-template-columns: minmax(0, 1fr);
          }
        }
      `
      const existing = document.getElementById(STYLE_ID)
      if (existing) {
        if (existing.textContent !== css) existing.textContent = css
        return
      }
      const style = document.createElement('style')
      style.id = STYLE_ID
      style.textContent = css
      document.head.appendChild(style)
    }

    async function apiFetch(path, options = {}) {
      const headers = { ...(options.headers || {}) }
      if (options.body !== undefined && !headers['Content-Type']) {
        headers['Content-Type'] = 'application/json'
      }
      const res = await fetch(path, {
        ...options,
        headers,
      })
      const text = await res.text().catch(() => '')
      let data = {}
      if (text) {
        try {
          data = JSON.parse(text)
        } catch (_e) {
          data = { error: text }
        }
      }
      if (!res.ok) {
        const err = new Error(data.error || `请求失败 (${res.status})`)
        err.status = res.status
        throw err
      }
      return data
    }

    function formatNum(value, maxDigits = 1) {
      if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—'
      return new Intl.NumberFormat('zh-CN', { maximumFractionDigits: maxDigits }).format(Number(value))
    }

    function healthTrendLabel(metric) {
      if (!metric) return ''
      const label = metric.label || metric.id || ''
      return metric.source === '历史主库' && metric.id !== 'sleep' && !label.endsWith('（仅 XML）')
        ? label + '（仅 XML）'
        : label
    }

    function healthTrendSeries(data, active, days) {
      if (!data || !active) return { dates: [], values: [], limited: true, loadedDays: 0 }
      const range = days === 30 ? data : (data.ranges?.[String(days)] || data)
      const metric = range === data ? active : (range.metrics?.find(item => item.id === active.id) || active)
      const stored = range.window || []
      const end = Date.parse((stored[stored.length - 1] || '') + 'T00:00:00Z')
      if (!Number.isFinite(end)) return { dates: [], values: [], limited: true, loadedDays: 0 }
      const rows = new Map(stored.map((day, i) => [day, metric?.values?.[i]]))
      const dates = Array.from({ length: days }, (_, i) => new Date(end - (days - 1 - i) * 86400000).toISOString().slice(0, 10))
      return {
        dates,
        values: dates.map((day) => {
          const val = rows.get(day)
          return typeof val === 'number' && Number.isFinite(val) ? val : null
        }),
        limited: stored.length < days,
        loadedDays: stored.length,
      }
    }

    /* #region focus-engine —— 同时被 scripts/focus-report.mjs 提取，移动或改名需同步该脚本 */
    function healthTrendStatistics(values) {
      const points = values.flatMap((value, x) => (typeof value === 'number' && Number.isFinite(value) ? [{ x, y: value }] : []))
      if (!points.length) return { points, average: null, regression: null }
      const average = points.reduce((sum, p) => sum + p.y / points.length, 0)
      const xMean = points.reduce((sum, p) => sum + p.x / points.length, 0)
      const denominator = points.reduce((sum, p) => sum + (p.x - xMean) ** 2, 0)
      const slope = denominator ? points.reduce((sum, p) => sum + (p.x - xMean) * (p.y - average), 0) / denominator : null
      const first = points[0].x
      const last = points[points.length - 1].x
      const a = slope == null ? null : average + slope * (first - xMean)
      const b = slope == null ? null : average + slope * (last - xMean)
      return {
        points,
        average,
        regression: points.length > 1 && Number.isFinite(a) && Number.isFinite(b) ? { first, last, a, b, slope } : null,
      }
    }

    /* ===== 健康关注引擎：生理基准 → 二次指标 → 关注度评分 → 侧栏模型 =====
       纯函数区：不做 I/O、不依赖 React，随快照与生理基准整体重算。 */

    const DEFAULT_PROFILE = { birth_year: 1992, sex: 'male', height_cm: 168 }

    const FOCUS_DOMAIN_LABELS = ['体脂与体态', '睡眠与恢复', '运动与活动', '心肺与代谢', '肌肉与状态']

    const FOCUS_ZONES = {
      athlete: { label: '运动员型', color: 'var(--3b-zone-athlete)' },
      overweight: { label: '偏胖', color: 'var(--3b-zone-overweight)' },
      obese: { label: '肥胖', color: 'var(--3b-zone-obese)' },
      muscular: { label: '肌肉型', color: 'var(--3b-zone-muscular)' },
      healthy: { label: '健康型', color: 'var(--3b-zone-healthy)' },
      hiddenFat: { label: '隐形肥胖', color: 'var(--3b-zone-hidden-fat)' },
      thin: { label: '消瘦型', color: 'var(--3b-zone-thin)' },
      slimMuscular: { label: '苗条肌肉型', color: 'var(--3b-zone-slim-muscular)' },
      slim: { label: '苗条型', color: 'var(--3b-zone-slim)' },
    }

    const FOCUS_HOMOLOGY = {
      derived_bmi: 'bmi',
      body_mass: 'bmi',
      body_fat: 'fat',
      derived_fmi: 'fat',
      derived_fat_mass: 'fat',
      derived_ffmi: 'lean',
      lean_body_mass: 'lean',
    }

    const FOCUS_METRICS = [
      {
        id: 'body_fat',
        label: '体脂率',
        unit: '%',
        gapUnit: '%',
        domain: 1,
        weight: 0.98,
        kind: 'slow',
        precision: 1,
        source: 'Apple Health 同步的体脂率（秤端 BIA 实测），秤端原始导出值保留在悬浮气泡对比',
        standard: 'Schutz et al., Int J Obes 2002 体成分参考区间',
        bounds(ctx) {
          const male = ctx.male
          const bands = ctx.age < 40
            ? (male ? [10, 20, 15] : [18, 28, 22])
            : ctx.age < 60
              ? (male ? [11, 22, 16.5] : [20, 30, 25])
              : (male ? [13, 24, 18.5] : [22, 32, 27])
          return { L: bands[0], U: bands[1], M: bands[2], margin: 5 }
        },
      },
      {
        id: 'derived_bmi',
        label: '校准 BMI',
        unit: 'kg/m²',
        gapUnit: '',
        domain: 1,
        weight: 0.95,
        kind: 'slow',
        precision: 1,
        source: '二次派生：最新体重 ÷ 身高的平方；秤端原始 BMI 只在悬浮气泡对比',
        standard: 'WS/T 428-2013《成人体重判定》',
        bounds(ctx) {
          return ctx.age >= 65
            ? { L: 20, U: 27, M: 23.5, margin: 4 }
            : { L: 18.5, U: 24, M: 22, margin: 4 }
        },
      },
      {
        id: 'derived_fmi',
        label: '脂肪质量指数',
        unit: 'kg/m²',
        gapUnit: '',
        domain: 1,
        weight: 0.85,
        kind: 'slow',
        precision: 1,
        source: '二次派生：脂肪量 ÷ 身高的平方',
        standard: 'Schutz et al., Int J Obes 2002 脂肪质量指数',
        bounds(ctx) {
          const male = ctx.male
          const bands = ctx.age < 40
            ? (male ? [2, 5.2, 3.6] : [3.5, 7.5, 5.2])
            : ctx.age < 60
              ? (male ? [2.2, 5.8, 3.9] : [4, 8.2, 5.8])
              : (male ? [2.5, 6.3, 4.3] : [4.5, 9, 6.6])
          return { L: bands[0], U: bands[1], M: bands[2], margin: 2 }
        },
      },
      {
        id: 'sleep',
        label: '睡眠时长',
        unit: '小时',
        gapUnit: ' 小时/晚',
        domain: 2,
        weight: 0.96,
        kind: 'daily',
        precision: 2,
        source: 'Apple Health 睡眠分析；健康导出按上海时区自然日归并，缺失日不补零',
        standard: 'NSF / AASM-SRS 成人睡眠时长共识',
        bounds(ctx) {
          return ctx.age >= 65
            ? { L: 7, U: 8, M: 7.5, margin: 1.5 }
            : { L: 7, U: 9, M: 7.5, margin: 1.5 }
        },
      },
      {
        id: 'hrv',
        label: '心率变异性',
        unit: 'ms',
        gapUnit: ' ms',
        domain: 2,
        weight: 0.85,
        kind: 'daily',
        precision: 1,
        source: 'Apple Watch SDNN 心率变异性（健康导出）',
        standard: 'AHA 自主神经恢复评估；群体下限与个人 30 日均值 85% 双轨',
        bounds(ctx) {
          const floor = ctx.age < 40 ? 30 : ctx.age < 60 ? 25 : 20
          const mean30 = focusMeanOf(ctx, 'hrv')
          const L = focusNumber(mean30) === null ? floor : Math.max(floor, mean30 * 0.85)
          return { L, U: Infinity, M: mean30, margin: 12 }
        },
      },
      {
        id: 'weekly_exercise',
        label: '周运动时长',
        unit: '分钟',
        gapUnit: ' 分钟/周',
        domain: 3,
        weight: 0.94,
        kind: 'daily',
        precision: 1,
        source: 'Health Data Export 训练明细（workouts）近 7 日累计分钟，不与 Apple 活动汇总相加',
        standard: 'WHO 2020 身体活动指南 / AHA 成人运动建议',
        bounds() {
          return { L: 150, U: 300, M: 210, margin: 90 }
        },
      },
      {
        id: 'steps',
        label: '日均步数',
        unit: '步',
        gapUnit: ' 步/天',
        domain: 3,
        weight: 0.86,
        kind: 'daily',
        precision: 0,
        source: 'Apple Health 步数（单日单来源，避免设备重复计数）',
        standard: 'Tudor-Locke 步数分级 / Paluch 步数与死亡率 Meta 分析',
        bounds(ctx) {
          return ctx.age >= 60
            ? { L: 6000, U: 10000, M: 8000, margin: 2000 }
            : { L: 7000, U: 12000, M: 8500, margin: 2500 }
        },
      },
      {
        id: 'daylight',
        label: '日照时间',
        unit: '分钟',
        gapUnit: ' 分钟/天',
        domain: 3,
        weight: 0.72,
        kind: 'daily',
        precision: 1,
        source: 'Apple Health 日照时间（户外光照暴露）',
        standard: '昼夜节律与户外日照公共卫生建议',
        bounds() {
          return { L: 30, U: 180, M: 60, margin: 20 }
        },
      },
      {
        id: 'vo2max',
        label: '最大摄氧量',
        unit: 'mL/min·kg',
        gapUnit: '',
        domain: 4,
        weight: 0.92,
        kind: 'slow',
        precision: 1,
        source: 'Apple Health 最大摄氧量（FRIEND 百分位口径）',
        standard: 'FRIEND Registry 心肺耐力标准 / AHA 声明',
        bounds(ctx) {
          const male = ctx.male
          const bands = male
            ? [[30, 41], [40, 38], [50, 35], [60, 31], [999, 27]]
            : [[30, 31], [40, 28], [50, 25], [60, 22], [999, 19]]
          let L = bands[bands.length - 1][1]
          for (const band of bands) {
            if (ctx.age < band[0]) { L = band[1]; break }
          }
          return { L, U: Infinity, M: L + (male ? 4 : 3.5), margin: 6 }
        },
      },
      {
        id: 'resting_hr',
        label: '静息心率',
        unit: 'bpm',
        gapUnit: ' bpm',
        domain: 4,
        weight: 0.9,
        kind: 'daily',
        precision: 1,
        source: 'Apple Watch 静息心率（7 个完结日有效均值）',
        standard: '静息心率与心血管预后队列研究（临床上限 80 bpm）',
        bounds(ctx) {
          const mean30 = focusMeanOf(ctx, 'resting_hr')
          const ceiling = focusNumber(mean30) === null ? 75 : Math.min(75, mean30 + 5)
          return { L: 50, U: ceiling, M: 61, margin: 10 }
        },
      },
      {
        id: 'oxygen',
        label: '血氧饱和度',
        unit: '%',
        gapUnit: '%',
        domain: 4,
        weight: 0.9,
        kind: 'daily',
        precision: 1,
        source: 'Apple Watch 血氧饱和度（脉搏血氧）',
        standard: '临床脉搏血氧饱和度标准范围',
        bounds() {
          return { L: 95, U: 100, M: 97.5, margin: 3 }
        },
      },
      {
        id: 'respiratory_rate',
        label: '呼吸频率',
        unit: '次/分',
        gapUnit: ' 次/分',
        domain: 4,
        weight: 0.8,
        kind: 'daily',
        precision: 1,
        source: '睡眠期间呼吸频率',
        standard: '成人静息/睡眠呼吸频率标准范围',
        bounds() {
          return { L: 12, U: 20, M: 14, margin: 4 }
        },
      },
      {
        id: 'derived_ffmi',
        label: '去脂指数 FFMI',
        unit: 'kg/m²',
        gapUnit: '',
        domain: 5,
        weight: 0.88,
        kind: 'slow',
        precision: 1,
        source: '二次派生：去脂体重 ÷ 身高的平方',
        standard: 'Schutz et al. 2002 / Kudsk NHANES III 分层标准',
        bounds(ctx) {
          const male = ctx.male
          const bands = male
            ? (ctx.age >= 60 ? [17, 21.5, 18.5] : [17.5, 22.5, 19.2])
            : (ctx.age >= 60 ? [14.5, 18, 15.6] : [15, 18.5, 16.2])
          return { L: bands[0], U: bands[1], M: bands[2], margin: 2 }
        },
      },
      {
        id: 'derived_bmr',
        label: '去脂基础代谢',
        unit: 'kcal',
        gapUnit: ' kcal',
        domain: 5,
        weight: 0.8,
        kind: 'slow',
        precision: 0,
        source: '二次派生：Katch-McArdle / Cunningham 370 + 21.6 × 去脂体重',
        standard: 'Katch-McArdle 去脂代谢方程（保肌代谢护栏）',
        bounds(ctx) {
          const L = ctx.male ? 21.5 * ctx.heightSq * 24 : 19.5 * ctx.heightSq * 22
          return { L, U: Infinity, M: null, margin: 200 }
        },
      },
    ]

    function focusNumber(value) {
      return typeof value === 'number' && Number.isFinite(value) ? value : null
    }

    function focusMean(values) {
      const numbers = values.filter((value) => focusNumber(value) !== null)
      return numbers.length ? numbers.reduce((sum, value) => sum + value, 0) / numbers.length : null
    }

    function focusSd(values) {
      const numbers = values.filter((value) => focusNumber(value) !== null)
      if (numbers.length < 2) return null
      const mean = numbers.reduce((sum, value) => sum + value, 0) / numbers.length
      return Math.sqrt(numbers.reduce((sum, value) => sum + (value - mean) ** 2, 0) / numbers.length)
    }

    function focusLastValidIndex(values, from) {
      const start = from === undefined ? values.length - 1 : Math.min(from, values.length - 1)
      for (let i = start; i >= 0; i -= 1) {
        if (focusNumber(values[i]) !== null) return i
      }
      return -1
    }

    function focusRound(value, digits) {
      const factor = 10 ** digits
      return Math.round(value * factor) / factor
    }

    function focusFixed(value, digits) {
      if (focusNumber(value) === null) return '—'
      return Number(value).toLocaleString('zh-CN', {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      })
    }

    function focusSigned(value, digits) {
      if (focusNumber(value) === null) return '—'
      const text = focusFixed(Math.abs(value), digits)
      return value > 0 ? '+' + text : value < 0 ? '-' + text : text
    }

    function focusProfileClean(input) {
      const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {}
      const year = Number.parseInt(String(source.birth_year), 10)
      const height = Number.parseFloat(String(source.height_cm))
      return {
        birth_year: Number.isInteger(year) && year >= 1920 && year <= 2020 ? year : DEFAULT_PROFILE.birth_year,
        sex: source.sex === 'female' ? 'female' : 'male',
        height_cm: Number.isFinite(height) && height >= 100 && height <= 230
          ? Math.round(height * 10) / 10
          : DEFAULT_PROFILE.height_cm,
      }
    }

    function focusAgeOf(profile) {
      return new Date(Date.now() + 8 * 3600 * 1000).getUTCFullYear() - profile.birth_year
    }

    function focusNormalizeSeries(values, len) {
      const out = new Array(len).fill(null)
      if (!Array.isArray(values)) return out
      for (let i = 0; i < len && i < values.length; i += 1) {
        out[i] = focusNumber(values[i])
      }
      return out
    }

    function focusBuildMatrix(healthData, profile) {
      const trend = healthData && healthData.trend ? healthData.trend : null
      const window = trend && Array.isArray(trend.window) ? trend.window.slice() : []
      const len = window.length
      const heightM = Math.max(0.5, Number(profile.height_cm) || DEFAULT_PROFILE.height_cm) / 100
      const heightSq = heightM * heightM
      const raw = new Map()
      if (trend && Array.isArray(trend.metrics)) {
        for (const metric of trend.metrics) {
          if (!metric || typeof metric.id !== 'string') continue
          raw.set(metric.id, focusNormalizeSeries(metric.values, len))
        }
      }
      const at = (id) => raw.get(id) || new Array(len).fill(null)
      const bodyMass = at('body_mass')
      const bodyFat = at('body_fat')
      const leanMass = at('lean_body_mass')
      const rawBmi = at('bmi')
      const rawHeight = at('height')
      const lastHeightIndex = focusLastValidIndex(rawHeight)
      const scaleHeightCm = lastHeightIndex >= 0 ? rawHeight[lastHeightIndex] : null
      const derivedBmi = window.map((_, index) => {
        if (focusNumber(bodyMass[index]) !== null) return bodyMass[index] / heightSq
        if (focusNumber(rawBmi[index]) === null) return null
        if (focusNumber(scaleHeightCm) === null) return rawBmi[index]
        return rawBmi[index] * (scaleHeightCm / (heightM * 100)) ** 2
      })
      const fatMass = window.map((_, index) => {
        if (focusNumber(bodyMass[index]) !== null && focusNumber(bodyFat[index]) !== null) {
          return bodyMass[index] * bodyFat[index] / 100
        }
        if (focusNumber(bodyMass[index]) !== null && focusNumber(leanMass[index]) !== null) {
          return bodyMass[index] - leanMass[index]
        }
        return null
      })
      const derivedFfmi = leanMass.map((value) => (focusNumber(value) === null ? null : value / heightSq))
      const derivedFmi = fatMass.map((value) => (focusNumber(value) === null ? null : value / heightSq))
      const derivedBmr = leanMass.map((value) => (focusNumber(value) === null ? null : 370 + 21.6 * value))
      const workout = at('workout')
      const exercise = at('exercise')
      const dailyMove = workout.some((value) => focusNumber(value) !== null) ? workout : exercise
      const weeklyRolling = window.map((_, index) => {
        const slice = dailyMove.slice(Math.max(0, index - 6), index + 1).filter((value) => focusNumber(value) !== null)
        return slice.length ? slice.reduce((sum, value) => sum + value, 0) : null
      })
      const series = new Map(raw)
      series.set('derived_bmi', derivedBmi)
      series.set('derived_fat_mass', fatMass)
      series.set('derived_ffmi', derivedFfmi)
      series.set('derived_fmi', derivedFmi)
      series.set('derived_bmr', derivedBmr)
      series.set('weekly_exercise', weeklyRolling)
      return {
        window,
        len,
        at,
        series,
        heightM,
        heightSq,
        bodyMass,
        bodyFat,
        leanMass,
        fatMass,
        derivedBmi,
        derivedFfmi,
        derivedFmi,
        derivedBmr,
        lastHeightCm: scaleHeightCm,
        workoutCount: healthData && healthData.workouts ? healthData.workouts.count : null,
      }
    }

    function focusEndState(healthData, matrix) {
      if (!matrix.len) return { endIdx: 0, truncated: false }
      const latest = healthData ? healthData.latest_source_date : null
      const lastIndex = matrix.len - 1
      const steps = matrix.at('steps')[lastIndex]
      const basal = matrix.at('basal_energy')[lastIndex]
      const truncated = Boolean(
        latest && matrix.window[lastIndex] === latest
        && focusNumber(steps) !== null && steps < 2500
        && focusNumber(basal) !== null && basal < 1200,
      )
      return { endIdx: truncated ? lastIndex : matrix.len, truncated }
    }

    function focusSeriesStats(values, endIdx) {
      const window = values.slice(0, endIdx)
      const stats = healthTrendStatistics(window)
      return {
        mean30: focusMean(window),
        sd30: focusSd(window),
        slope: stats.regression ? stats.regression.slope : null,
      }
    }

    function focusMeanOf(ctx, metricId) {
      const stats = ctx.stats.get(metricId)
      return stats ? stats.mean30 : null
    }

    function focusDailyMean(values, endIdx) {
      return focusMean(values.slice(Math.max(0, endIdx - 7), endIdx))
    }

    function focusResolveValue(def, healthData, matrix, ctx) {
      const values = matrix.series.get(def.id) || matrix.at(def.id)
      if (def.kind === 'slow') {
        const lastIndex = focusLastValidIndex(values)
        if (lastIndex < 0) return null
        const prevIndex = focusLastValidIndex(values, lastIndex - 1)
        return {
          x: values[lastIndex],
          lastIndex,
          prevIndex,
          lastDate: matrix.window[lastIndex],
          latestDaily: values[lastIndex],
          latestDate: matrix.window[lastIndex],
          sampleN: values.filter((value) => focusNumber(value) !== null).length,
          delta: prevIndex >= 0 ? values[lastIndex] - values[prevIndex] : null,
        }
      }
      const windowStart = Math.max(0, ctx.endIdx - 7)
      const slice = values.slice(windowStart, ctx.endIdx)
      const lastValid = focusLastValidIndex(slice)
      if (lastValid >= 0) {
        const x = focusMean(slice)
        const mean30 = focusMean(values.slice(0, ctx.endIdx))
        return {
          x,
          lastIndex: windowStart + lastValid,
          lastDate: matrix.window[windowStart + lastValid],
          latestDaily: slice[lastValid],
          latestDate: matrix.window[windowStart + lastValid],
          sampleN: slice.filter((value) => focusNumber(value) !== null).length,
          delta: mean30 === null ? null : x - mean30,
        }
      }
      const fallbackIndex = focusLastValidIndex(values)
      if (fallbackIndex < 0) return null
      return {
        x: values[fallbackIndex],
        lastIndex: fallbackIndex,
        lastDate: matrix.window[fallbackIndex],
        latestDaily: values[fallbackIndex],
        latestDate: matrix.window[fallbackIndex],
        sampleN: 1,
        delta: null,
        fallback: true,
      }
    }

    function focusScore(def, ctx, value) {
      const bounds = def.bounds(ctx)
      const stats = ctx.stats.get(def.id) || { mean30: null, sd30: null, slope: null }
      const x = value.x
      const L = bounds.L
      const U = bounds.U
      const ideal = focusNumber(bounds.M)
      let dev
      if (x > U) dev = Math.min(1.5, 0.35 + 0.65 * (x - U) / bounds.margin)
      else if (x < L) dev = Math.min(1.5, 0.35 + 0.65 * (L - x) / bounds.margin)
      else {
        const half = Number.isFinite(L) && Number.isFinite(U) ? (U - L) / 2 : bounds.margin
        dev = ideal === null ? 0 : 0.12 * Math.min(1, Math.abs(x - ideal) / (half || 1))
      }
      let trend = 0
      if (focusNumber(stats.slope) !== null) {
        const span = Number.isFinite(U) ? (U - L) : bounds.margin
        const impact = Math.min(1, Math.abs(stats.slope) * 30 / (span || 1))
        if ((x > U && stats.slope > 0) || (x < L && stats.slope < 0)) trend = 0.15 + 0.2 * impact
        else if ((x > U && stats.slope < 0) || (x < L && stats.slope > 0)) trend = -(0.1 + 0.05 * impact)
      }
      let persist = 0
      if (def.kind === 'slow') {
        const outside = x > U || x < L
        if (outside) {
          const lastIndex = value.lastIndex
          const recent = (ctx.matrix.series.get(def.id) || ctx.matrix.at(def.id))
            .slice(Math.max(0, lastIndex - 13), lastIndex + 1)
            .filter((item) => focusNumber(item) !== null)
          const recentMean = focusMean(recent)
          persist = focusNumber(recentMean) !== null && (x > U ? recentMean > U : recentMean < L) ? 1 : 0.5
        }
      } else {
        const scoredWindow = (ctx.matrix.series.get(def.id) || ctx.matrix.at(def.id))
          .slice(Math.max(0, ctx.endIdx - 7), ctx.endIdx)
          .filter((item) => focusNumber(item) !== null)
        persist = scoredWindow.length
          ? scoredWindow.filter((item) => item > U || item < L).length / scoredWindow.length
          : 0
      }
      const mean30 = stats.mean30
      const sd30 = stats.sd30
      const z = focusNumber(mean30) !== null && focusNumber(sd30) !== null && sd30 > 0
        ? Math.abs((x - mean30) / sd30)
        : 0
      const baseline = Math.min(1, Math.max(0, (z - 0.8) / 1.5))
      const gapDays = value.lastIndex >= 0 ? (ctx.matrix.len - 1 - value.lastIndex) : 999
      const fresh = def.kind === 'daily' && gapDays > 14 ? 0.2 : 1
      const raw = def.weight * (0.55 * dev + 0.2 * trend + 0.15 * persist + 0.1 * baseline) * fresh
      const pas = Math.round(100 * Math.min(1, Math.max(0, raw)))
      const status = x > U ? '偏高' : x < L ? '不足' : '标准'
      const gap = x > U ? x - U : x < L ? L - x : 0
      return {
        bounds,
        stats,
        dev,
        trend,
        persist,
        baseline,
        fresh,
        pas,
        status,
        gap,
        dir: x > U ? 'down' : x < L ? 'up' : 'flat',
      }
    }

    function focusRangeText(bounds, unit, digits) {
      const L = bounds.L
      const U = bounds.U
      const d = digits === undefined ? 1 : digits
      if (Number.isFinite(L) && Number.isFinite(U)) return '[' + focusFixed(L, d) + ', ' + focusFixed(U, d) + ']' + unit
      if (Number.isFinite(L)) return '≥ ' + focusFixed(L, d) + unit
      if (Number.isFinite(U)) return '≤ ' + focusFixed(U, d) + unit
      return '—'
    }

    function focusZoneKey(bodyFat, bmi, male) {
      const x1 = male ? 10 : 18
      const x2 = male ? 20 : 28
      const table = [
        ['athlete', 'overweight', 'obese'],
        ['muscular', 'healthy', 'hiddenFat'],
        ['thin', 'slimMuscular', 'slim'],
      ]
      const row = bmi >= 24 ? 0 : bmi >= 18.5 ? 1 : 2
      const col = bodyFat < x1 ? 0 : bodyFat <= x2 ? 1 : 2
      return { key: table[row][col], row, col }
    }

    function focusBodyGrid(matrix, profile) {
      const male = profile.sex === 'male'
      const xAxis = male
        ? { min: 4, max: 30, cut1: 10, cut2: 20 }
        : { min: 10, max: 38, cut1: 18, cut2: 28 }
      const yAxis = { min: 15, max: 29.5, cut1: 18.5, cut2: 24 }
      const bodyFat = matrix.series.get('body_fat') || matrix.at('body_fat')
      const bmi = matrix.derivedBmi
      const interpolate = (values, index) => {
        const left = focusLastValidIndex(values, index - 1)
        let right = -1
        for (let i = index + 1; i < values.length; i += 1) {
          if (focusNumber(values[i]) !== null) { right = i; break }
        }
        if (left >= 0 && right >= 0) {
          const value = values[left] + ((index - left) / (right - left)) * (values[right] - values[left])
          return focusNumber(value)
        }
        return null
      }
      const start = Math.max(0, matrix.len - 15)
      const points = []
      for (let index = start; index < matrix.len; index += 1) {
        let fat = bodyFat[index]
        let mass = bmi[index]
        let interpolated = false
        if (focusNumber(fat) === null) {
          fat = interpolate(bodyFat, index)
          interpolated = interpolated || focusNumber(fat) !== null
        }
        if (focusNumber(mass) === null) {
          mass = interpolate(bmi, index)
          interpolated = interpolated || focusNumber(mass) !== null
        }
        if (focusNumber(fat) === null || focusNumber(mass) === null) continue
        const zone = focusZoneKey(fat, mass, male)
        points.push({
          date: matrix.window[index],
          bodyFat: fat,
          bmi: mass,
          interpolated,
          zone: zone.key,
          row: zone.row,
          col: zone.col,
        })
      }
      for (let i = 0; i < points.length; i += 1) {
        const ratio = points.length <= 1 ? 1 : i / (points.length - 1)
        points[i].alpha = focusRound(0.15 + 0.85 * ratio ** 1.6, 3)
        points[i].radius = focusRound(2.2 + 2.3 * ratio, 2)
        points[i].width = focusRound(1.2 + 1.2 * ratio, 2)
      }
      return {
        male,
        xAxis,
        yAxis,
        points,
        current: points.length ? points[points.length - 1] : null,
        zoneLabel: points.length ? FOCUS_ZONES[points[points.length - 1].zone].label : '—',
      }
    }

    function evaluateHealthFocus(healthData, checkinsData, profile) {
      const clean = focusProfileClean(profile)
      const age = focusAgeOf(clean)
      const male = clean.sex === 'male'
      const base = {
        available: false,
        profile: { ...clean, age, male },
        cards: [],
        targets: [],
        score: null,
        advice: '',
        grid: null,
        values: {},
        stale: [],
        truncated: false,
        windowEnd: null,
      }
      const matrix = focusBuildMatrix(healthData, clean)
      if (!matrix.len) return { ...base, reason: '暂无健康趋势窗口' }
      const endState = focusEndState(healthData, matrix)
      const ctx = {
        age,
        male,
        heightM: matrix.heightM,
        heightSq: matrix.heightSq,
        endIdx: endState.endIdx,
        truncated: endState.truncated,
        matrix,
        stats: new Map(),
      }
      for (const def of FOCUS_METRICS) {
        ctx.stats.set(def.id, focusSeriesStats(matrix.series.get(def.id) || matrix.at(def.id), ctx.endIdx))
      }
      const lastOf = (id) => {
        const values = matrix.series.get(id) || matrix.at(id)
        const index = focusLastValidIndex(values)
        return index < 0 ? null : values[index]
      }
      const currentMass = lastOf('body_mass')
      const currentBodyFat = lastOf('body_fat')
      const currentLean = lastOf('lean_body_mass')
      const currentBmi = lastOf('derived_bmi')
      const currentRawBmi = lastOf('bmi')
      const currentFatMass = lastOf('derived_fat_mass')
      const currentFfmi = lastOf('derived_ffmi')
      const currentFmi = lastOf('derived_fmi')
      const currentBmr = lastOf('derived_bmr')
      const walkingHr = focusDailyMean(matrix.at('walking_hr'), ctx.endIdx)
      const restingHr7 = focusDailyMean(matrix.at('resting_hr'), ctx.endIdx)
      const deltaHr = focusNumber(walkingHr) !== null && focusNumber(restingHr7) !== null ? walkingHr - restingHr7 : null
      const boundaryWeight = 24 * matrix.heightSq
      const idealWeight = 22 * matrix.heightSq
      const weightCut = focusNumber(currentMass) !== null ? currentMass - boundaryWeight : null
      const bodyFatDef = FOCUS_METRICS.find((item) => item.id === 'body_fat')
      const bodyFatBounds = bodyFatDef.bounds(ctx)
      const fatCut = focusNumber(currentFatMass) !== null && focusNumber(currentLean) !== null
        ? currentFatMass - (currentLean / (1 - bodyFatBounds.U / 100)) * (bodyFatBounds.U / 100)
        : null
      const targetTotalWeight = focusNumber(currentLean) === null || focusNumber(bodyFatBounds.U) === null
        ? null
        : currentLean / (1 - bodyFatBounds.U / 100)
      const targetFatMass = targetTotalWeight === null ? null : targetTotalWeight * bodyFatBounds.U / 100

      const withOverrides = (def, value) => {
        if (!value) return value
        if (def.id === 'sleep') {
          const average = Number(healthData && healthData.sleep_average)
          if (Number.isFinite(average) && average > 0) {
            const mean30 = ctx.stats.get('sleep').mean30
            return {
              ...value,
              x: average,
              delta: focusNumber(mean30) === null ? null : average - mean30,
              sampleN: Number(healthData.sleep_days) || value.sampleN || 0,
              sleepAverage: true,
            }
          }
        }
        if (def.id === 'weekly_exercise') {
          const total = Math.max(
            Number(healthData && healthData.workouts && healthData.workouts.total_minutes) || 0,
            Number(healthData && healthData.exercise_total) || 0,
          )
          if (total > 0) {
            const latest = healthData && healthData.workouts ? healthData.workouts.latest_workout_date : null
            const lastIndex = latest ? matrix.window.lastIndexOf(latest) : value.lastIndex
            return {
              ...value,
              x: total,
              lastIndex: lastIndex >= 0 ? lastIndex : value.lastIndex,
              lastDate: latest || value.lastDate,
              weeklyTotal: true,
            }
          }
        }
        return value
      }

      const sourceTextOf = (def) => {
        if (def.id === 'derived_bmi' && focusNumber(currentMass) !== null && focusNumber(currentBmi) !== null) {
          return '二次派生：体重 ' + focusFixed(currentMass, 1) + 'kg ÷ 身高 ' + focusFixed(clean.height_cm / 100, 2) + 'm² = ' + focusFixed(currentBmi, 2)
            + (focusNumber(currentRawBmi) === null ? '' : '（秤端原始 BMI ' + focusFixed(currentRawBmi, 1) + ' 仅供参考）')
        }
        if (def.id === 'derived_fat_mass' && focusNumber(currentFatMass) !== null) {
          return '二次派生：体重 ' + focusFixed(currentMass, 1) + 'kg × 体脂率 ' + focusFixed(currentBodyFat, 1) + '% = ' + focusFixed(currentFatMass, 2) + 'kg'
        }
        if (def.id === 'derived_ffmi' && focusNumber(currentFfmi) !== null) {
          return '二次派生：去脂体重 ' + focusFixed(currentLean, 1) + 'kg ÷ 身高 ' + focusFixed(clean.height_cm / 100, 2) + 'm² = ' + focusFixed(currentFfmi, 2)
        }
        if (def.id === 'derived_fmi' && focusNumber(currentFmi) !== null) {
          return '二次派生：脂肪量 ' + focusFixed(currentFatMass, 2) + 'kg ÷ 身高 ' + focusFixed(clean.height_cm / 100, 2) + 'm² = ' + focusFixed(currentFmi, 2)
        }
        if (def.id === 'derived_bmr' && focusNumber(currentBmr) !== null) {
          return '二次派生：370 + 21.6 × 去脂体重 ' + focusFixed(currentLean, 1) + 'kg = ' + focusFixed(currentBmr, 0) + ' kcal'
        }
        return def.source
      }

      const cardFor = (entry) => {
        const def = entry.def
        const value = entry.value
        const score = entry.score
        const precision = def.precision
        const gapPrecision = def.id === 'sleep' ? 2 : precision
        const valueText = focusFixed(value.x, precision)
        const rangeText = focusRangeText(score.bounds, def.unit === '%' ? '%' : def.unit ? ' ' + def.unit : '', Math.min(precision, 1))
        const gapText = score.status === '标准'
          ? '在健康区间内'
          : score.status === '偏高'
            ? '超上限 +' + focusFixed(score.gap, gapPrecision) + (def.gapUnit || '')
            : '差 -' + focusFixed(score.gap, gapPrecision) + (def.gapUnit || '')
        const deltaPrecision = def.id === 'sleep' ? 2 : precision
        const deltaText = focusNumber(value.delta) === null || Math.abs(value.delta) < (10 ** -deltaPrecision) / 2
          ? ''
          : (value.delta > 0 ? '↑' : '↓') + focusFixed(Math.abs(value.delta), deltaPrecision)
        let scopeText
        if (def.kind === 'slow') scopeText = value.lastDate + ' 最新实测'
        else if (value.sleepAverage) scopeText = '近 7 日有效入睡记录均值（' + value.sampleN + ' 天有记录）'
        else if (value.weeklyTotal) scopeText = '近 7 日训练明细累计（' + (matrix.workoutCount === null ? '—' : matrix.workoutCount) + ' 次训练）'
        else if (value.fallback) scopeText = '近 7 日无完结记录，取 ' + value.lastDate + ' 最近一次实测'
        else scopeText = '近 7 个完结日有效均值（' + value.sampleN + ' 天有效，最新 ' + value.latestDate + ' ' + focusFixed(value.latestDaily, precision) + ' ' + def.unit + '）'
        const standardText = '基于 ' + age + '岁 · ' + (male ? '男' : '女') + ' · ' + focusFixed(clean.height_cm, 1) + 'cm：健康区间 ' + rangeText
          + (focusNumber(score.bounds.M) === null ? '' : ' · 理想 ' + focusFixed(score.bounds.M, 1)) + '（' + def.standard + '）'
        const scoreText = 'PAS 关注分 ' + score.pas + '/100（权重 ' + def.weight.toFixed(2) + ' · 边界差距 ' + focusSigned(score.gap, gapPrecision) + (def.gapUnit || '') + '）'
        let actionText = ''
        if (score.status !== '标准') {
          if (def.id === 'body_fat' && focusNumber(fatCut) !== null) actionText = '还需减脂 ' + focusFixed(Math.max(0, fatCut), 1) + 'kg'
          else if (def.id === 'derived_bmi' && focusNumber(weightCut) !== null) actionText = '还需减重 ' + focusFixed(Math.max(0, weightCut), 1) + 'kg'
          else if (def.id === 'sleep') actionText = '每晚需 +' + Math.round(score.gap * 60) + ' 分钟'
        }
        let subText = ''
        if (def.id === 'derived_bmi' && focusNumber(currentMass) !== null) subText = '体重 ' + focusFixed(currentMass, 1) + 'kg'
        else if (def.id === 'body_fat' && focusNumber(currentFatMass) !== null) {
          subText = '脂肪量 ' + focusFixed(currentFatMass, 1) + 'kg' + (focusNumber(currentFmi) === null ? '' : ' · FMI ' + focusFixed(currentFmi, 1))
        } else if (def.id === 'derived_ffmi' && focusNumber(currentLean) !== null) subText = '去脂体重 ' + focusFixed(currentLean, 1) + 'kg'
        else if (def.id === 'resting_hr' && focusNumber(deltaHr) !== null) subText = '步行心率负荷差 ΔHR ' + focusFixed(deltaHr, 1) + ' bpm'
        else if (def.id === 'weekly_exercise' && matrix.workoutCount !== null) subText = '近 7 日 ' + matrix.workoutCount + ' 次训练'
        return {
          id: def.id,
          label: def.label,
          unit: def.unit,
          domain: def.domain,
          domainLabel: FOCUS_DOMAIN_LABELS[def.domain - 1],
          weight: def.weight,
          pas: score.pas,
          status: score.status,
          tone: score.status === '标准' ? 'good' : 'warn',
          valueText,
          deltaText,
          gapText,
          actionText,
          subText,
          scopeText,
          sourceText: sourceTextOf(def),
          standardText,
          scoreText,
          bounds: score.bounds,
          x: value.x,
          gap: score.gap,
          gapPrecision,
          gapUnit: def.gapUnit || '',
          precision,
          explain: [
            { label: '指标来源', text: sourceTextOf(def) },
            { label: '取值口径', text: scopeText },
            { label: '对比标准', text: standardText },
            { label: '关注评分', text: scoreText },
          ],
        }
      }

      const scored = []
      for (const def of FOCUS_METRICS) {
        const resolved = withOverrides(def, focusResolveValue(def, healthData, matrix, ctx))
        if (!resolved) continue
        scored.push({ def, value: resolved, score: focusScore(def, ctx, resolved) })
      }
      const cards = scored.map(cardFor).sort((a, b) => b.pas - a.pas)
      const byDomain = new Map()
      for (const card of cards) {
        if (!byDomain.has(card.domain)) byDomain.set(card.domain, card)
      }
      const picked = Array.from(byDomain.values())
      const usedHomology = new Set(picked.map((card) => FOCUS_HOMOLOGY[card.id]).filter(Boolean))
      const wildcard = cards.find((card) => !picked.includes(card)
        && !(FOCUS_HOMOLOGY[card.id] && usedHomology.has(FOCUS_HOMOLOGY[card.id])))
      const top = (wildcard ? picked.concat([wildcard]) : picked).sort((a, b) => b.pas - a.pas)
      const weightSum = top.reduce((sum, card) => sum + card.weight, 0)
      const pasSum = top.reduce((sum, card) => sum + card.weight * card.pas, 0)
      const score = top.length > 0 && weightSum > 0 ? Math.round(100 - 35 * (pasSum / weightSum) / 100) : null
      const improving = top.filter((card) => card.status !== '标准').slice(0, 2)
      const guardCandidates = top.filter((card) => card.status === '标准')
      const guard = guardCandidates.find((card) => card.id === 'derived_ffmi' || card.id === 'derived_bmr')
        || guardCandidates.slice().sort((a, b) => b.weight - a.weight)[0]
      const segments = []
      if (improving.length) segments.push('最需改进：' + improving.map((card) => card.label + '（' + card.gapText + '）').join('、'))
      if (guard) segments.push('护栏：' + guard.label + ' ' + guard.valueText + guard.unit + ' ' + guard.status + '，继续保持')
      const advice = segments.length ? segments.join('；') + '。' : '当前关注项均在健康区间内，保持现有节奏。'

      const targets = []
      const findCard = (id) => cards.find((card) => card.id === id)
      if (focusNumber(currentMass) !== null) {
        targets.push({
          id: 'boundary_weight',
          label: '健康边界体重',
          valueText: focusFixed(boundaryWeight, 1) + ' kg',
          gapText: 'BMI 24.0 × 身高 ' + focusFixed(clean.height_cm / 100, 2) + 'm²',
          tone: 'flat',
          explain: [
            { label: '指标来源', text: 'WS/T 428-2013《成人体重判定》：BMI 24.0 为超重下限' },
            { label: '取值口径', text: '身高基准 ' + focusFixed(clean.height_cm, 1) + 'cm（可在生理基准中修改）' },
            { label: '对比标准', text: '理想 BMI 22.0 对应体重 ' + focusFixed(idealWeight, 1) + 'kg' },
          ],
        })
      }
      if (focusNumber(currentMass) !== null && focusNumber(weightCut) !== null) {
        const reached = weightCut <= 0.05
        targets.push({
          id: 'weight_control',
          label: '体重控制目标',
          valueText: reached ? '已达标' : '-' + focusFixed(weightCut, 1) + ' kg',
          gapText: '当前 ' + focusFixed(currentMass, 1) + 'kg → ' + focusFixed(boundaryWeight, 1) + 'kg',
          tone: reached ? 'good' : 'warn',
          explain: [
            { label: '指标来源', text: '当前体重 − 健康边界体重 = ' + focusFixed(currentMass, 1) + ' − ' + focusFixed(boundaryWeight, 1) },
            { label: '取值口径', text: '最新一次体测 ' + focusFixed(currentMass, 1) + 'kg' },
            { label: '对比标准', text: 'BMI 24.0 健康上限；理想 BMI 22.0 对应 ' + focusFixed(idealWeight, 1) + 'kg' },
          ],
        })
      }
      if (focusNumber(fatCut) !== null && focusNumber(currentFatMass) !== null && focusNumber(targetFatMass) !== null) {
        const reached = fatCut <= 0.05
        targets.push({
          id: 'fat_control',
          label: '保肌脂肪控制',
          valueText: reached ? '已达标' : '-' + focusFixed(fatCut, 1) + ' kg',
          gapText: '守住去脂体重 ' + focusFixed(currentLean, 1) + 'kg：目标总重 ' + focusFixed(targetTotalWeight, 1) + 'kg · 目标脂肪 ' + focusFixed(targetFatMass, 1) + 'kg',
          tone: reached ? 'good' : 'warn',
          explain: [
            { label: '指标来源', text: '目标总重 = 去脂体重 ÷ (1 − 体脂上限%)；目标脂肪 = 目标总重 × 体脂上限%' },
            { label: '取值口径', text: '去脂体重 ' + focusFixed(currentLean, 1) + 'kg 保持不变，当前脂肪量 ' + focusFixed(currentFatMass, 1) + 'kg' },
            { label: '对比标准', text: '体脂率上限 ' + focusFixed(bodyFatBounds.U, 1) + '%（' + age + '岁 · ' + (male ? '男' : '女') + '）' },
          ],
        })
      }
      if (focusNumber(currentFfmi) !== null || focusNumber(currentBmr) !== null) {
        const parts = []
        if (focusNumber(currentLean) !== null) parts.push('LBM ' + focusFixed(currentLean, 1) + 'kg')
        if (focusNumber(currentFfmi) !== null) parts.push('FFMI ' + focusFixed(currentFfmi, 1))
        if (focusNumber(currentBmr) !== null) parts.push('BMR ' + focusFixed(currentBmr, 0) + ' kcal')
        targets.push({
          id: 'muscle_guardrail',
          label: '肌肉与代谢护栏',
          valueText: '继续保持',
          gapText: parts.join(' · '),
          tone: 'good',
          explain: [
            { label: '指标来源', text: 'FFMI = 去脂体重 ÷ 身高²；BMR = 370 + 21.6 × 去脂体重' },
            { label: '取值口径', text: '最新一次体测的体成分数据' },
            { label: '对比标准', text: 'FFMI 健康区间与 BMR 保肌代谢下限（Katch-McArdle）' },
          ],
        })
      }
      const sleepCard = findCard('sleep')
      if (sleepCard) {
        targets.push({
          id: 'sleep_gap',
          label: '睡眠补齐',
          valueText: sleepCard.status === '标准' ? '已达标' : '+' + Math.round(sleepCard.gap * 60) + ' 分钟/晚',
          gapText: '近 7 日均 ' + sleepCard.valueText + ' 小时 → ' + focusFixed(sleepCard.bounds.L, 1) + ' 小时',
          tone: sleepCard.status === '标准' ? 'good' : 'warn',
          explain: sleepCard.explain,
        })
      }
      const weeklyCard = findCard('weekly_exercise')
      if (weeklyCard) {
        targets.push({
          id: 'weekly_gap',
          label: '周运动补齐',
          valueText: weeklyCard.status === '标准' ? '已达标' : '+' + focusFixed(weeklyCard.gap, weeklyCard.gapPrecision) + ' 分钟/周',
          gapText: '近 7 日 ' + weeklyCard.valueText + ' 分钟 → ' + focusFixed(weeklyCard.bounds.L, 0) + ' 分钟/周',
          tone: weeklyCard.status === '标准' ? 'good' : 'warn',
          explain: weeklyCard.explain,
        })
      }
      const stepsCard = findCard('steps')
      if (stepsCard) {
        targets.push({
          id: 'steps_gap',
          label: '日常步数补齐',
          valueText: stepsCard.status === '标准' ? '已达标' : '+' + focusFixed(stepsCard.gap, stepsCard.gapPrecision) + ' 步/天',
          gapText: '近 7 日完结日均 ' + stepsCard.valueText + ' → ' + focusFixed(stepsCard.bounds.L, 0) + ' 步/天',
          tone: stepsCard.status === '标准' ? 'good' : 'warn',
          explain: stepsCard.explain,
        })
      }

      const stale = scored.filter((entry) => entry.score.fresh < 1).map((entry) => entry.def.label)
      return {
        available: true,
        profile: { ...clean, age, male },
        cards: top,
        targets,
        score,
        advice,
        grid: focusBodyGrid(matrix, clean),
        values: {
          mass: currentMass,
          bodyFat: currentBodyFat,
          lean: currentLean,
          bmi: currentBmi,
          fatMass: currentFatMass,
          ffmi: currentFfmi,
          fmi: currentFmi,
          bmr: currentBmr,
          deltaHr,
          boundaryWeight,
          idealWeight,
          weightCut,
          fatCut,
        },
        stale,
        truncated: endState.truncated,
        latestHeight: matrix.lastHeightCm,
        windowEnd: matrix.window[matrix.len - 1],
      }
    }

    /* #endregion focus-engine */

    function detectSyncIssue(folder) {
      if (!folder) return null
      if (folder.snapshot_error) {
        return '健康导出文件已处理，但汇总快照更新异常。'
      }
      if (Number(folder.errors) > 0) {
        return `健康导出存在 ${folder.errors} 份导入异常，请在「手机同步」页面查看详情。`
      }
      return null
    }

    /** Left Sidebar Heart + Pulse SVG Icon */
    function HealthSidebarIcon({ size = 18 }) {
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.75,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': 'true',
        },
        h('path', { d: 'M19.5 12.572 12 20l-7.5-7.428A5 5 0 1 1 12 6.006a5 5 0 1 1 7.5 6.572' }),
        h('path', { d: 'M8 12h2l1.2-2.5L13 14.5 14.2 12H16' }),
      )
    }

    /** Single Trend Chart Card (metric select + 30/90/365 segmented period control) */
    function TrendChartCard({ slotIndex, trendData, metricsList, activeMetricId, days, onSelectMetric, onSelectPeriod }) {
      const active = useMemo(
        () => metricsList.find(m => m.id === activeMetricId) || metricsList[0] || null,
        [metricsList, activeMetricId],
      )
      if (!active) {
        return h('div', { className: 'dsh-3b-card' }, h('p', { className: 'dsh-3b-empty' }, `趋势图 ${slotIndex + 1} 暂无可用指标`))
      }

      const { dates, values, limited, loadedDays } = healthTrendSeries(trendData, active, days)
      const { average, regression } = healthTrendStatistics(values)
      const numbers = values.filter(v => v !== null)
      const maximum = numbers.length ? Math.max(...numbers) : null
      const minimum = numbers.length ? Math.min(...numbers) : null
      const signed = minimum !== null && minimum < 0
      const low = signed ? minimum : Math.max(0, 2 * (minimum ?? 0) - (maximum ?? 0))
      const high = signed
        ? Math.max(0, maximum ?? 0)
        : Math.max(low, Math.min((maximum ?? 0) * 1.2, 2 * (maximum ?? 0) - (minimum ?? 0)))
      const flat = low === high
      const span = high - low || 1
      const ticks = flat ? [low] : [high, low + (high - low) / 2, low]
      const yCoord = val => (flat ? 80 : 160 - ((val - low) / span) * 160)
      const xCoord = idx => ((idx + 0.5) / Math.max(1, values.length)) * 1000

      const validPoints = values.flatMap((v, idx) => (v == null ? [] : [{ date: dates[idx], value: v }]))
      const latestObs = validPoints[validPoints.length - 1] || null

      return h(
        'section',
        { className: 'dsh-3b-card' },
        h(
          'div',
          { className: 'dsh-3b-chart-controls' },
          h(
            'select',
            {
              className: 'dsh-3b-select',
              value: active.id,
              'aria-label': `趋势 ${slotIndex + 1} 指标`,
              onChange: e => onSelectMetric(slotIndex, e.target.value),
            },
            metricsList.map(m => h('option', { key: m.id, value: m.id }, healthTrendLabel(m))),
          ),
          h(
            'div',
            { className: 'dsh-3b-seg', role: 'group', 'aria-label': `趋势 ${slotIndex + 1} 时间段` },
            PERIOD_OPTIONS.map(d => h(
              'button',
              {
                key: d,
                type: 'button',
                'aria-pressed': days === d,
                onClick: () => onSelectPeriod(slotIndex, d),
              },
              `${d}天`,
            )),
          ),
        ),
        numbers.length > 0
          ? h(
            React.Fragment,
            null,
            h(
              'div',
              { className: 'dsh-3b-plot-wrap' },
              h(
                'div',
                { className: 'dsh-3b-yaxis' },
                ticks.map((t, i) => h('span', { key: i }, formatNum(t, 1))),
              ),
              h(
                'div',
                {
                  className: 'dsh-3b-bars',
                  style: {
                    gridTemplateColumns: `repeat(${values.length}, minmax(0, 1fr))`,
                    columnGap: values.length > 90 ? '0px' : values.length > 30 ? '1px' : '2px',
                  },
                },
                h('div', { className: 'dsh-3b-gridline dsh-3b-gridline-1', 'aria-hidden': 'true' }),
                h('div', { className: 'dsh-3b-gridline dsh-3b-gridline-2', 'aria-hidden': 'true' }),
                values.map((v, idx) => {
                  const pct = v == null ? 0 : flat ? 50 : Math.max(2, ((v - low) / span) * 100)
                  return h(
                    'div',
                    {
                      key: idx,
                      className: 'dsh-3b-bar-slot',
                      title: `${dates[idx] || ''}：${v == null ? '无记录' : `${formatNum(v, 2)} ${active.unit || ''}`}`,
                    },
                    h('div', {
                      className: 'dsh-3b-bar' + (v == null ? ' empty' : ''),
                      style: { height: `${Math.min(100, Math.max(0, pct))}%` },
                    }),
                  )
                }),
                h(
                  'svg',
                  { className: 'dsh-3b-stat-svg', viewBox: '0 0 1000 160', preserveAspectRatio: 'none' },
                  average !== null && h('line', {
                    className: 'dsh-3b-mean-line',
                    x1: 0,
                    x2: 1000,
                    y1: yCoord(average),
                    y2: yCoord(average),
                  }),
                  regression && h('line', {
                    className: 'dsh-3b-reg-line',
                    x1: xCoord(regression.first),
                    x2: xCoord(regression.last),
                    y1: yCoord(regression.a),
                    y2: yCoord(regression.b),
                  }),
                ),
              ),
            ),
            h(
              'div',
              { className: 'dsh-3b-xaxis' },
              h('span', null, dates[0] || ''),
              h('span', null, dates[dates.length - 1] || ''),
            ),
            h(
              'div',
              { className: 'dsh-3b-chart-legend' },
              h('span', { className: 'dsh-3b-legend-item' }, h('span', { className: 'dsh-3b-legend-swatch', 'aria-hidden': 'true' }), '均值'),
              h('span', { className: 'dsh-3b-legend-item' }, h('span', { className: 'dsh-3b-legend-swatch accent', 'aria-hidden': 'true' }), '线性回归'),
            ),
          )
          : h('p', { className: 'dsh-3b-empty' }, `该指标在最近 ${days} 天暂无可用记录`),
        h(
          'div',
          { className: 'dsh-3b-chart-meta' },
          h('span', null, `最新：${latestObs ? `${formatNum(latestObs.value, 2)} ${active.unit || ''} (${latestObs.date})` : '—'}`),
          h('span', null, `均值：${formatNum(average, 2)} ${active.unit || ''}`),
          h('span', null, `有效日：${numbers.length}/${days}`),
          limited && h('span', { className: 'dsh-3b-warn' }, h('span', { className: 'dsh-3b-dot warn', 'aria-hidden': 'true' }), `已载入 ${loadedDays} 天`),
        ),
      )
    }

    /** Modal for Diet & Energy Check-ins */
    function CheckinModal({ initialCategory, checkinsData, onClose, onSaved }) {
      const [category, setCategory] = useState(initialCategory || 'diet')
      const [recordDate, setRecordDate] = useState(() => checkinsData?.today || new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10))
      const [mealType, setMealType] = useState('早餐')
      const [score, setScore] = useState(initialCategory === 'energy' ? 8 : 4)
      const [selectedTags, setSelectedTags] = useState([])
      const [note, setNote] = useState('')
      const [busy, setBusy] = useState(false)
      const [err, setErr] = useState('')

      const switchCategory = (nextCat) => {
        setCategory(nextCat)
        setScore(nextCat === 'energy' ? 8 : 4)
        setSelectedTags([])
        setErr('')
      }

      const toggleTag = (tag) => {
        setSelectedTags(prev => (prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]))
      }

      const handleSubmit = async (e) => {
        e.preventDefault()
        setBusy(true)
        setErr('')
        try {
          const res = await apiFetch('/api/3b-health/checkins', {
            method: 'POST',
            body: JSON.stringify({
              category,
              record_date: recordDate,
              meal_type: category === 'diet' ? mealType : '',
              score,
              tags: selectedTags,
              note,
            }),
          })
          setNote('')
          setSelectedTags([])
          onSaved(res.checkins)
        } catch (error) {
          setErr(error.message || '保存失败')
        } finally {
          setBusy(false)
        }
      }

      const handleDelete = async (id) => {
        setBusy(true)
        setErr('')
        try {
          const res = await apiFetch('/api/3b-health/checkins/delete', {
            method: 'POST',
            body: JSON.stringify({ id }),
          })
          onSaved(res.checkins)
        } catch (error) {
          setErr(error.message || '删除失败')
        } finally {
          setBusy(false)
        }
      }

      const filteredHistory = (checkinsData?.items || []).filter(item => item.category === category)
      const presetTags = category === 'diet' ? DIET_TAGS : ENERGY_TAGS

      return h(
        'div',
        { className: 'dsh-3b-modal-backdrop', onClick: onClose },
        h(
          'div',
          {
            className: 'dsh-3b-modal',
            role: 'dialog',
            'aria-modal': 'true',
            'aria-labelledby': 'dsh-3b-checkin-title',
            onClick: e => e.stopPropagation(),
          },
          h(
            'div',
            { className: 'dsh-3b-modal-head' },
            h(
              'div',
              { className: 'dsh-3b-modal-title' },
              h('h2', { id: 'dsh-3b-checkin-title' }, category === 'diet' ? '饮食记录打卡' : '精力自评打卡'),
              h('span', { className: 'dsh-3b-badge' }, '通过 dsh 3B健康插件写入'),
            ),
            h(
              'button',
              { type: 'button', className: 'dsh-3b-btn ghost', onClick: onClose },
              '关闭',
            ),
          ),
          h(
            'div',
            { className: 'dsh-3b-nav' },
            h(
              'button',
              {
                type: 'button',
                className: 'dsh-3b-tab' + (category === 'diet' ? ' active' : ''),
                'aria-pressed': category === 'diet',
                onClick: () => switchCategory('diet'),
              },
              '饮食记录',
            ),
            h(
              'button',
              {
                type: 'button',
                className: 'dsh-3b-tab' + (category === 'energy' ? ' active' : ''),
                'aria-pressed': category === 'energy',
                onClick: () => switchCategory('energy'),
              },
              '精力自评',
            ),
          ),
          err && h('div', { className: 'dsh-3b-notice error' }, err),
          h(
            'form',
            { className: 'dsh-3b-form', onSubmit: handleSubmit },
            h(
              'div',
              { className: 'dsh-3b-field-row' },
              h(
                'label',
                { className: 'dsh-3b-field' },
                '日期：',
                h('input', {
                  type: 'date',
                  className: 'dsh-3b-input',
                  value: recordDate,
                  onChange: e => setRecordDate(e.target.value),
                }),
              ),
              category === 'diet' && h(
                'label',
                { className: 'dsh-3b-field' },
                '餐次：',
                h(
                  'select',
                  {
                    className: 'dsh-3b-select',
                    value: mealType,
                    onChange: e => setMealType(e.target.value),
                  },
                  DIET_MEALS.map(m => h('option', { key: m, value: m }, m)),
                ),
              ),
              h(
                'label',
                { className: 'dsh-3b-field' },
                category === 'diet' ? '饮食健康度 (1-5分)：' : '今日精力评分 (1-10分)：',
                h(
                  'select',
                  {
                    className: 'dsh-3b-select',
                    value: score,
                    onChange: e => setScore(Number(e.target.value)),
                  },
                  Array.from({ length: category === 'diet' ? 5 : 10 }, (_, i) => i + 1).map(n =>
                    h('option', { key: n, value: n }, `${n} 分`),
                  ),
                ),
              ),
            ),
            h(
              'div',
              null,
              h('div', { className: 'dsh-3b-field-text' }, '快捷标签（可多选）：'),
              h(
                'div',
                { className: 'dsh-3b-tag-list' },
                presetTags.map(tag =>
                  h(
                    'button',
                    {
                      key: tag,
                      type: 'button',
                      className: 'dsh-3b-tag-chip' + (selectedTags.includes(tag) ? ' selected' : ''),
                      onClick: () => toggleTag(tag),
                    },
                    tag,
                  ),
                ),
              ),
            ),
            h('textarea', {
              className: 'dsh-3b-textarea',
              rows: 2,
              placeholder: category === 'diet'
                ? '补充吃了什么或饮食感受（如：鸡胸肉沙拉+黑咖啡，少油盐）…'
                : '补充今日体感、睡眠恢复或注意力状态（如：上午专注度高，下午3点后略困）…',
              value: note,
              onChange: e => setNote(e.target.value),
            }),
            h(
              'div',
              { className: 'dsh-3b-form-actions' },
              h(
                'button',
                { type: 'submit', className: 'dsh-3b-btn primary', disabled: busy },
                busy ? '正在写入…' : `保存${category === 'diet' ? '饮食记录' : '精力自评'}（带插件留痕）`,
              ),
            ),
          ),
          h(
            'div',
            { className: 'dsh-3b-history' },
            h('h3', null, `近期${category === 'diet' ? '饮食记录' : '精力自评'}（最近 30 天）`),
            filteredHistory.length === 0
              ? h('p', { className: 'dsh-3b-empty' }, '尚无记录，可在上方添加第一条打卡。')
              : h(
                'div',
                { className: 'dsh-3b-table-wrap' },
                h(
                  'table',
                  { className: 'dsh-3b-table' },
                  h(
                    'thead',
                    null,
                    h(
                      'tr',
                      null,
                      h('th', { scope: 'col' }, '日期'),
                      category === 'diet' && h('th', { scope: 'col' }, '餐次'),
                      h('th', { scope: 'col' }, '评分'),
                      h('th', { scope: 'col' }, '标签与备注'),
                      h('th', { scope: 'col' }, '写入来源'),
                      h('th', { scope: 'col' }, '操作'),
                    ),
                  ),
                  h(
                    'tbody',
                    null,
                    filteredHistory.slice(0, 20).map(row =>
                      h(
                        'tr',
                        { key: row.id },
                        h('td', { className: 'dsh-3b-nowrap' }, row.record_date),
                        category === 'diet' && h('td', null, row.meal_type || '—'),
                        h('td', { className: 'dsh-3b-nowrap' }, row.score != null ? `${row.score} 分` : '—'),
                        h(
                          'td',
                          null,
                          row.tags?.length ? `[${row.tags.join(', ')}] ` : '',
                          row.note || '',
                        ),
                        h('td', null, h('span', { className: 'dsh-3b-badge' }, row.source_label || '通过 dsh 3B健康插件写入')),
                        h(
                          'td',
                          null,
                          h(
                            'button',
                            {
                              type: 'button',
                              className: 'dsh-3b-btn danger tiny',
                              disabled: busy,
                              onClick: () => handleDelete(row.id),
                            },
                            '删除',
                          ),
                        ),
                      ),
                    ),
                  ),
                ),
              ),
          ),
        ),
      )
    }

    /** Modal for Viewing Write Provenance Audit Log */
    function TracesModal({ onClose }) {
      const [traces, setTraces] = useState([])
      const [loading, setLoading] = useState(true)

      useEffect(() => {
        apiFetch('/api/3b-health/traces?limit=60')
          .then(d => setTraces(d.items || []))
          .catch(() => {})
          .finally(() => setLoading(false))
      }, [])

      return h(
        'div',
        { className: 'dsh-3b-modal-backdrop', onClick: onClose },
        h(
          'div',
          {
            className: 'dsh-3b-modal wide',
            role: 'dialog',
            'aria-modal': 'true',
            'aria-labelledby': 'dsh-3b-traces-title',
            onClick: e => e.stopPropagation(),
          },
          h(
            'div',
            { className: 'dsh-3b-modal-head' },
            h(
              'div',
              { className: 'dsh-3b-modal-title' },
              h('h2', { id: 'dsh-3b-traces-title' }, '插件写入留痕记录'),
              h('span', { className: 'dsh-3b-badge' }, '通过 dsh 3B健康插件写入'),
            ),
            h(
              'button',
              { type: 'button', className: 'dsh-3b-btn ghost', onClick: onClose },
              '关闭',
            ),
          ),
          h(
            'p',
            { className: 'dsh-3b-subtitle' },
            '所有通过 DSH「3B健康」插件执行的打卡、偏好配置、同步触发与分析任务生成，均在 SQLite (dsh_plugin_traces) 与 dsh-plugin-traces.jsonl 双重留痕。',
          ),
          loading
            ? h('p', { className: 'dsh-3b-empty' }, '正在读取写入留痕…')
            : traces.length === 0
              ? h('p', { className: 'dsh-3b-empty' }, '尚无插件写入记录。')
              : h(
                'div',
                { className: 'dsh-3b-table-wrap' },
                h(
                  'table',
                  { className: 'dsh-3b-table' },
                  h(
                    'thead',
                    null,
                    h(
                      'tr',
                      null,
                      h('th', { scope: 'col' }, '时间'),
                      h('th', { scope: 'col' }, '动作'),
                      h('th', { scope: 'col' }, '留痕摘要'),
                      h('th', { scope: 'col' }, '来源标识'),
                    ),
                  ),
                  h(
                    'tbody',
                    null,
                    traces.map(item =>
                      h(
                        'tr',
                        { key: item.id },
                        h('td', { className: 'dsh-3b-nowrap' }, String(item.created_at || '').replace('T', ' ').slice(0, 19)),
                        h('td', null, h('code', null, item.action)),
                        h('td', null, item.summary),
                        h('td', null, h('span', { className: 'dsh-3b-badge' }, item.source_label)),
                      ),
                    ),
                  ),
                ),
              ),
        ),
      )
    }

    /** Tab 2: Phone Sync View */
    function SyncTabView() {
      const [data, setData] = useState(null)
      const [busy, setBusy] = useState(false)
      const [msg, setMsg] = useState('')
      const [err, setErr] = useState('')

      const loadSync = useCallback(async () => {
        try {
          const res = await apiFetch('/api/3b-health/sync')
          setData(res)
          setErr('')
        } catch (e) {
          setErr(e.message || '读取同步状态失败')
        }
      }, [])

      useEffect(() => {
        loadSync()
        const timer = setInterval(() => {
          if (typeof document === 'undefined' || !document.hidden) loadSync()
        }, 60000)
        return () => clearInterval(timer)
      }, [loadSync])

      const handleTriggerSync = async () => {
        setBusy(true)
        setMsg('')
        setErr('')
        try {
          const res = await apiFetch('/api/3b-health/sync/trigger', { method: 'POST', body: '{}' })
          setData(res.sync)
          setMsg('已刷新同步状态（只读），本次刷新已留痕；导入由 DataCenter 定时任务负责')
        } catch (e) {
          setErr(e.message || '触发同步检查失败')
        } finally {
          setBusy(false)
        }
      }

      const folder = data?.folder_sync
      const fileImport = data?.file_import
      const zipImport = data?.zip_import
      const store = data?.store || null
      const issue = detectSyncIssue(folder)

      return h(
        'div',
        { className: 'dsh-3b-tab-body' },
        issue && h('div', { className: 'dsh-3b-notice' }, `健康同步提醒：${issue}`),
        err && h('div', { className: 'dsh-3b-notice error' }, err),
        msg && h('div', { className: 'dsh-3b-success' }, msg),
        h(
          'section',
          { className: 'dsh-3b-card' },
          h(
            'div',
            { className: 'dsh-3b-section-head' },
            h(
              'div',
              null,
              h(
                'div',
                { className: 'dsh-3b-title-row' },
                h('h2', null, 'iCloud 文件夹自动同步'),
                h('span', { className: 'dsh-3b-badge accent' }, 'DataCenter 每 5 分钟'),
              ),
            ),
            h(
              'button',
              { className: 'dsh-3b-btn', disabled: busy, onClick: handleTriggerSync },
              busy ? '正在刷新状态…' : '刷新状态（只读）',
            ),
          ),
          folder
            ? h(
              React.Fragment,
              null,
              h(
                'div',
                { className: 'dsh-3b-stat-row' },
                h(
                  'div',
                  { className: 'dsh-3b-stat-cell' },
                  h('span', { className: 'dsh-3b-stat-label' }, folder.phase === 'checking' ? '本次检查启动' : '最近检查'),
                  h('span', { className: 'dsh-3b-stat-value' }, folder.checked_at ? new Date(folder.checked_at).toLocaleString('zh-CN') : '未知'),
                ),
                h(
                  'div',
                  { className: 'dsh-3b-stat-cell' },
                  h('span', { className: 'dsh-3b-stat-label' }, '最近成功导入'),
                  h('span', { className: 'dsh-3b-stat-value' }, folder.last_success ? new Date(folder.last_success).toLocaleString('zh-CN') : '—'),
                ),
                h(
                  'div',
                  { className: 'dsh-3b-stat-cell' },
                  h('span', { className: 'dsh-3b-stat-label' }, '待处理文件'),
                  h('span', { className: 'dsh-3b-stat-value' }, `${folder.pending || 0} 份`),
                ),
                h(
                  'div',
                  { className: 'dsh-3b-stat-cell' },
                  h('span', { className: 'dsh-3b-stat-label' }, '导入异常'),
                  h('span', { className: 'dsh-3b-stat-value' }, `${folder.errors || 0} 份`),
                ),
              ),
              h(
                'p',
                { className: 'dsh-3b-status-line' },
                h('span', {
                  className: 'dsh-3b-dot' + (Number(folder.errors) > 0 || folder.snapshot_error ? ' warn' : ''),
                  'aria-hidden': 'true',
                }),
                folder.message || '等待新导出文件',
              ),
              folder.phase !== 'checking' && h(
                'p',
                { className: 'dsh-3b-metric-note' },
                `最近一次扫描新增 ${folder.added || 0} 条数据点。`,
              ),
              Array.isArray(folder.problems) && folder.problems.length > 0 && h(
                'div',
                null,
                folder.problems.map((p, idx) =>
                  h(
                    'p',
                    { key: idx, className: 'dsh-3b-problem' },
                    h('span', { className: 'dsh-3b-dot warn', 'aria-hidden': 'true' }),
                    `文件 ${p.file}：${SYNC_PROBLEM_LABELS[p.kind] || '读取异常'}${p.detail ? `（${p.detail}）` : ''}`,
                  ),
                ),
              ),
            )
            : h('p', { className: 'dsh-3b-metric-note' }, '尚无 DataCenter 同步状态记录，请先确认 local.datacenter.health 任务正在运行。'),
          store && h(
            'p',
            { className: 'dsh-3b-path' },
            `数据目录：${store.dir || '未解析'}${store.source === 'datacenter' ? '（DataCenter）' : ''}${store.usable === false ? ` · 不可用：${store.reason || '未知原因'}` : ''}`,
          ),
          h(
            'p',
            { className: 'dsh-3b-metric-note' },
            '手机通过 Health Auto Export 导出到 iCloud；导入与摘要由 DataCenter 的 local.datacenter.health 任务每 5 分钟执行。本插件只读取状态，不写入其状态文件。',
          ),
        ),
        h(
          'div',
          { className: 'dsh-3b-stat-grid' },
          h(
            'section',
            { className: 'dsh-3b-card' },
            h(
              'div',
              { className: 'dsh-3b-section-head' },
              h('h2', null, '健康 JSON 增量库 (health-exports.sqlite3)'),
              h('span', { className: 'dsh-3b-badge' }, 'iCloud 自动导入'),
            ),
            h(
              'div',
              { className: 'dsh-3b-metric-val' },
              h('strong', null, formatNum(fileImport?.records || 0, 0)),
              h('span', null, '条去重数据点'),
            ),
            h(
              'p',
              { className: 'dsh-3b-metric-note' },
              `已归档 ${fileImport?.files || 0} 份 JSON 导出文件 · 运动记录 ${fileImport?.workouts || 0} 条`,
            ),
            h(
              'p',
              { className: 'dsh-3b-metric-note' },
              `最近导入：${fileImport?.last_imported ? new Date(fileImport.last_imported).toLocaleString('zh-CN') : '尚无'}`,
            ),
          ),
          h(
            'section',
            { className: 'dsh-3b-card' },
            h(
              'div',
              { className: 'dsh-3b-section-head' },
              h('h2', null, 'Apple Health 历史主库 (life.sqlite3)'),
              h('span', { className: 'dsh-3b-badge accent' }, 'ZIP 全量去重'),
            ),
            h(
              'div',
              { className: 'dsh-3b-metric-val' },
              h('strong', null, formatNum(zipImport?.records || 0, 0)),
              h('span', null, '条健康事件'),
            ),
            h(
              'p',
              { className: 'dsh-3b-metric-note' },
              `已归档 ${zipImport?.files || 0} 份 ZIP 导出包 · 覆盖 ${formatNum(zipImport?.records || 0, 0)} 条健康事件`,
            ),
            h(
              'p',
              { className: 'dsh-3b-metric-note' },
              `最近导入：${zipImport?.last_imported ? new Date(zipImport.last_imported).toLocaleString('zh-CN') : '尚无'}`,
            ),
          ),
        ),
      )
    }

    /** Tab 3: Native DSH AI Health Analysis View */
    function AiAnalysisTabView({ initialMetrics, initialDays, onLaunchInDsh }) {
      const [initData, setInitData] = useState(null)
      const [domain, setDomain] = useState('health_period')
      const [days, setDays] = useState(initialDays || 30)
      const [metricIds, setMetricIds] = useState(
        Array.isArray(initialMetrics) && initialMetrics.length === 6
          ? initialMetrics
          : ['sleep', 'steps', 'active_energy', 'body_mass', 'body_fat', 'lean_body_mass'],
      )
      const [includeCheckins, setIncludeCheckins] = useState(true)
      const [goal, setGoal] = useState(AI_GOAL_TEMPLATES[0].text)
      const [activeJob, setActiveJob] = useState(null)
      const [busy, setBusy] = useState(false)
      const [msg, setMsg] = useState('')
      const [err, setErr] = useState('')

      const loadInit = useCallback(async () => {
        try {
          const d = await apiFetch('/api/3b-health/ai/init')
          setInitData(d)
        } catch (e) {
          setErr(e.message || '加载 AI 分析配置失败')
        }
      }, [])

      useEffect(() => {
        loadInit()
      }, [loadInit])

      const updateMetricSlot = (idx, value) => {
        setMetricIds(prev => prev.map((m, i) => (i === idx ? value : m)))
      }

      const handlePrepareTask = async (autoLaunchInDsh) => {
        setBusy(true)
        setErr('')
        setMsg('')
        try {
          const res = await apiFetch('/api/3b-health/ai/prepare', {
            method: 'POST',
            body: JSON.stringify({
              domain,
              days,
              metric_ids: metricIds.filter(Boolean),
              goal,
              include_checkins: includeCheckins,
            }),
          })
          setActiveJob(res.job)
          if (initData) {
            setInitData({ ...initData, jobs: res.jobs || initData.jobs })
          }
          if (autoLaunchInDsh) {
            onLaunchInDsh(res.job)
          } else {
            setMsg(`已生成本地只读分析任务包 ${res.job.job_id}（已记录插件写入留痕），可点击下方按钮直接在 DSH 会话中发起分析。`)
          }
        } catch (e) {
          setErr(e.message || '准备健康分析任务失败')
        } finally {
          setBusy(false)
        }
      }

      const handleOpenHistoryJob = async (jobId) => {
        setBusy(true)
        setErr('')
        setMsg('')
        try {
          const job = await apiFetch(`/api/3b-health/ai/job?id=${encodeURIComponent(jobId)}`)
          setActiveJob(job)
          setMsg(`已加载历史任务 ${job.job_id}`)
        } catch (e) {
          setErr(e.message || '读取历史任务失败')
        } finally {
          setBusy(false)
        }
      }

      const copyText = async (text, label) => {
        try {
          await navigator.clipboard.writeText(text)
          setMsg(`${label}已复制到剪贴板`)
        } catch (_e) {
          setErr('复制失败，请手动选中文本框内容复制')
        }
      }

      const catalog = initData?.capabilities?.health_metrics || []

      return h(
        'div',
        { className: 'dsh-3b-tab-body' },
        err && h('div', { className: 'dsh-3b-notice error' }, err),
        msg && h('div', { className: 'dsh-3b-success' }, msg),
        h(
          'section',
          { className: 'dsh-3b-card' },
          h(
            'div',
            { className: 'dsh-3b-section-head' },
            h(
              'div',
              null,
              h('h2', null, '在 DSH 中直接发起 AI 健康分析'),
              h(
                'p',
                { className: 'dsh-3b-subtitle' },
                '无需外接 Codex CLI：直接在 ~/Library/Application Support/ThreeBody/AgentAnalysis 下生成脱敏摘要包，并一键跳回 DSH 主对话窗口填入分析提示词。',
              ),
            ),
            h('span', { className: 'dsh-3b-badge' }, 'DSH 原生直连 · 带插件留痕'),
          ),
          h(
            'div',
            { className: 'dsh-3b-field-row' },
            h(
              'label',
              { className: 'dsh-3b-field' },
              h('span', { className: 'dsh-3b-field-label' }, '分析范围：'),
              h(
                'select',
                {
                  className: 'dsh-3b-select',
                  value: domain,
                  onChange: e => setDomain(e.target.value),
                },
                h('option', { value: 'health_period' }, '健康阶段总结（所选 1～6 项指标 + 30/90/365天）'),
                h('option', { value: 'health' }, '健康七日汇总（最近 7 日睡眠与运动）'),
              ),
            ),
            domain === 'health_period' && h(
              'label',
              { className: 'dsh-3b-field' },
              h('span', { className: 'dsh-3b-field-label' }, '统计窗口：'),
              h(
                'select',
                {
                  className: 'dsh-3b-select',
                  value: days,
                  onChange: e => setDays(Number(e.target.value)),
                },
                PERIOD_OPTIONS.map(d => h('option', { key: d, value: d }, `最近 ${d} 天`)),
              ),
            ),
            h(
              'label',
              { className: 'dsh-3b-field' },
              h('input', {
                type: 'checkbox',
                checked: includeCheckins,
                onChange: e => setIncludeCheckins(e.target.checked),
              }),
              '自动附带近期「饮食记录」与「精力自评」打卡摘要',
            ),
          ),
          domain === 'health_period' && catalog.length > 0 && h(
            'div',
            { className: 'dsh-3b-ai-metrics' },
            Array.from({ length: 6 }, (_, idx) =>
              h(
                'label',
                { key: idx, className: 'dsh-3b-field-stack' },
                `分析指标 ${idx + 1}`,
                h(
                  'select',
                  {
                    className: 'dsh-3b-select',
                    value: metricIds[idx] || '',
                    onChange: e => updateMetricSlot(idx, e.target.value),
                  },
                  h('option', { value: '' }, '不提供此项'),
                  catalog.map(m => h('option', { key: m.id, value: m.id }, m.label)),
                ),
              ),
            ),
          ),
          h(
            'div',
            null,
            h(
              'div',
              { className: 'dsh-3b-goal-head' },
              h('span', { className: 'dsh-3b-field-text' }, '希望 DSH Agent 重点分析什么：'),
              h(
                'div',
                { className: 'dsh-3b-tag-list' },
                AI_GOAL_TEMPLATES.map((tpl, idx) =>
                  h(
                    'button',
                    {
                      key: idx,
                      type: 'button',
                      className: 'dsh-3b-tag-chip',
                      onClick: () => setGoal(tpl.text),
                    },
                    tpl.label,
                  ),
                ),
              ),
            ),
            h('textarea', {
              className: 'dsh-3b-textarea',
              rows: 3,
              value: goal,
              onChange: e => setGoal(e.target.value),
            }),
          ),
          h(
            'div',
            { className: 'dsh-3b-actions' },
            h(
              'button',
              {
                type: 'button',
                className: 'dsh-3b-btn primary',
                disabled: busy,
                onClick: () => handlePrepareTask(true),
              },
              busy ? '正在准备任务…' : '一键生成任务包并跳转到 DSH 会话分析 →',
            ),
            h(
              'button',
              {
                type: 'button',
                className: 'dsh-3b-btn',
                disabled: busy,
                onClick: () => handlePrepareTask(false),
              },
              '仅生成任务包并在本页预览',
            ),
          ),
        ),
        activeJob && h(
          'section',
          { className: 'dsh-3b-card' },
          h(
            'div',
            { className: 'dsh-3b-section-head' },
            h(
              'div',
              { className: 'dsh-3b-title-row' },
              h('h2', null, `任务已就绪：${activeJob.job_id}`),
              h('span', { className: 'dsh-3b-badge' }, activeJob.source_label || '通过 dsh 3B健康插件写入'),
            ),
            h(
              'div',
              { className: 'dsh-3b-actions' },
              h(
                'button',
                {
                  type: 'button',
                  className: 'dsh-3b-btn primary',
                  onClick: () => onLaunchInDsh(activeJob),
                },
                '在 DSH 会话中打开并填入提示词 →',
              ),
              h(
                'button',
                {
                  type: 'button',
                  className: 'dsh-3b-btn',
                  onClick: () => copyText(activeJob.handoff_prompt, '分析提示词'),
                },
                '复制提示词',
              ),
              h(
                'button',
                {
                  type: 'button',
                  className: 'dsh-3b-btn',
                  onClick: () => handleOpenHistoryJob(activeJob.job_id),
                },
                '刷新读取 outputs/report.md',
              ),
            ),
          ),
          h(
            'p',
            { className: 'dsh-3b-path' },
            `任务工作区路径：${activeJob.workspace_path} · 生成时间：${String(activeJob.created_at || '').replace('T', ' ').slice(0, 19)}`,
          ),
          activeJob.report && h(
            'div',
            { className: 'dsh-3b-report' },
            h('h3', null, 'DSH Agent 已生成的健康分析报告 (outputs/report.md)：'),
            h('pre', { className: 'dsh-3b-pre' }, activeJob.report),
          ),
          h(
            'details',
            { className: 'dsh-3b-details' },
            h('summary', null, '查看任务说明 (context.md) 与脱敏数据摘要 (summary.json)'),
            h('pre', { className: 'dsh-3b-pre' }, activeJob.context || ''),
            activeJob.summary && h('pre', { className: 'dsh-3b-pre' }, JSON.stringify(activeJob.summary, null, 2)),
          ),
        ),
        h(
          'section',
          { className: 'dsh-3b-card' },
          h(
            'div',
            { className: 'dsh-3b-section-head' },
            h('h2', null, '历史健康分析任务包'),
            h('button', { className: 'dsh-3b-btn', onClick: loadInit }, '刷新列表'),
          ),
          !initData?.jobs?.length
            ? h('p', { className: 'dsh-3b-empty' }, '尚无历史健康分析任务，可在上方一键创建。')
            : h(
              'div',
              { className: 'dsh-3b-table-wrap' },
              h(
                'table',
                { className: 'dsh-3b-table' },
                h(
                  'thead',
                  null,
                  h(
                    'tr',
                    null,
                    h('th', { scope: 'col' }, '任务编号'),
                    h('th', { scope: 'col' }, '类型'),
                    h('th', { scope: 'col' }, '创建时间'),
                    h('th', { scope: 'col' }, '报告状态'),
                    h('th', { scope: 'col' }, '操作'),
                  ),
                ),
                h(
                  'tbody',
                  null,
                  initData.jobs.map(item =>
                    h(
                      'tr',
                      { key: item.job_id },
                      h('td', null, h('code', null, item.job_id)),
                      h(
                        'td',
                        null,
                        item.domain === 'health_period'
                          ? `阶段总结 (${item.health_options?.days || 30}天)`
                          : '七日汇总',
                      ),
                      h('td', { className: 'dsh-3b-nowrap' }, String(item.created_at || '').replace('T', ' ').slice(0, 19)),
                      h(
                        'td',
                        null,
                        item.has_report
                          ? h('span', { className: 'dsh-3b-badge success' }, '已生成报告')
                          : h('span', { className: 'dsh-3b-badge warn' }, '待分析'),
                      ),
                      h(
                        'td',
                        null,
                        h(
                          'div',
                          { className: 'dsh-3b-actions' },
                          h(
                            'button',
                            {
                              type: 'button',
                              className: 'dsh-3b-btn tiny',
                              onClick: () => handleOpenHistoryJob(item.job_id),
                            },
                            '查看详情/报告',
                          ),
                        ),
                      ),
                    ),
                  ),
                ),
              ),
            ),
        ),
      )
    }

    /** Main 3B健康 Panel Component */
    /* ===== 健康关注侧栏组件 ===== */

    function FocusBang({ title, rows }) {
      const hasRows = Array.isArray(rows) && rows.length > 0
      const [open, setOpen] = useState(false)
      const [position, setPosition] = useState(null)
      const anchorRef = useRef(null)
      const popoverRef = useRef(null)
      const closeTimer = useRef(null)

      const cancelClose = () => {
        if (closeTimer.current) {
          clearTimeout(closeTimer.current)
          closeTimer.current = null
        }
      }
      const scheduleClose = () => {
        cancelClose()
        closeTimer.current = setTimeout(() => setOpen(false), 120)
      }

      useLayoutEffect(() => {
        if (!open || !hasRows) return
        const anchor = anchorRef.current
        const popover = popoverRef.current
        if (!anchor || !popover) return
        const root = document.querySelector('.dsh-3b-health-root')
        const rootRect = root ? root.getBoundingClientRect() : { left: 0, top: 0 }
        const offsetLeft = root ? root.scrollLeft : 0
        const offsetTop = root ? root.scrollTop : 0
        const viewWidth = root ? root.clientWidth : window.innerWidth
        const viewHeight = root ? root.clientHeight : window.innerHeight
        const rect = anchor.getBoundingClientRect()
        const width = popover.offsetWidth || 278
        const height = popover.offsetHeight || 220
        let left = rect.right - width - rootRect.left + offsetLeft
        left = Math.max(offsetLeft + 8, Math.min(left, offsetLeft + viewWidth - width - 8))
        let top = rect.bottom + 6 - rootRect.top + offsetTop
        if (top + height > offsetTop + viewHeight - 8) top = rect.top - 6 - height - rootRect.top + offsetTop
        top = Math.max(offsetTop + 8, top)
        setPosition({ left, top })
      }, [open, hasRows])

      useEffect(() => {
        if (!open) return undefined
        const close = () => setOpen(false)
        const onKeyDown = (event) => {
          if (event.key === 'Escape') setOpen(false)
        }
        const onPointerDown = (event) => {
          const target = event.target
          if (anchorRef.current && anchorRef.current.contains(target)) return
          if (popoverRef.current && popoverRef.current.contains(target)) return
          setOpen(false)
        }
        window.addEventListener('scroll', close, true)
        window.addEventListener('resize', close)
        window.addEventListener('keydown', onKeyDown)
        document.addEventListener('pointerdown', onPointerDown, true)
        return () => {
          window.removeEventListener('scroll', close, true)
          window.removeEventListener('resize', close)
          window.removeEventListener('keydown', onKeyDown)
          document.removeEventListener('pointerdown', onPointerDown, true)
        }
      }, [open])

      useEffect(() => () => cancelClose(), [])

      if (!hasRows) return null
      const popover = open
        ? ReactDOM.createPortal(
          h(
            'span',
            {
              ref: popoverRef,
              className: 'dsh-3b-bang-popover',
              role: 'note',
              style: position
                ? { left: position.left + 'px', top: position.top + 'px' }
                : { left: '-9999px', top: '0px' },
              onMouseEnter: cancelClose,
              onMouseLeave: scheduleClose,
            },
            rows.map((row, index) => h(
              'span',
              { className: 'dsh-3b-bang-row', key: index },
              h('strong', null, '【' + row.label + '】'),
              h('span', null, row.text),
            )),
          ),
          document.querySelector('.dsh-3b-health-root') || document.body,
        )
        : null
      return h(
        'span',
        { className: 'dsh-3b-bang-wrap' },
        h(
          'button',
          {
            ref: anchorRef,
            type: 'button',
            className: 'dsh-3b-bang',
            'aria-label': (title || '该项') + '的来源、口径、标准与评分',
            'aria-expanded': open,
            onMouseEnter: () => {
              cancelClose()
              setOpen(true)
            },
            onMouseLeave: scheduleClose,
            onFocus: () => {
              cancelClose()
              setOpen(true)
            },
            onBlur: scheduleClose,
            onClick: (event) => {
              event.stopPropagation()
              cancelClose()
              setOpen(true)
            },
          },
          '!',
        ),
        popover,
      )
    }

    function ProfileBar({ profile, age, latestHeight, onSave, saving, error }) {
      const [editing, setEditing] = useState(false)
      const [year, setYear] = useState(String(profile.birth_year))
      const [sex, setSex] = useState(profile.sex)
      const [height, setHeight] = useState(String(profile.height_cm))
      useEffect(() => {
        setYear(String(profile.birth_year))
        setSex(profile.sex)
        setHeight(String(profile.height_cm))
      }, [profile.birth_year, profile.sex, profile.height_cm])
      const heightText = Number.isInteger(profile.height_cm) ? String(profile.height_cm) : profile.height_cm.toFixed(1)
      const submit = () => {
        const parsedYear = Number.parseInt(year, 10)
        const parsedHeight = Number.parseFloat(height)
        onSave({
          birth_year: Number.isInteger(parsedYear) ? parsedYear : profile.birth_year,
          sex: sex === 'female' ? 'female' : 'male',
          height_cm: Number.isFinite(parsedHeight) ? parsedHeight : profile.height_cm,
        })
      }
      return h(
        'div',
        { className: 'dsh-3b-profile-bar' },
        h(
          'div',
          { className: 'dsh-3b-profile-line' },
          h('span', { className: 'dsh-3b-profile-text' }, '生理基准：' + (profile.sex === 'male' ? '男' : '女') + ' · ' + age + '岁 (' + profile.birth_year + ') · ' + heightText + ' cm'),
          h(
            'button',
            {
              type: 'button',
              className: 'dsh-3b-btn tiny',
              'aria-expanded': editing,
              onClick: () => setEditing((value) => !value),
            },
            editing ? '收起' : '修改基准',
          ),
        ),
        editing && h(
          'div',
          { className: 'dsh-3b-profile-editor' },
          h(
            'label',
            { className: 'dsh-3b-profile-field' },
            h('span', null, '出生年份'),
            h('input', { className: 'dsh-3b-input', type: 'number', min: 1920, max: 2020, value: year, onChange: (event) => setYear(event.target.value) }),
          ),
          h(
            'div',
            { className: 'dsh-3b-profile-field' },
            h('span', null, '性别'),
            h(
              'div',
              { className: 'dsh-3b-seg' },
              h('button', { type: 'button', 'aria-pressed': sex === 'male', onClick: () => setSex('male') }, '男'),
              h('button', { type: 'button', 'aria-pressed': sex === 'female', onClick: () => setSex('female') }, '女'),
            ),
          ),
          h(
            'label',
            { className: 'dsh-3b-profile-field' },
            h('span', null, '身高 cm'),
            h('input', { className: 'dsh-3b-input', type: 'number', min: 100, max: 230, step: 0.1, value: height, onChange: (event) => setHeight(event.target.value) }),
          ),
          Number.isFinite(latestHeight) && h(
            'button',
            { type: 'button', className: 'dsh-3b-btn tiny ghost', onClick: () => setHeight(String(latestHeight)) },
            '填入最新体测身高 ' + latestHeight + ' cm',
          ),
          h(
            'div',
            { className: 'dsh-3b-profile-actions' },
            h('button', { type: 'button', className: 'dsh-3b-btn primary tiny', disabled: saving, onClick: submit }, saving ? '保存中…' : '保存'),
            h('button', { type: 'button', className: 'dsh-3b-btn ghost tiny', onClick: () => setEditing(false) }, '取消'),
          ),
          error && h('p', { className: 'dsh-3b-warn' }, error),
        ),
      )
    }

    function HealthScoreHero({ model }) {
      return h(
        'section',
        { className: 'dsh-3b-score-hero', 'aria-label': '综合健康评分与建议' },
        h(
          'div',
          { className: 'dsh-3b-score-value' },
          h('strong', null, model.score === null ? '—' : String(model.score)),
          h('span', null, '分'),
        ),
        h(
          'div',
          { className: 'dsh-3b-score-body' },
          h('h3', null, '综合健康评分'),
          h('p', null, model.advice),
          model.truncated && h('p', { className: 'dsh-3b-score-note' }, '当日数据尚未完结，日均类指标取最近 7 个完结日。'),
        ),
      )
    }

    function FocusCard({ card }) {
      const unitText = card.unit ? (card.unit === '%' ? '%' : ' ' + card.unit) : ''
      return h(
        'article',
        { className: 'dsh-3b-focus-card' },
        h(
          'div',
          { className: 'dsh-3b-focus-card-head' },
          h('h3', null, card.label),
          h('span', { className: 'dsh-3b-status-pill ' + card.tone }, card.status),
          h(FocusBang, { title: card.label, rows: card.explain }),
        ),
        h(
          'div',
          { className: 'dsh-3b-focus-value' },
          h('strong', null, card.valueText),
          h('span', { className: 'dsh-3b-focus-unit' }, unitText),
          card.deltaText && h('span', { className: 'dsh-3b-focus-delta' }, card.deltaText),
        ),
        card.subText && h('p', { className: 'dsh-3b-focus-sub' }, card.subText),
        h(
          'p',
          { className: 'dsh-3b-focus-gap ' + card.tone },
          card.gapText,
          card.actionText && h('span', { className: 'dsh-3b-focus-action' }, ' · ' + card.actionText),
        ),
      )
    }

    function BodyTypeGrid({ grid }) {
      const [zoom, setZoom] = useState(false)
      const empty = !grid || !Array.isArray(grid.points) || grid.points.length === 0
      if (empty) {
        return h(
          'section',
          { className: 'dsh-3b-card dsh-3b-grid-card' },
          h('div', { className: 'dsh-3b-grid-head' }, h('h3', null, '身体类型九宫格')),
          h('p', { className: 'dsh-3b-empty' }, '近 15 天暂无可用体测记录'),
        )
      }
      const width = 320
      const height = 250
      const pad = { left: 30, right: 10, top: 10, bottom: 26 }
      const plotW = width - pad.left - pad.right
      const plotH = height - pad.top - pad.bottom
      const axisX = grid.xAxis
      const axisY = grid.yAxis
      let xMin = axisX.min
      let xMax = axisX.max
      let yMin = axisY.min
      let yMax = axisY.max
      if (zoom) {
        const fats = grid.points.map((point) => point.bodyFat)
        const bmis = grid.points.map((point) => point.bmi)
        const fatMin = Math.min.apply(null, fats)
        const fatMax = Math.max.apply(null, fats)
        const bmiMin = Math.min.apply(null, bmis)
        const bmiMax = Math.max.apply(null, bmis)
        const fatPad = Math.max((fatMax - fatMin) * 0.12, 0.15)
        const bmiPad = Math.max((bmiMax - bmiMin) * 0.12, 0.1)
        xMin = Math.max(axisX.min, fatMin - fatPad)
        xMax = Math.min(axisX.max, fatMax + fatPad)
        yMin = Math.max(axisY.min, bmiMin - bmiPad)
        yMax = Math.min(axisY.max, bmiMax + bmiPad)
      }
      if (xMax - xMin < 0.2) { xMin = axisX.min; xMax = axisX.max }
      if (yMax - yMin < 0.2) { yMin = axisY.min; yMax = axisY.max }
      const sx = (value) => pad.left + ((value - xMin) / (xMax - xMin)) * plotW
      const sy = (value) => pad.top + ((yMax - value) / (yMax - yMin)) * plotH
      const colRanges = [[axisX.min, axisX.cut1], [axisX.cut1, axisX.cut2], [axisX.cut2, axisX.max]]
      const rowRanges = [[axisY.cut2, axisY.max], [axisY.cut1, axisY.cut2], [axisY.min, axisY.cut1]]
      const zoneTable = [
        ['athlete', 'overweight', 'obese'],
        ['muscular', 'healthy', 'hiddenFat'],
        ['thin', 'slimMuscular', 'slim'],
      ]
      const cells = []
      for (let row = 0; row < 3; row += 1) {
        for (let col = 0; col < 3; col += 1) {
          const left = sx(colRanges[col][0])
          const right = sx(colRanges[col][1])
          const top = sy(rowRanges[row][1])
          const bottom = sy(rowRanges[row][0])
          const key = zoneTable[row][col]
          const current = grid.current && grid.current.row === row && grid.current.col === col
          cells.push(h('rect', {
            key: 'cell-' + row + '-' + col,
            x: left,
            y: top,
            width: Math.max(0, right - left),
            height: Math.max(0, bottom - top),
            fill: current ? 'color-mix(in srgb, ' + FOCUS_ZONES[key].color + ' ' + (zoom ? '10%' : '18%') + ', var(--3b-surface))' : 'transparent',
            stroke: current ? FOCUS_ZONES[key].color : 'transparent',
            strokeWidth: current ? 1.2 : 0,
          }))
          if (!zoom) {
            cells.push(h(
              'text',
              {
                key: 'label-' + row + '-' + col,
                x: (left + right) / 2,
                y: (top + bottom) / 2,
                className: 'dsh-3b-grid-label',
                textAnchor: 'middle',
                dominantBaseline: 'middle',
              },
              FOCUS_ZONES[key].label,
            ))
          }
        }
      }
      const boundaries = [
        { key: 'bx1', x1: sx(axisX.cut1), x2: sx(axisX.cut1), y1: sy(axisY.min), y2: sy(axisY.max) },
        { key: 'bx2', x1: sx(axisX.cut2), x2: sx(axisX.cut2), y1: sy(axisY.min), y2: sy(axisY.max) },
        { key: 'by1', x1: sx(axisX.min), x2: sx(axisX.max), y1: sy(axisY.cut1), y2: sy(axisY.cut1) },
        { key: 'by2', x1: sx(axisX.min), x2: sx(axisX.max), y1: sy(axisY.cut2), y2: sy(axisY.cut2) },
      ]
      const segments = []
      for (let i = 1; i < grid.points.length; i += 1) {
        const from = grid.points[i - 1]
        const to = grid.points[i]
        const id = 'dsh-3b-grid-seg-' + i
        segments.push(h(
          'linearGradient',
          {
            key: id,
            id,
            gradientUnits: 'userSpaceOnUse',
            x1: sx(from.bodyFat),
            y1: sy(from.bmi),
            x2: sx(to.bodyFat),
            y2: sy(to.bmi),
          },
          h('stop', { offset: '0%', style: { stopColor: FOCUS_ZONES[from.zone].color, stopOpacity: from.alpha } }),
          h('stop', { offset: '100%', style: { stopColor: FOCUS_ZONES[to.zone].color, stopOpacity: to.alpha } }),
        ))
      }
      const lastPoint = grid.points[grid.points.length - 1]
      return h(
        'section',
        { className: 'dsh-3b-card dsh-3b-grid-card' },
        h(
          'div',
          { className: 'dsh-3b-grid-head' },
          h('h3', null, '身体类型'),
          h('span', { className: 'dsh-3b-grid-zone' }, '当前：' + grid.zoneLabel),
        ),
        h(
          'div',
          { className: 'dsh-3b-seg dsh-3b-grid-toggle' },
          h('button', { type: 'button', 'aria-pressed': !zoom, onClick: () => setZoom(false) }, '全局九宫格'),
          h('button', { type: 'button', 'aria-pressed': zoom, onClick: () => setZoom(true) }, '15日轨迹放大'),
        ),
        h(
          'svg',
          { className: 'dsh-3b-body-grid', viewBox: '0 0 320 250', role: 'img', 'aria-label': '身体类型九宫格与近 15 天轨迹' },
          h('defs', null, segments),
          cells,
          boundaries.map((line) => h('line', {
            key: line.key,
            x1: line.x1,
            y1: line.y1,
            x2: line.x2,
            y2: line.y2,
            className: 'dsh-3b-grid-rule',
          })),
          h('text', { x: pad.left, y: height - 4, className: 'dsh-3b-grid-axis', textAnchor: 'start' }, '体脂 ' + focusFixed(xMin, Number.isInteger(xMin) ? 0 : 1) + '%'),
          h('text', { x: width - pad.right, y: height - 4, className: 'dsh-3b-grid-axis', textAnchor: 'end' }, focusFixed(xMax, Number.isInteger(xMax) ? 0 : 1) + '%'),
          h('text', { x: pad.left + 3, y: pad.top + 9, className: 'dsh-3b-grid-axis', textAnchor: 'start' }, 'BMI ' + focusFixed(yMax, Number.isInteger(yMax) ? 0 : 1)),
          h('text', { x: pad.left - 3, y: sy(yMin) - 4, className: 'dsh-3b-grid-axis', textAnchor: 'end' }, focusFixed(yMin, Number.isInteger(yMin) ? 0 : 1)),
          grid.points.map((point, index) => {
            const cx = sx(point.bodyFat)
            const cy = sy(point.bmi)
            const color = FOCUS_ZONES[point.zone].color
            const isLast = index === grid.points.length - 1
            const title = point.date + '：体脂率 ' + point.bodyFat.toFixed(1) + '% · 校准 BMI ' + point.bmi.toFixed(1)
              + (point.interpolated ? '（缺失日线性估算）' : '')
            return h(
              React.Fragment,
              { key: point.date },
              isLast && h('circle', { cx, cy, r: 8, fill: color, opacity: 0.22, 'aria-hidden': 'true' }),
              h('circle', {
                cx,
                cy,
                r: point.radius,
                fill: point.interpolated ? 'var(--3b-paper)' : color,
                stroke: color,
                strokeWidth: point.interpolated ? 1 : 0,
                strokeDasharray: point.interpolated ? '2 1' : undefined,
                opacity: point.alpha,
              }, h('title', null, title)),
            )
          }),
          segments.map((segment, index) => {
            const to = grid.points[index + 1]
            const from = grid.points[index]
            return h('line', {
              key: 'seg-line-' + index,
              x1: sx(from.bodyFat),
              y1: sy(from.bmi),
              x2: sx(to.bodyFat),
              y2: sy(to.bmi),
              stroke: 'url(#dsh-3b-grid-seg-' + (index + 1) + ')',
              strokeWidth: to.width,
              strokeLinecap: 'round',
            })
          }),
          zoom && h('text', { x: pad.left, y: height - 15, className: 'dsh-3b-grid-date', textAnchor: 'start' }, grid.points[0].date.slice(5)),
          zoom && h('text', { x: width - pad.right, y: height - 15, className: 'dsh-3b-grid-date', textAnchor: 'end' }, lastPoint.date.slice(5)),
        ),
        h(
          'div',
          { className: 'dsh-3b-grid-legend' },
          h('span', null, h('span', { className: 'dsh-3b-grid-dot' }), '实测点'),
          h('span', null, h('span', { className: 'dsh-3b-grid-dot dashed' }), '线性估算'),
          h('span', null, grid.points[0].date.slice(5) + ' → ' + lastPoint.date.slice(5)),
        ),
      )
    }

    function HealthTargetList({ model, rows }) {
      const items = Array.isArray(rows) ? rows : []
      return h(
        'section',
        { className: 'dsh-3b-card dsh-3b-target-list' },
        h(
          'div',
          { className: 'dsh-3b-target-head' },
          h('h3', null, '向健康改进的目标'),
          h(FocusBang, {
            title: '目标差距口径',
            rows: [
              { label: '对比标准', text: '差距优先对比年龄-性别健康区间边界，理想中位值见各指标气泡。' },
              { label: '计算口径', text: '体重按 BMI 24.0 健康上限；体脂目标在守住去脂体重的前提下计算。' },
              { label: '行为目标', text: '睡眠、周运动与步数按健康区间下限补齐，取最近 7 个完结日。' },
            ],
          }),
        ),
        h(
          'ul',
          { className: 'dsh-3b-target-rows' },
          items.map((row) => h(
            'li',
            { key: row.id, className: 'dsh-3b-target-row' },
            h('span', { className: 'dsh-3b-target-label' }, row.label),
            h('span', { className: 'dsh-3b-target-value ' + row.tone }, row.valueText),
            h('span', { className: 'dsh-3b-target-gap' }, row.gapText),
            h(FocusBang, { title: row.label, rows: row.explain }),
          )),
        ),
        h('p', { className: 'dsh-3b-target-note' }, '共 ' + items.length + ' 项 · 数据截至 ' + (model.windowEnd || '—')),
      )
    }

    function FocusSidebar({ model, onSaveProfile, savingProfile, profileError }) {
      if (!model || !model.available) {
        return h(
          'aside',
          { className: 'dsh-3b-focus-sidebar', 'aria-label': '健康关注侧栏' },
          h('div', { className: 'dsh-3b-card' }, h('p', { className: 'dsh-3b-empty' }, (model && model.reason) || '暂无足够数据生成关注侧栏')),
        )
      }
      return h(
        'aside',
        { className: 'dsh-3b-focus-sidebar', 'aria-label': '健康关注与标准差距' },
        h(ProfileBar, {
          profile: model.profile,
          age: model.profile.age,
          latestHeight: model.latestHeight,
          onSave: onSaveProfile,
          saving: savingProfile,
          error: profileError,
        }),
        h(HealthScoreHero, { model }),
        h(
          'section',
          { className: 'dsh-3b-focus-section' },
          h(
            'div',
            { className: 'dsh-3b-section-head' },
            h('div', null,
              h('h2', null, '重点关注'),
              h('p', { className: 'dsh-3b-subtitle' }, '五域保底 + 全局补位 · 按关注度排序'),
            ),
          ),
          h('div', { className: 'dsh-3b-focus-grid' }, model.cards.map((card) => h(FocusCard, { key: card.id, card }))),
        ),
        h(BodyTypeGrid, { grid: model.grid }),
        h(HealthTargetList, { model, rows: model.targets }),
        model.stale.length > 0 && h('p', { className: 'dsh-3b-focus-stale' }, '已降权的过期数据：' + model.stale.join('、')),
      )
    }

    function HealthMainPanel({ startDshAnalysis }) {
      const cachedDash = dashboardCache && Date.now() - dashboardCache.at < DASHBOARD_CACHE_TTL_MS
        ? dashboardCache.data
        : null
      const [activeTab, setActiveTab] = useState('dashboard')
      const [dash, setDash] = useState(cachedDash)
      const [loading, setLoading] = useState(!cachedDash)
      const [err, setErr] = useState('')
      const [privacy, setPrivacy] = useState(false)
      const [checkinModalCat, setCheckinModalCat] = useState(null)
      const [showTracesModal, setShowTracesModal] = useState(false)
      const [toastMsg, setToastMsg] = useState('')
      const [savingProfile, setSavingProfile] = useState(false)
      const [profileError, setProfileError] = useState('')

      useEffect(() => {
        injectStyles()
      }, [])

      const loadDashboard = useCallback(async (background = false) => {
        if (!background) setLoading(true)
        setErr('')
        try {
          const d = await apiFetch('/api/3b-health/dashboard')
          dashboardCache = { data: d, at: Date.now() }
          setDash(d)
        } catch (e) {
          setErr(e.message || '加载健康仪表盘失败')
        } finally {
          setLoading(false)
        }
      }, [])

      useEffect(() => {
        // A cached dashboard renders immediately; refresh it in the background.
        loadDashboard(Boolean(cachedDash))
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [loadDashboard])

      useEffect(() => {
        if (!toastMsg) return
        const t = setTimeout(() => setToastMsg(''), 4000)
        return () => clearTimeout(t)
      }, [toastMsg])

      useEffect(() => {
        // While DataCenter is still regenerating the snapshot, poll quietly and
        // let the panel update itself as soon as the new summary lands.
        if (!dash?.diagnostics?.summary_outdated) return
        const timer = setInterval(() => loadDashboard(true), 30000)
        return () => clearInterval(timer)
      }, [dash?.diagnostics?.summary_outdated, loadDashboard])

      const health = dash?.health
      const diagnostics = dash?.diagnostics || null
      const store = dash?.store || null
      const prefs = dash?.preferences || {
        metrics: ['sleep', 'steps', 'active_energy', 'body_mass', 'body_fat', 'lean_body_mass'],
        periods: [30, 30, 30, 30, 30, 30],
        stage_days: 30,
        profile: DEFAULT_PROFILE,
      }
      const checkins = dash?.checkins
      const syncIssue = detectSyncIssue(dash?.sync_folder)

      const savePrefsBackend = async (nextMetrics, nextPeriods, nextStageDays) => {
        setDash(prev => (prev ? {
          ...prev,
          preferences: {
            ...prev.preferences,
            metrics: nextMetrics,
            periods: nextPeriods,
            stage_days: nextStageDays,
          },
        } : prev))
        try {
          const saved = await apiFetch('/api/3b-health/preferences', {
            method: 'POST',
            body: JSON.stringify({
              metrics: nextMetrics,
              periods: nextPeriods,
              stage_days: nextStageDays,
            }),
          })
          setDash(prev => (prev ? { ...prev, preferences: saved } : prev))
          if (dashboardCache) {
            dashboardCache = { data: { ...dashboardCache.data, preferences: saved }, at: Date.now() }
          }
          setToastMsg('已保存图表偏好到本地配置（已留痕）')
        } catch (e) {
          setErr(e.message || '保存偏好失败')
        }
      }

      const saveProfile = async (nextProfile) => {
        setSavingProfile(true)
        setProfileError('')
        try {
          const saved = await apiFetch('/api/3b-health/preferences', {
            method: 'POST',
            body: JSON.stringify({ profile: nextProfile }),
          })
          setDash(prev => (prev ? { ...prev, preferences: saved } : prev))
          if (dashboardCache) {
            dashboardCache = { data: { ...dashboardCache.data, preferences: saved }, at: Date.now() }
          }
          setToastMsg('已保存生理基准并写入留痕')
        } catch (e) {
          setProfileError(e.message || '保存生理基准失败')
        } finally {
          setSavingProfile(false)
        }
      }

      const handleSelectMetric = (slotIdx, metricId) => {
        const nextMetrics = prefs.metrics.map((m, i) => (i === slotIdx ? metricId : m))
        savePrefsBackend(nextMetrics, prefs.periods, prefs.stage_days)
      }

      const handleSelectPeriod = (slotIdx, periodDays) => {
        const nextPeriods = prefs.periods.map((p, i) => (i === slotIdx ? periodDays : p))
        savePrefsBackend(prefs.metrics, nextPeriods, prefs.stage_days)
      }

      const handleSelectStageDays = (stageDays) => {
        savePrefsBackend(prefs.metrics, prefs.periods, stageDays)
      }

      const handleLaunchInDsh = (job) => {
        const res = startDshAnalysis(job)
        if (res && res.fallbackCopied) {
          setToastMsg('已复制分析提示词并切回 DSH 会话窗口，请直接粘贴发送')
        }
      }

      const metricsList = health?.trend?.metrics || []
      const focusModel = useMemo(
        () => evaluateHealthFocus(health, checkins, prefs.profile || DEFAULT_PROFILE),
        [health, checkins, prefs.profile],
      )
      const stageDays = prefs.stage_days || 30
      const stageRows = useMemo(() => {
        const seen = new Set()
        return prefs.metrics
          .map(id => metricsList.find(m => m.id === id))
          .filter(m => m && !seen.has(m.id) && seen.add(m.id))
          .map((metric) => {
            const series = healthTrendSeries(health?.trend, metric, stageDays)
            const points = series.values.flatMap((v, idx) => (v == null ? [] : [{ date: series.dates[idx], value: v }]))
            const first = points[0] || null
            const last = points[points.length - 1] || null
            const mean = points.length ? points.reduce((s, p) => s + p.value / points.length, 0) : null
            const diff = points.length > 1 ? last.value - first.value : null
            return {
              metric,
              ...series,
              first,
              last,
              mean,
              difference: diff,
              recorded: points.length,
              missing: stageDays - points.length,
            }
          })
      }, [health?.trend, metricsList, prefs.metrics, stageDays])

      const dietSummary = checkins?.diet_summary
      const energySummary = checkins?.energy_summary
      const workouts = health?.workouts

      return h(
        'div',
        { className: 'dsh-3b-health-root' + (activeTab === 'dashboard' && !privacy ? ' dsh-3b-health-root--dashboard' : '') },
        h(
          'div',
          { className: 'dsh-3b-health-container' },
          /* Top Header & Navigation */
          h(
            'header',
            { className: 'dsh-3b-topbar' },
            h(
              'div',
              { className: 'dsh-3b-brand' },
              h(
                'div',
                { className: 'dsh-3b-brand-row' },
                h('h1', { className: 'dsh-3b-title' }, '3B健康'),
                h('span', { className: 'dsh-3b-badge' }, '通过 dsh 3B健康插件写入'),
                store && !store.usable && h('span', { className: 'dsh-3b-badge warn' }, '数据目录不可用'),
                diagnostics?.summary_outdated && h('span', { className: 'dsh-3b-badge warn' }, '有新导出未汇总'),
              ),
              h(
                'p',
                { className: 'dsh-3b-subtitle' },
                `资料截至 ${health?.latest_source_date || '读取中'} · 快照生成 ${diagnostics?.summary_generated_at ? new Date(diagnostics.summary_generated_at).toLocaleString('zh-CN') : '未知'} · ${health?.data_source === 'health-export' ? 'Health Data Export 自动同步' : '本地健康资料库'}`,
              ),
              h(
                'p',
                { className: 'dsh-3b-path' },
                `数据目录：${store?.dir || '未解析'}${store?.source === 'datacenter' ? '（DataCenter）' : ''}${Number(diagnostics?.data_lag_days) > 0 ? ` · 距今 ${diagnostics.data_lag_days} 天` : ''}`,
              ),
            ),
            h(
              'div',
              { className: 'dsh-3b-tab-row' },
              h(
                'nav',
                { className: 'dsh-3b-nav', 'aria-label': '3B健康板块切换' },
                [
                  ['dashboard', '健康仪表盘'],
                  ['sync', '手机同步'],
                  ['ai', 'AI 健康分析'],
                ].map(([key, label]) =>
                  h(
                    'button',
                    {
                      key,
                      type: 'button',
                      className: 'dsh-3b-tab' + (activeTab === key ? ' active' : ''),
                      'aria-current': activeTab === key ? 'page' : undefined,
                      onClick: () => setActiveTab(key),
                    },
                    label,
                  ),
                ),
              ),
            ),
            h(
              'div',
              { className: 'dsh-3b-actions' },
              h(
                'button',
                {
                  type: 'button',
                  className: 'dsh-3b-btn primary',
                  onClick: () => setCheckinModalCat('diet'),
                },
                '+ 饮食/精力打卡',
              ),
              h(
                'button',
                {
                  type: 'button',
                  className: 'dsh-3b-btn',
                  onClick: () => setShowTracesModal(true),
                },
                '写入留痕',
              ),
              h(
                'button',
                {
                  type: 'button',
                  className: 'dsh-3b-btn ghost',
                  'aria-pressed': privacy,
                  onClick: () => setPrivacy(p => !p),
                },
                privacy ? '恢复展示' : '隐私遮蔽',
              ),
              h(
                'button',
                {
                  type: 'button',
                  className: 'dsh-3b-btn ghost',
                  disabled: loading,
                  onClick: () => loadDashboard(),
                },
                loading ? '刷新中…' : '刷新',
              ),
            ),
          ),

          toastMsg && h('div', { className: 'dsh-3b-success' }, toastMsg),
          err && h('div', { className: 'dsh-3b-notice error' }, err),
          store && !store.usable && h(
            'div',
            { className: 'dsh-3b-notice' },
            `健康数据目录不可用：${store.reason || '未知原因'}${store.dir ? `（${store.dir}）` : ''}。请检查 DataCenter 配置或挂载数据盘。`,
          ),
          Array.isArray(diagnostics?.migration_errors) && diagnostics.migration_errors.length > 0 && h(
            'div',
            { className: 'dsh-3b-notice' },
            `旧数据迁移未完成：${diagnostics.migration_errors.join('；')}。偏好可能仍是默认六项。`,
          ),
          diagnostics?.summary_outdated && h(
            'div',
            { className: 'dsh-3b-notice' },
            `有新导出尚未汇总（快照生成 ${diagnostics.summary_mtime ? new Date(diagnostics.summary_mtime).toLocaleString('zh-CN') : '未知'}；待处理 ${diagnostics.sync_pending ?? 0} 份），数据待 DataCenter 重算摘要。`,
          ),

          privacy
            ? h(
              'section',
              { className: 'dsh-3b-card dsh-3b-privacy' },
              h('h2', null, '个人健康数据已隐藏'),
              h('p', { className: 'dsh-3b-metric-note' }, '当前处于隐私遮蔽模式，点击右上角「恢复展示」继续查看。'),
            )
            : activeTab === 'sync'
              ? h(SyncTabView)
              : activeTab === 'ai'
                ? h(AiAnalysisTabView, {
                  initialMetrics: prefs.metrics,
                  initialDays: prefs.stage_days || 30,
                  onLaunchInDsh: handleLaunchInDsh,
                })
                : h(
                  React.Fragment,
                  null,
                  syncIssue && h(
                    'div',
                    { className: 'dsh-3b-notice row' },
                    h('span', null, `同步状态提醒：${syncIssue}`),
                    h(
                      'button',
                      { type: 'button', className: 'dsh-3b-btn ghost', onClick: () => setActiveTab('sync') },
                      '查看手机同步 →',
                    ),
                  ),

                  h(
                    'div',
                    { className: 'dsh-3b-dashboard-grid' },
                    h(
                      'div',
                      { className: 'dsh-3b-dashboard-main' },
                      /* Top 4 Summary Cards */
                      h(
                        'section',
                        { className: 'dsh-3b-section', 'aria-label': '核心健康指标与日常打卡' },
                        h(
                          'div',
                          { className: 'dsh-3b-section-head' },
                          h(
                            'div',
                            null,
                            h('h2', null, h('span', { className: 'dsh-3b-section-index', 'aria-hidden': 'true' }, '01'), '核心指标'),
                          ),
                        ),
                        h(
                          'div',
                          { className: 'dsh-3b-metrics-grid' },
                          h(
                            'div',
                            { className: 'dsh-3b-card dsh-3b-kpi' },
                            h('div', { className: 'dsh-3b-metric-head' }, h('span', null, '7日运动汇总'), h('span', { className: 'dsh-3b-badge' }, '自动统计')),
                            h(
                              'div',
                              { className: 'dsh-3b-metric-val' },
                              h('strong', null, formatNum(health?.exercise_total, 1)),
                              h('span', null, '分钟'),
                            ),
                            h(
                              'p',
                              { className: 'dsh-3b-metric-note' },
                              `${health?.exercise_days ?? 0}/7 天有${health?.data_source === 'health-export' ? '训练明细' : '活动汇总'} · 窗口含最新资料日`,
                            ),
                          ),
                          h(
                            'div',
                            { className: 'dsh-3b-card dsh-3b-kpi' },
                            h('div', { className: 'dsh-3b-metric-head' }, h('span', null, '可用睡眠平均时长'), h('span', { className: 'dsh-3b-badge' }, '自动统计')),
                            h(
                              'div',
                              { className: 'dsh-3b-metric-val' },
                              h('strong', null, formatNum(health?.sleep_average, 2)),
                              h('span', null, '小时'),
                            ),
                            h(
                              'p',
                              { className: 'dsh-3b-metric-note' },
                              `${health?.sleep_days ?? 0}/7 个统计日有入睡记录 · 前日中午至当日中午归并`,
                            ),
                          ),
                          h(
                            'button',
                            {
                              type: 'button',
                              className: 'dsh-3b-card dsh-3b-kpi interactive',
                              onClick: () => setCheckinModalCat('diet'),
                            },
                            h(
                              'div',
                              { className: 'dsh-3b-metric-head' },
                              h('span', null, '饮食记录（点击录入）'),
                              h('span', { className: 'dsh-3b-badge accent' }, '可交互 · 留痕'),
                            ),
                            h(
                              'div',
                              { className: 'dsh-3b-metric-val' },
                              h(
                                'strong',
                                null,
                                dietSummary?.today_count > 0
                                  ? `今日 ${dietSummary.today_count} 餐`
                                  : dietSummary?.avg_score_7d != null
                                    ? `${dietSummary.avg_score_7d} 分`
                                    : '点击记录',
                              ),
                              h('span', null, dietSummary?.today_count > 0 && dietSummary?.avg_score_7d != null ? `· 近7日均分 ${dietSummary.avg_score_7d}/5` : ''),
                            ),
                            h(
                              'p',
                              { className: 'dsh-3b-metric-note' },
                              dietSummary?.latest
                                ? `最近：${dietSummary.latest.record_date} ${dietSummary.latest.meal_type || ''} ${dietSummary.latest.tags?.length ? `[${dietSummary.latest.tags.join(',')}]` : ''} ${dietSummary.latest.note || ''}`
                                : '点击录入早/中/晚/加餐、健康度评分与饮食标签',
                            ),
                          ),
                          h(
                            'button',
                            {
                              type: 'button',
                              className: 'dsh-3b-card dsh-3b-kpi interactive',
                              onClick: () => setCheckinModalCat('energy'),
                            },
                            h(
                              'div',
                              { className: 'dsh-3b-metric-head' },
                              h('span', null, '精力自评（点击录入）'),
                              h('span', { className: 'dsh-3b-badge accent' }, '可交互 · 留痕'),
                            ),
                            h(
                              'div',
                              { className: 'dsh-3b-metric-val' },
                              h(
                                'strong',
                                null,
                                energySummary?.today_latest?.score != null
                                  ? `${energySummary.today_latest.score} / 10`
                                  : energySummary?.avg_score_7d != null
                                    ? `均值 ${energySummary.avg_score_7d}`
                                    : '点击自评',
                              ),
                              h('span', null, energySummary?.days_7d ? `近7日已记 ${energySummary.days_7d} 天` : '1～10 分体感自评'),
                            ),
                            h(
                              'p',
                              { className: 'dsh-3b-metric-note' },
                              energySummary?.latest
                                ? `最近：${energySummary.latest.record_date} (${energySummary.latest.score ?? '—'}分) ${energySummary.latest.tags?.length ? `[${energySummary.latest.tags.join(',')}]` : ''} ${energySummary.latest.note || ''}`
                                : '需要本人记录体感与专注度，不从穿戴设备推算',
                            ),
                          ),
                        ),
                      ),

                      /* 6 Independent Trend Charts */
                      h(
                        'section',
                        { className: 'dsh-3b-section' },
                        h(
                          'div',
                          { className: 'dsh-3b-section-head' },
                          h(
                            'div',
                            null,
                            h('h2', null, h('span', { className: 'dsh-3b-section-index', 'aria-hidden': 'true' }, '02'), '六组独立健康趋势（43 项指标 × 30/90/365 天）'),
                            h(
                              'p',
                              { className: 'dsh-3b-subtitle' },
                              '切换任一图表的指标或时间段，将自动通过后端持久化至 data/private/dsh-health-preferences.json 并保留插件写入留痕。',
                            ),
                          ),
                        ),
                        h(
                          'div',
                          { className: 'dsh-3b-trends-grid' },
                          Array.from({ length: 6 }, (_, idx) =>
                            h(TrendChartCard, {
                              key: idx,
                              slotIndex: idx,
                              trendData: health?.trend,
                              metricsList,
                              activeMetricId: prefs.metrics[idx],
                              days: prefs.periods[idx] || 30,
                              onSelectMetric: handleSelectMetric,
                              onSelectPeriod: handleSelectPeriod,
                            }),
                          ),
                        ),
                      ),

                      /* Stage Summary Section */
                      h(
                        'section',
                        { className: 'dsh-3b-card' },
                        h(
                          'div',
                          { className: 'dsh-3b-section-head' },
                          h(
                            'div',
                            null,
                            h('h2', null, h('span', { className: 'dsh-3b-section-index', 'aria-hidden': 'true' }, '03'), '健康阶段总结'),
                            h('p', { className: 'dsh-3b-subtitle' }, '跟随上方六图所选指标，按统一时间段核对有效日均值、覆盖天数与首末变化。'),
                          ),
                          h(
                            'div',
                            { className: 'dsh-3b-actions' },
                            h(
                              'label',
                              { className: 'dsh-3b-field' },
                              h('span', { className: 'dsh-3b-field-label' }, '总结周期：'),
                              h(
                                'select',
                                {
                                  className: 'dsh-3b-select',
                                  value: stageDays,
                                  onChange: e => handleSelectStageDays(Number(e.target.value)),
                                },
                                PERIOD_OPTIONS.map(d => h('option', { key: d, value: d }, `最近 ${d} 天`)),
                              ),
                            ),
                            h(
                              'button',
                              {
                                type: 'button',
                                className: 'dsh-3b-btn primary',
                                onClick: () => setActiveTab('ai'),
                              },
                              '在 DSH 中发起此阶段 AI 分析 →',
                            ),
                          ),
                        ),
                        h(
                          'div',
                          { className: 'dsh-3b-period-grid' },
                          stageRows.map(row =>
                            h(
                              'article',
                              { key: row.metric.id, className: 'dsh-3b-period-item' },
                              h('h4', null, healthTrendLabel(row.metric)),
                              h(
                                'div',
                                { className: 'dsh-3b-stat-value' },
                                formatNum(row.mean, 2),
                                h('span', { className: 'unit' }, `${row.metric.unit || ''} · 有效日均值`),
                              ),
                              h(
                                'div',
                                { className: 'dsh-3b-meter', 'aria-hidden': 'true' },
                                h(
                                  'span',
                                  { className: 'dsh-3b-meter-track' },
                                  h('span', {
                                    className: 'dsh-3b-meter-fill',
                                    style: { width: `${Math.round((row.recorded / Math.max(1, stageDays)) * 100)}%` },
                                  }),
                                ),
                              ),
                              h('p', { className: 'dsh-3b-metric-note' }, `有记录 ${row.recorded} / ${stageDays} 天 · 缺失 ${row.missing} 天`),
                              row.first
                                ? h(
                                  'p',
                                  { className: 'dsh-3b-metric-note' },
                                  `首条 ${row.first.date} (${formatNum(row.first.value, 2)}) → 末条 ${row.last.date} (${formatNum(row.last.value, 2)}) · 首末差 ${row.difference != null ? (row.difference > 0 ? '+' : '') + formatNum(row.difference, 2) : '—'} ${row.metric.unit || ''}`,
                                )
                                : h('p', { className: 'dsh-3b-metric-note' }, '本区间无可用记录，不按零补齐。'),
                            ),
                          ),
                        ),
                      ),

                      /* 7-Day Workouts Section */
                      h(
                        'section',
                        { className: 'dsh-3b-card' },
                        h(
                          'div',
                          { className: 'dsh-3b-section-head' },
                          h(
                            'div',
                            null,
                            h('h2', null, h('span', { className: 'dsh-3b-section-index', 'aria-hidden': 'true' }, '04'), '训练记录 · 近 7 日'),
                            h(
                              'p',
                              { className: 'dsh-3b-subtitle' },
                              workouts?.available
                                ? `按上海时区自然日统计 · 累计已入库 ${workouts.total_workouts_all || 0} 条 workouts 明细`
                                : (workouts?.note || '尚未导入运动记录'),
                            ),
                          ),
                          workouts?.available && h('span', { className: 'dsh-3b-badge success' }, `近7日 ${workouts.count || 0} 次训练`),
                        ),
                        workouts?.available && h(
                          React.Fragment,
                          null,
                          h(
                            'div',
                            { className: 'dsh-3b-stat-grid' },
                            h(
                              'div',
                              { className: 'dsh-3b-period-item' },
                              h('span', { className: 'dsh-3b-metric-note' }, '近 7 日训练次数'),
                              h('strong', { className: 'dsh-3b-stat-value' }, `${workouts.count || 0} 次`),
                            ),
                            h(
                              'div',
                              { className: 'dsh-3b-period-item' },
                              h('span', { className: 'dsh-3b-metric-note' }, '训练总时长'),
                              h('strong', { className: 'dsh-3b-stat-value' }, `${formatNum(workouts.total_minutes, 1)} 分钟`),
                            ),
                            h(
                              'div',
                              { className: 'dsh-3b-period-item' },
                              h('span', { className: 'dsh-3b-metric-note' }, '训练总消耗'),
                              h('strong', { className: 'dsh-3b-stat-value' }, `${formatNum(workouts.total_energy_kcal, 1)} kcal`),
                            ),
                          ),
                          Array.isArray(workouts.recent) && workouts.recent.length > 0 && h(
                            'div',
                            { className: 'dsh-3b-table-wrap' },
                            h(
                              'table',
                              { className: 'dsh-3b-table' },
                              h(
                                'thead',
                                null,
                                h(
                                  'tr',
                                  null,
                                  h('th', { scope: 'col' }, '日期'),
                                  h('th', { scope: 'col' }, '运动类型'),
                                  h('th', { scope: 'col', className: 'dsh-3b-num' }, '时长（分钟）'),
                                  h('th', { scope: 'col', className: 'dsh-3b-num' }, '消耗（kcal）'),
                                  h('th', { scope: 'col', className: 'dsh-3b-num' }, '距离'),
                                ),
                              ),
                              h(
                                'tbody',
                                null,
                                workouts.recent.map((w, idx) =>
                                  h(
                                    'tr',
                                    { key: idx },
                                    h('td', { className: 'dsh-3b-nowrap' }, w.date),
                                    h('td', null, w.activity),
                                    h('td', { className: 'dsh-3b-num' }, formatNum(w.minutes, 1)),
                                    h('td', { className: 'dsh-3b-num' }, formatNum(w.energy_kcal, 1)),
                                    h('td', { className: 'dsh-3b-num' }, w.distance == null ? '—' : `${formatNum(w.distance, 2)} ${w.distance_unit || ''}`),
                                  ),
                                ),
                              ),
                            ),
                          ),
                        ),
                      ),

                      /* Coverage & Methods Footer Details */
                      health && h(
                        'details',
                        { className: 'dsh-3b-card' },
                        h('summary', null, '查看数据覆盖范围与统计口径说明'),
                        h(
                          'div',
                          { className: 'dsh-3b-details-body' },
                          Array.isArray(health.coverage) && h(
                            'p',
                            { className: 'dsh-3b-metric-note' },
                            `历史覆盖范围：${health.coverage[0]} 至 ${health.coverage[1]} · SQL 主库去重记录 ${formatNum(health.coverage[2], 0)} 条 · 最近导入时间：${health.imported_at || '—'} · 快照生成时间：${health.generated_at || '—'}`,
                          ),
                          Array.isArray(health.methods) && h(
                            'ul',
                            { className: 'dsh-3b-details-list' },
                            health.methods.map((m, i) => h('li', { key: i }, m)),
                          ),
                        ),
                      ),
                    ),
                    h(FocusSidebar, {
                      model: focusModel,
                      onSaveProfile: saveProfile,
                      savingProfile,
                      profileError,
                    }),
                  ),
                ),

          /* Modals */
          checkinModalCat && h(CheckinModal, {
            initialCategory: checkinModalCat,
            checkinsData: checkins,
            onClose: () => setCheckinModalCat(null),
            onSaved: (updatedCheckins) => {
              setDash(prev => (prev ? { ...prev, checkins: updatedCheckins } : prev))
              if (dashboardCache) {
                dashboardCache = { data: { ...dashboardCache.data, checkins: updatedCheckins }, at: Date.now() }
              }
              setToastMsg('打卡已保存并写入插件留痕')
            },
          }),

          showTracesModal && h(TracesModal, {
            onClose: () => setShowTracesModal(false),
          }),
        ),
      )
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        const startDshAnalysis = (job) => {
          const prompt = job?.handoff_prompt || ''
          const uiWorkspace = ctx.get('uiWorkspace')
          const layout = ctx.get('layout')
          try {
            if (uiWorkspace && typeof uiWorkspace.startSession === 'function') {
              uiWorkspace.startSession(undefined, {
                prompt,
                whenDraftExists: 'replace',
              })
              return { ok: true }
            }
          } catch (_err) {
            // fallback below
          }
          try {
            if (navigator.clipboard?.writeText && prompt) {
              navigator.clipboard.writeText(prompt)
            }
          } catch (_e) {}
          if (layout && typeof layout.selectPanel === 'function') {
            layout.selectPanel(null)
          }
          return { ok: true, fallbackCopied: true }
        }

        const BoundMainPanel = () => h(HealthMainPanel, { startDshAnalysis })

        ctx.slots.inject('sidebar.panellist', () =>
          ctx.slots.register(
            {
              name: 'sidebar.panellist',
              id: '3b-health',
              order: 30,
              label: () => '3B健康',
            },
            HealthSidebarIcon,
          ),
        )

        ctx.slots.inject('main', () =>
          ctx.slots.register(
            {
              name: 'main',
              key: '3b-health',
            },
            BoundMainPanel,
          ),
        )
      },
    }
  },
})
