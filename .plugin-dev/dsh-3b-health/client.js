/**
 * Browser client module of @local/dsh-3b-health.
 * Registers:
 *   - Left sidebar entry (`sidebar.panellist`, id: '3b-health', label: '3B健康')
 *   - Right main view (`main`, key: '3b-health')
 * Features:
 *   1. 健康仪表盘: 4 core cards (with interactive 饮食记录 & 精力自评 check-ins),
 *      6 customizable trend charts (43 metrics × 30/90/365d persisted on backend),
 *      stage summary, and 7-day workouts.
 *   2. 手机同步: iCloud folder sync status, manual check trigger, Health JSON & ZIP DB stats.
 *   3. AI 健康分析: Native DSH analysis package builder + one-click jump into DSH session.
 *   4. 写入留痕: Audit drawer viewing all records written via `@local/dsh-3b-health`.
 */
window.__ModuleLoader__.load({
  id: '@local/dsh-3b-health',
  factory(require) {
    const React = require('react')
    const { useState, useEffect, useCallback, useMemo } = React
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
          --3b-page-max: 960px;
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

      const health = dash?.health
      const diagnostics = dash?.diagnostics || null
      const store = dash?.store || null
      const prefs = dash?.preferences || {
        metrics: ['sleep', 'steps', 'active_energy', 'body_mass', 'body_fat', 'lean_body_mass'],
        periods: [30, 30, 30, 30, 30, 30],
        stage_days: 30,
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
        { className: 'dsh-3b-health-root' },
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
