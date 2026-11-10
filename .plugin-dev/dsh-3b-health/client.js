/**
 * Browser client module of @local/dsh-3b-health.
 * Registers:
 *   - Left sidebar entry (`sidebar.panellist`, id: '3b-health', label: '3B健康')
 *   - Right main view (`main`, key: '3b-health')
 * Features:
 *   1. 健康仪表盘: 4 core cards (with interactive 饮食记录 & 精力自评 check-ins),
 *      6 customizable trend charts (44 metrics × 30/90/365d persisted on backend),
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
      if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return
      const style = document.createElement('style')
      style.id = STYLE_ID
      style.textContent = `
        .dsh-3b-health-root {
          height: 100%;
          width: 100%;
          overflow-y: auto;
          background: var(--dsw-alias-bg-primary, #0f1115);
          color: var(--dsw-alias-text-primary, #e6e8ee);
          font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", sans-serif;
          padding: 24px 28px 48px;
          box-sizing: border-box;
        }
        .dsh-3b-health-container {
          max-width: 1280px;
          margin: 0 auto;
          display: flex;
          flex-direction: column;
          gap: 20px;
        }
        .dsh-3b-topbar {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          justify-content: space-between;
          gap: 14px;
          padding-bottom: 16px;
          border-bottom: 1px solid var(--dsw-alias-border-l1, rgba(128,128,128,0.18));
        }
        .dsh-3b-brand {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .dsh-3b-brand-row {
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .dsh-3b-title {
          font-size: 20px;
          font-weight: 650;
          margin: 0;
          letter-spacing: -0.01em;
        }
        .dsh-3b-badge {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          font-size: 11px;
          font-weight: 500;
          padding: 2px 8px;
          border-radius: 999px;
          background: rgba(16, 185, 129, 0.14);
          color: #10b981;
          border: 1px solid rgba(16, 185, 129, 0.28);
        }
        .dsh-3b-badge.blue {
          background: rgba(59, 130, 246, 0.14);
          color: #60a5fa;
          border-color: rgba(59, 130, 246, 0.28);
        }
        .dsh-3b-badge.amber {
          background: rgba(245, 158, 11, 0.14);
          color: #fbbf24;
          border-color: rgba(245, 158, 11, 0.28);
        }
        .dsh-3b-subtitle {
          font-size: 12px;
          color: var(--dsw-alias-text-secondary, #9ca3af);
          margin: 0;
        }
        .dsh-3b-nav {
          display: flex;
          align-items: center;
          gap: 6px;
          background: var(--dsw-alias-bg-secondary, rgba(128,128,128,0.08));
          padding: 4px;
          border-radius: 10px;
          border: 1px solid var(--dsw-alias-border-l1, rgba(128,128,128,0.16));
        }
        .dsh-3b-tab {
          border: none;
          background: transparent;
          color: var(--dsw-alias-text-secondary, #9ca3af);
          font-size: 13px;
          font-weight: 500;
          padding: 6px 14px;
          border-radius: 7px;
          cursor: pointer;
          transition: all 0.15s ease;
        }
        .dsh-3b-tab:hover {
          color: var(--dsw-alias-text-primary, #fff);
        }
        .dsh-3b-tab.active {
          background: var(--dsw-alias-bg-primary, #181b22);
          color: var(--dsw-alias-text-primary, #fff);
          box-shadow: 0 1px 3px rgba(0,0,0,0.2);
        }
        .dsh-3b-actions {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-wrap: wrap;
        }
        .dsh-3b-btn {
          border: 1px solid var(--dsw-alias-border-l1, rgba(128,128,128,0.24));
          background: var(--dsw-alias-bg-secondary, rgba(128,128,128,0.1));
          color: var(--dsw-alias-text-primary, #e6e8ee);
          font-size: 12.5px;
          font-weight: 500;
          padding: 6px 12px;
          border-radius: 8px;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          gap: 6px;
          transition: all 0.15s ease;
        }
        .dsh-3b-btn:hover:not(:disabled) {
          border-color: var(--dsw-alias-interactive-primary, #3b82f6);
          background: rgba(59, 130, 246, 0.1);
        }
        .dsh-3b-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        .dsh-3b-btn.primary {
          background: #2563eb;
          border-color: #3b82f6;
          color: #ffffff;
        }
        .dsh-3b-btn.primary:hover:not(:disabled) {
          background: #1d4ed8;
        }
        .dsh-3b-btn.mint {
          background: rgba(16, 185, 129, 0.15);
          border-color: rgba(16, 185, 129, 0.35);
          color: #10b981;
        }
        .dsh-3b-btn.mint:hover:not(:disabled) {
          background: rgba(16, 185, 129, 0.25);
        }
        .dsh-3b-btn.danger {
          color: #f87171;
          border-color: rgba(248, 113, 113, 0.3);
          background: rgba(248, 113, 113, 0.08);
        }
        .dsh-3b-metrics-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
          gap: 14px;
        }
        .dsh-3b-card {
          background: var(--dsw-alias-bg-secondary, rgba(128,128,128,0.06));
          border: 1px solid var(--dsw-alias-border-l1, rgba(128,128,128,0.16));
          border-radius: 12px;
          padding: 16px 18px;
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .dsh-3b-card.interactive {
          cursor: pointer;
          transition: border-color 0.15s ease, transform 0.12s ease;
        }
        .dsh-3b-card.interactive:hover {
          border-color: #3b82f6;
          transform: translateY(-1px);
        }
        .dsh-3b-metric-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          font-size: 12.5px;
          color: var(--dsw-alias-text-secondary, #9ca3af);
        }
        .dsh-3b-metric-val {
          display: flex;
          align-items: baseline;
          gap: 6px;
          margin: 2px 0;
        }
        .dsh-3b-metric-val strong {
          font-size: 26px;
          font-weight: 700;
          letter-spacing: -0.02em;
        }
        .dsh-3b-metric-val.mint strong { color: #10b981; }
        .dsh-3b-metric-val.blue strong { color: #60a5fa; }
        .dsh-3b-metric-val.amber strong { color: #fbbf24; }
        .dsh-3b-metric-val.purple strong { color: #c084fc; }
        .dsh-3b-metric-note {
          font-size: 12px;
          color: var(--dsw-alias-text-tertiary, #8b92a5);
          margin: 0;
          line-height: 1.45;
        }
        .dsh-3b-section-head {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          margin-bottom: 6px;
        }
        .dsh-3b-section-head h2 {
          font-size: 16px;
          font-weight: 600;
          margin: 0;
        }
        .dsh-3b-trends-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(360px, 1fr));
          gap: 14px;
        }
        .dsh-3b-chart-head {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
        }
        .dsh-3b-chart-controls {
          display: flex;
          align-items: center;
          justify-content: space-between;
          width: 100%;
          gap: 8px;
        }
        .dsh-3b-select, .dsh-3b-input, .dsh-3b-textarea {
          background: var(--dsw-alias-bg-primary, #12151c);
          color: var(--dsw-alias-text-primary, #e6e8ee);
          border: 1px solid var(--dsw-alias-border-l1, rgba(128,128,128,0.24));
          border-radius: 7px;
          padding: 5px 10px;
          font-size: 12.5px;
          font-weight: 500;
          box-sizing: border-box;
        }
        .dsh-3b-textarea {
          width: 100%;
          padding: 8px 10px;
          font-size: 13px;
          line-height: 1.5;
          resize: vertical;
        }
        .dsh-3b-plot-wrap {
          display: grid;
          grid-template-columns: 48px 1fr;
          gap: 8px;
          align-items: stretch;
          height: 148px;
          margin-top: 6px;
        }
        .dsh-3b-yaxis {
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          font-size: 10.5px;
          color: var(--dsw-alias-text-tertiary, #8b92a5);
          text-align: right;
          padding: 2px 0;
        }
        .dsh-3b-bars {
          position: relative;
          display: grid;
          align-items: end;
          height: 100%;
          background: rgba(128,128,128,0.04);
          border-radius: 8px;
          padding: 6px 6px 0;
          box-sizing: border-box;
          overflow: hidden;
        }
        .dsh-3b-bar-slot {
          height: 100%;
          display: flex;
          align-items: flex-end;
        }
        .dsh-3b-bar {
          width: 100%;
          background: linear-gradient(180deg, #3b82f6 0%, rgba(59,130,246,0.45) 100%);
          border-radius: 2px 2px 0 0;
          transition: opacity 0.12s;
        }
        .dsh-3b-bar:hover {
          opacity: 0.85;
          background: #60a5fa;
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
          stroke: #fbbf24;
          stroke-width: 1.5;
          stroke-dasharray: 4 3;
        }
        .dsh-3b-reg-line {
          stroke: #10b981;
          stroke-width: 2;
        }
        .dsh-3b-xaxis {
          display: flex;
          justify-content: space-between;
          font-size: 11px;
          color: var(--dsw-alias-text-tertiary, #8b92a5);
          padding-left: 56px;
        }
        .dsh-3b-chart-meta {
          display: flex;
          flex-wrap: wrap;
          gap: 10px;
          font-size: 11.5px;
          color: var(--dsw-alias-text-secondary, #9ca3af);
          padding-top: 4px;
          border-top: 1px dashed var(--dsw-alias-border-l1, rgba(128,128,128,0.14));
        }
        .dsh-3b-period-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
          gap: 12px;
        }
        .dsh-3b-period-item {
          background: rgba(128,128,128,0.04);
          border: 1px solid var(--dsw-alias-border-l1, rgba(128,128,128,0.14));
          border-radius: 10px;
          padding: 12px 14px;
          display: flex;
          flex-direction: column;
          gap: 5px;
        }
        .dsh-3b-period-item h4 {
          margin: 0;
          font-size: 13.5px;
          font-weight: 600;
        }
        .dsh-3b-table-wrap {
          overflow-x: auto;
        }
        .dsh-3b-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 12.5px;
        }
        .dsh-3b-table th, .dsh-3b-table td {
          text-align: left;
          padding: 8px 10px;
          border-bottom: 1px solid var(--dsw-alias-border-l1, rgba(128,128,128,0.14));
        }
        .dsh-3b-table th {
          color: var(--dsw-alias-text-secondary, #9ca3af);
          font-weight: 500;
        }
        .dsh-3b-tag-list {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
        }
        .dsh-3b-tag-chip {
          border: 1px solid var(--dsw-alias-border-l1, rgba(128,128,128,0.24));
          background: transparent;
          color: var(--dsw-alias-text-secondary, #9ca3af);
          font-size: 12px;
          padding: 4px 10px;
          border-radius: 999px;
          cursor: pointer;
        }
        .dsh-3b-tag-chip.selected {
          background: rgba(59, 130, 246, 0.18);
          border-color: #3b82f6;
          color: #60a5fa;
          font-weight: 500;
        }
        .dsh-3b-modal-backdrop {
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, 0.62);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 9999;
          padding: 20px;
        }
        .dsh-3b-modal {
          background: var(--dsw-alias-bg-primary, #161920);
          border: 1px solid var(--dsw-alias-border-l1, rgba(128,128,128,0.28));
          border-radius: 14px;
          width: 100%;
          max-width: 680px;
          max-height: 86vh;
          overflow-y: auto;
          padding: 20px 24px;
          display: flex;
          flex-direction: column;
          gap: 14px;
          box-shadow: 0 20px 50px rgba(0,0,0,0.5);
        }
        .dsh-3b-notice {
          padding: 10px 14px;
          border-radius: 8px;
          background: rgba(245, 158, 11, 0.12);
          border: 1px solid rgba(245, 158, 11, 0.3);
          color: #fbbf24;
          font-size: 12.5px;
          line-height: 1.5;
        }
        .dsh-3b-success {
          padding: 10px 14px;
          border-radius: 8px;
          background: rgba(16, 185, 129, 0.12);
          border: 1px solid rgba(16, 185, 129, 0.3);
          color: #34d399;
          font-size: 12.5px;
          line-height: 1.5;
        }
        .dsh-3b-pre {
          background: rgba(0,0,0,0.28);
          border: 1px solid var(--dsw-alias-border-l1, rgba(128,128,128,0.18));
          border-radius: 8px;
          padding: 12px;
          font-size: 12px;
          line-height: 1.5;
          overflow-x: auto;
          white-space: pre-wrap;
          word-break: break-word;
          max-height: 320px;
        }
      `
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
          strokeWidth: 1.85,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': 'true',
        },
        h('path', { d: 'M19.5 12.572 12 20l-7.5-7.428A5 5 0 1 1 12 6.006a5 5 0 1 1 7.5 6.572' }),
        h('path', { d: 'M8 12h2l1.2-2.5L13 14.5 14.2 12H16' }),
      )
    }

    /** Single Trend Chart Card (Dropdown-only header, no duplicate numbered title) */
    function TrendChartCard({ slotIndex, trendData, metricsList, activeMetricId, days, onSelectMetric, onSelectPeriod }) {
      const active = useMemo(
        () => metricsList.find(m => m.id === activeMetricId) || metricsList[0] || null,
        [metricsList, activeMetricId],
      )
      if (!active) {
        return h('div', { className: 'dsh-3b-card' }, h('p', { className: 'dsh-3b-metric-note' }, `趋势图 ${slotIndex + 1} 暂无可用指标`))
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
          { className: 'dsh-3b-chart-head' },
          h(
            'div',
            { className: 'dsh-3b-chart-controls' },
            h(
              'select',
              {
                className: 'dsh-3b-select',
                style: { flex: '1 1 auto', minWidth: '150px' },
                value: active.id,
                'aria-label': `趋势 ${slotIndex + 1} 指标`,
                onChange: e => onSelectMetric(slotIndex, e.target.value),
              },
              metricsList.map(m => h('option', { key: m.id, value: m.id }, healthTrendLabel(m))),
            ),
            h(
              'select',
              {
                className: 'dsh-3b-select',
                value: days,
                'aria-label': `趋势 ${slotIndex + 1} 时间段`,
                onChange: e => onSelectPeriod(slotIndex, Number(e.target.value)),
              },
              PERIOD_OPTIONS.map(d => h('option', { key: d, value: d }, `${d}天`)),
            ),
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
              h('span', null, `${active.unit || '无单位'} · 虚线均值 / 绿线线性回归`),
              h('span', null, dates[dates.length - 1] || ''),
            ),
          )
          : h(
            'div',
            { style: { padding: '32px 0', textAlign: 'center', color: 'var(--dsw-alias-text-tertiary, #8b92a5)', fontSize: '12.5px' } },
            `该指标在最近 ${days} 天暂无可用记录`,
          ),
        h(
          'div',
          { className: 'dsh-3b-chart-meta' },
          h('span', null, `最新：${latestObs ? `${formatNum(latestObs.value, 2)} ${active.unit || ''} (${latestObs.date})` : '—'}`),
          h('span', null, `均值：${formatNum(average, 2)} ${active.unit || ''}`),
          h('span', null, `有效日：${numbers.length}/${days}`),
          limited && h('span', { style: { color: '#fbbf24' } }, `已载入 ${loadedDays} 天`),
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
          { className: 'dsh-3b-modal', onClick: e => e.stopPropagation() },
          h(
            'div',
            { className: 'dsh-3b-section-head' },
            h(
              'div',
              { style: { display: 'flex', alignItems: 'center', gap: '10px' } },
              h('h2', null, category === 'diet' ? '饮食记录打卡' : '精力自评打卡'),
              h('span', { className: 'dsh-3b-badge' }, '通过 dsh 3B健康插件写入'),
            ),
            h('button', { className: 'dsh-3b-btn', onClick: onClose }, '关闭'),
          ),
          h(
            'div',
            { className: 'dsh-3b-nav', style: { alignSelf: 'flex-start' } },
            h(
              'button',
              {
                type: 'button',
                className: 'dsh-3b-tab' + (category === 'diet' ? ' active' : ''),
                onClick: () => switchCategory('diet'),
              },
              '饮食记录',
            ),
            h(
              'button',
              {
                type: 'button',
                className: 'dsh-3b-tab' + (category === 'energy' ? ' active' : ''),
                onClick: () => switchCategory('energy'),
              },
              '精力自评',
            ),
          ),
          err && h('div', { className: 'dsh-3b-notice' }, err),
          h(
            'form',
            { onSubmit: handleSubmit, style: { display: 'flex', flexDirection: 'column', gap: '12px' } },
            h(
              'div',
              { style: { display: 'flex', flexWrap: 'wrap', gap: '12px', alignItems: 'center' } },
              h(
                'label',
                { style: { fontSize: '12.5px', display: 'flex', alignItems: 'center', gap: '6px' } },
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
                { style: { fontSize: '12.5px', display: 'flex', alignItems: 'center', gap: '6px' } },
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
                { style: { fontSize: '12.5px', display: 'flex', alignItems: 'center', gap: '6px' } },
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
              h('div', { style: { fontSize: '12px', color: 'var(--dsw-alias-text-secondary, #9ca3af)', marginBottom: '6px' } }, '快捷标签（可多选）：'),
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
              { style: { display: 'flex', justifyContent: 'flex-end', gap: '8px' } },
              h(
                'button',
                { type: 'submit', className: 'dsh-3b-btn primary', disabled: busy },
                busy ? '正在写入…' : `保存${category === 'diet' ? '饮食记录' : '精力自评'}（带插件留痕）`,
              ),
            ),
          ),
          h(
            'div',
            { style: { borderTop: '1px solid var(--dsw-alias-border-l1, rgba(128,128,128,0.18))', paddingTop: '12px' } },
            h('h3', { style: { fontSize: '13.5px', margin: '0 0 8px' } }, `近期${category === 'diet' ? '饮食记录' : '精力自评'}（最近 30 天）`),
            filteredHistory.length === 0
              ? h('p', { className: 'dsh-3b-metric-note' }, '尚无记录，可在上方添加第一条打卡。')
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
                      h('th', null, '日期'),
                      category === 'diet' && h('th', null, '餐次'),
                      h('th', null, '评分'),
                      h('th', null, '标签与备注'),
                      h('th', null, '写入来源'),
                      h('th', null, '操作'),
                    ),
                  ),
                  h(
                    'tbody',
                    null,
                    filteredHistory.slice(0, 20).map(row =>
                      h(
                        'tr',
                        { key: row.id },
                        h('td', null, row.record_date),
                        category === 'diet' && h('td', null, row.meal_type || '—'),
                        h('td', null, row.score != null ? `${row.score} 分` : '—'),
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
                              className: 'dsh-3b-btn danger',
                              style: { padding: '2px 8px', fontSize: '11.5px' },
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
          { className: 'dsh-3b-modal', style: { maxWidth: '780px' }, onClick: e => e.stopPropagation() },
          h(
            'div',
            { className: 'dsh-3b-section-head' },
            h(
              'div',
              { style: { display: 'flex', alignItems: 'center', gap: '10px' } },
              h('h2', null, '插件写入留痕记录'),
              h('span', { className: 'dsh-3b-badge' }, '通过 dsh 3B健康插件写入'),
            ),
            h('button', { className: 'dsh-3b-btn', onClick: onClose }, '关闭'),
          ),
          h(
            'p',
            { className: 'dsh-3b-subtitle' },
            '所有通过 DSH「3B健康」插件执行的打卡、偏好配置、同步触发与分析任务生成，均在 SQLite (dsh_plugin_traces) 与 dsh-plugin-traces.jsonl 双重留痕。',
          ),
          loading
            ? h('p', { className: 'dsh-3b-metric-note' }, '正在读取写入留痕…')
            : traces.length === 0
              ? h('p', { className: 'dsh-3b-metric-note' }, '尚无插件写入记录。')
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
                      h('th', null, '时间'),
                      h('th', null, '动作'),
                      h('th', null, '留痕摘要'),
                      h('th', null, '来源标识'),
                    ),
                  ),
                  h(
                    'tbody',
                    null,
                    traces.map(item =>
                      h(
                        'tr',
                        { key: item.id },
                        h('td', { style: { whiteSpace: 'nowrap' } }, String(item.created_at || '').replace('T', ' ').slice(0, 19)),
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
        const timer = setInterval(loadSync, 15000)
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
        { style: { display: 'flex', flexDirection: 'column', gap: '16px' } },
        issue && h('div', { className: 'dsh-3b-notice' }, `健康同步提醒：${issue}`),
        err && h('div', { className: 'dsh-3b-notice' }, err),
        msg && h('div', { className: 'dsh-3b-success' }, msg),
        h(
          'section',
          { className: 'dsh-3b-card' },
          h(
            'div',
            { className: 'dsh-3b-section-head' },
            h(
              'div',
              { style: { display: 'flex', alignItems: 'center', gap: '10px' } },
              h('h2', null, 'iCloud 文件夹自动同步'),
              h('span', { className: 'dsh-3b-badge blue' }, 'DataCenter 每 5 分钟'),
            ),
            h(
              'button',
              { className: 'dsh-3b-btn primary', disabled: busy, onClick: handleTriggerSync },
              busy ? '正在刷新状态…' : '刷新状态（只读）',
            ),
          ),
          folder
            ? h(
              React.Fragment,
              null,
              h(
                'p',
                { style: { margin: '4px 0', fontSize: '13px' } },
                `${folder.phase === 'checking' ? '本次检查启动：' : '最近检查时间：'}${folder.checked_at ? new Date(folder.checked_at).toLocaleString('zh-CN') : '未知'}`,
              ),
              h('p', { style: { margin: '4px 0', fontSize: '13px', fontWeight: 500 } }, folder.message || '等待新导出文件'),
              folder.phase !== 'checking' && h(
                'p',
                { className: 'dsh-3b-metric-note' },
                `最近一次扫描新增 ${folder.added || 0} 条数据点；待处理文件 ${folder.pending || 0} 份；导入异常 ${folder.errors || 0} 份。`,
              ),
              Array.isArray(folder.problems) && folder.problems.length > 0 && h(
                'div',
                { style: { marginTop: '8px' } },
                folder.problems.map((p, idx) =>
                  h(
                    'p',
                    { key: idx, className: 'dsh-3b-metric-note', style: { color: '#fbbf24' } },
                    `文件 ${p.file}：${SYNC_PROBLEM_LABELS[p.kind] || '读取异常'}${p.detail ? `（${p.detail}）` : ''}`,
                  ),
                ),
              ),
            )
            : h('p', { className: 'dsh-3b-metric-note' }, '尚无 DataCenter 同步状态记录，请先确认 local.datacenter.health 任务正在运行。'),
          store && h(
            'p',
            { className: 'dsh-3b-metric-note' },
            `数据目录：${store.dir || '未解析'}${store.source === 'datacenter' ? '（DataCenter）' : ''}${store.usable === false ? ` · 不可用：${store.reason || '未知原因'}` : ''}`,
          ),
          folder?.last_success && h(
            'p',
            { className: 'dsh-3b-metric-note' },
            `最近成功导入：${new Date(folder.last_success).toLocaleString('zh-CN')}`,
          ),
          h(
            'p',
            { className: 'dsh-3b-metric-note', style: { marginTop: '6px' } },
            '手机通过 Health Auto Export 导出到 iCloud；导入与摘要由 DataCenter 的 local.datacenter.health 任务每 5 分钟执行。本插件只读取状态，不写入其状态文件。',
          ),
        ),
        h(
          'div',
          { className: 'dsh-3b-metrics-grid' },
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
              { className: 'dsh-3b-metric-val mint' },
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
              h('span', { className: 'dsh-3b-badge blue' }, 'ZIP 全量去重'),
            ),
            h(
              'div',
              { className: 'dsh-3b-metric-val blue' },
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
        { style: { display: 'flex', flexDirection: 'column', gap: '18px' } },
        err && h('div', { className: 'dsh-3b-notice' }, err),
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
                { className: 'dsh-3b-subtitle', style: { marginTop: '4px' } },
                '无需外接 Codex CLI：直接在 ~/Library/Application Support/ThreeBody/AgentAnalysis 下生成脱敏摘要包，并一键跳回 DSH 主对话窗口填入分析提示词。',
              ),
            ),
            h('span', { className: 'dsh-3b-badge' }, 'DSH 原生直连 · 带插件留痕'),
          ),
          h(
            'div',
            { style: { display: 'flex', flexWrap: 'wrap', gap: '14px', marginTop: '6px' } },
            h(
              'label',
              { style: { fontSize: '12.5px', display: 'flex', alignItems: 'center', gap: '6px' } },
              '分析范围：',
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
              { style: { fontSize: '12.5px', display: 'flex', alignItems: 'center', gap: '6px' } },
              '统计窗口：',
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
              { style: { fontSize: '12.5px', display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' } },
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
            {
              style: {
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                gap: '8px',
                marginTop: '6px',
              },
            },
            Array.from({ length: 6 }, (_, idx) =>
              h(
                'label',
                { key: idx, style: { fontSize: '12px', display: 'flex', flexDirection: 'column', gap: '4px' } },
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
            { style: { marginTop: '6px' } },
            h(
              'div',
              { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px', flexWrap: 'wrap', gap: '6px' } },
              h('span', { style: { fontSize: '12.5px', fontWeight: 500 } }, '希望 DSH Agent 重点分析什么：'),
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
            { className: 'dsh-3b-actions', style: { marginTop: '4px' } },
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
              { style: { display: 'flex', alignItems: 'center', gap: '10px' } },
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
            { className: 'dsh-3b-metric-note' },
            `任务工作区路径：${activeJob.workspace_path} · 生成时间：${String(activeJob.created_at || '').replace('T', ' ').slice(0, 19)}`,
          ),
          activeJob.report && h(
            'div',
            { style: { marginTop: '8px' } },
            h('h3', { style: { fontSize: '13.5px', margin: '0 0 6px', color: '#10b981' } }, 'DSH Agent 已生成的健康分析报告 (outputs/report.md)：'),
            h('pre', { className: 'dsh-3b-pre' }, activeJob.report),
          ),
          h(
            'details',
            { style: { marginTop: '6px' } },
            h('summary', { style: { cursor: 'pointer', fontSize: '12.5px', color: 'var(--dsw-alias-text-secondary, #9ca3af)' } }, '查看任务说明 (context.md) 与脱敏数据摘要 (summary.json)'),
            h('pre', { className: 'dsh-3b-pre', style: { marginTop: '8px' } }, activeJob.context || ''),
            activeJob.summary && h('pre', { className: 'dsh-3b-pre', style: { marginTop: '8px' } }, JSON.stringify(activeJob.summary, null, 2)),
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
            ? h('p', { className: 'dsh-3b-metric-note' }, '尚无历史健康分析任务，可在上方一键创建。')
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
                    h('th', null, '任务编号'),
                    h('th', null, '类型'),
                    h('th', null, '创建时间'),
                    h('th', null, '报告状态'),
                    h('th', null, '操作'),
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
                      h('td', null, String(item.created_at || '').replace('T', ' ').slice(0, 19)),
                      h(
                        'td',
                        null,
                        item.has_report
                          ? h('span', { className: 'dsh-3b-badge' }, '已生成报告')
                          : h('span', { className: 'dsh-3b-badge amber' }, '待分析'),
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
                              className: 'dsh-3b-btn',
                              style: { padding: '3px 9px', fontSize: '11.5px' },
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
                store && !store.usable && h('span', { className: 'dsh-3b-badge amber' }, '数据目录不可用'),
                diagnostics?.summary_outdated && h('span', { className: 'dsh-3b-badge amber' }, '有新导出未汇总'),
              ),
              h(
                'p',
                { className: 'dsh-3b-subtitle' },
                `资料截至 ${health?.latest_source_date || '读取中'} · 快照生成 ${diagnostics?.summary_generated_at ? new Date(diagnostics.summary_generated_at).toLocaleString('zh-CN') : '未知'} · ${health?.data_source === 'health-export' ? 'Health Data Export 自动同步' : '本地健康资料库'}`,
              ),
              h(
                'p',
                { className: 'dsh-3b-metric-note', style: { marginTop: '2px' } },
                `数据目录：${store?.dir || '未解析'}${store?.source === 'datacenter' ? '（DataCenter）' : ''}${Number(diagnostics?.data_lag_days) > 0 ? ` · 距今 ${diagnostics.data_lag_days} 天` : ''}`,
              ),
            ),
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
                    onClick: () => setActiveTab(key),
                  },
                  label,
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
                  className: 'dsh-3b-btn mint',
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
                  className: 'dsh-3b-btn',
                  onClick: () => setPrivacy(p => !p),
                },
                privacy ? '恢复展示' : '隐私遮蔽',
              ),
              h(
                'button',
                {
                  type: 'button',
                  className: 'dsh-3b-btn',
                  disabled: loading,
                  onClick: () => loadDashboard(),
                },
                loading ? '刷新中…' : '刷新',
              ),
            ),
          ),

          toastMsg && h('div', { className: 'dsh-3b-success' }, toastMsg),
          err && h('div', { className: 'dsh-3b-notice' }, err),
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
              { className: 'dsh-3b-card', style: { padding: '48px 24px', textAlign: 'center', alignItems: 'center' } },
              h('h2', { style: { margin: '0 0 8px' } }, '个人健康数据已隐藏'),
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
                    { className: 'dsh-3b-notice', style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px' } },
                    h('span', null, `同步状态提醒：${syncIssue}`),
                    h(
                      'button',
                      { type: 'button', className: 'dsh-3b-btn', onClick: () => setActiveTab('sync') },
                      '查看手机同步 →',
                    ),
                  ),

                  /* Top 4 Summary Cards */
                  h(
                    'section',
                    { className: 'dsh-3b-metrics-grid', 'aria-label': '核心健康指标与日常打卡' },
                    h(
                      'div',
                      { className: 'dsh-3b-card' },
                      h('div', { className: 'dsh-3b-metric-head' }, h('span', null, '7日运动汇总'), h('span', { className: 'dsh-3b-badge' }, '自动统计')),
                      h(
                        'div',
                        { className: 'dsh-3b-metric-val mint' },
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
                      { className: 'dsh-3b-card' },
                      h('div', { className: 'dsh-3b-metric-head' }, h('span', null, '可用睡眠平均时长'), h('span', { className: 'dsh-3b-badge blue' }, '自动统计')),
                      h(
                        'div',
                        { className: 'dsh-3b-metric-val blue' },
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
                      'div',
                      {
                        className: 'dsh-3b-card interactive',
                        onClick: () => setCheckinModalCat('diet'),
                        role: 'button',
                        tabIndex: 0,
                      },
                      h(
                        'div',
                        { className: 'dsh-3b-metric-head' },
                        h('span', null, '饮食记录（点击录入）'),
                        h('span', { className: 'dsh-3b-badge amber' }, '可交互 · 留痕'),
                      ),
                      h(
                        'div',
                        { className: 'dsh-3b-metric-val amber' },
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
                      'div',
                      {
                        className: 'dsh-3b-card interactive',
                        onClick: () => setCheckinModalCat('energy'),
                        role: 'button',
                        tabIndex: 0,
                      },
                      h(
                        'div',
                        { className: 'dsh-3b-metric-head' },
                        h('span', null, '精力自评（点击录入）'),
                        h('span', { className: 'dsh-3b-badge blue' }, '可交互 · 留痕'),
                      ),
                      h(
                        'div',
                        { className: 'dsh-3b-metric-val purple' },
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

                  /* 6 Independent Trend Charts */
                  h(
                    'section',
                    { style: { display: 'flex', flexDirection: 'column', gap: '12px' } },
                    h(
                      'div',
                      { className: 'dsh-3b-section-head' },
                      h(
                        'div',
                        null,
                        h('h2', null, '六组独立健康趋势（43 项指标 × 30/90/365 天）'),
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
                        h('h2', null, '健康阶段总结'),
                        h('p', { className: 'dsh-3b-subtitle' }, '跟随上方六图所选指标，按统一时间段核对有效日均值、覆盖天数与首末变化。'),
                      ),
                      h(
                        'div',
                        { className: 'dsh-3b-actions' },
                        h(
                          'label',
                          { style: { fontSize: '12.5px', display: 'flex', alignItems: 'center', gap: '6px' } },
                          '总结周期：',
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
                            { style: { fontSize: '18px', fontWeight: 700, color: '#60a5fa' } },
                            `${formatNum(row.mean, 2)} `,
                            h('span', { style: { fontSize: '12px', fontWeight: 400, color: 'var(--dsw-alias-text-secondary, #9ca3af)' } }, `${row.metric.unit || ''} · 有效日均值`),
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
                        h('h2', null, '训练记录 · 近 7 日'),
                        h(
                          'p',
                          { className: 'dsh-3b-subtitle' },
                          workouts?.available
                            ? `按上海时区自然日统计 · 累计已入库 ${workouts.total_workouts_all || 0} 条 workouts 明细`
                            : (workouts?.note || '尚未导入运动记录'),
                        ),
                      ),
                      workouts?.available && h('span', { className: 'dsh-3b-badge mint' }, `近7日 ${workouts.count || 0} 次训练`),
                    ),
                    workouts?.available && h(
                      React.Fragment,
                      null,
                      h(
                        'div',
                        { className: 'dsh-3b-metrics-grid' },
                        h(
                          'div',
                          { className: 'dsh-3b-period-item' },
                          h('span', { className: 'dsh-3b-metric-note' }, '近 7 日训练次数'),
                          h('strong', { style: { fontSize: '20px' } }, `${workouts.count || 0} 次`),
                        ),
                        h(
                          'div',
                          { className: 'dsh-3b-period-item' },
                          h('span', { className: 'dsh-3b-metric-note' }, '训练总时长'),
                          h('strong', { style: { fontSize: '20px' } }, `${formatNum(workouts.total_minutes, 1)} 分钟`),
                        ),
                        h(
                          'div',
                          { className: 'dsh-3b-period-item' },
                          h('span', { className: 'dsh-3b-metric-note' }, '训练总消耗'),
                          h('strong', { style: { fontSize: '20px' } }, `${formatNum(workouts.total_energy_kcal, 1)} kcal`),
                        ),
                      ),
                      Array.isArray(workouts.recent) && workouts.recent.length > 0 && h(
                        'div',
                        { className: 'dsh-3b-table-wrap', style: { marginTop: '8px' } },
                        h(
                          'table',
                          { className: 'dsh-3b-table' },
                          h(
                            'thead',
                            null,
                            h(
                              'tr',
                              null,
                              h('th', null, '日期'),
                              h('th', null, '运动类型'),
                              h('th', null, '时长（分钟）'),
                              h('th', null, '消耗（kcal）'),
                              h('th', null, '距离'),
                            ),
                          ),
                          h(
                            'tbody',
                            null,
                            workouts.recent.map((w, idx) =>
                              h(
                                'tr',
                                { key: idx },
                                h('td', null, w.date),
                                h('td', null, w.activity),
                                h('td', null, formatNum(w.minutes, 1)),
                                h('td', null, formatNum(w.energy_kcal, 1)),
                                h('td', null, w.distance == null ? '—' : `${formatNum(w.distance, 2)} ${w.distance_unit || ''}`),
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
                    h('summary', { style: { cursor: 'pointer', fontSize: '13px', fontWeight: 500 } }, '查看数据覆盖范围与统计口径说明'),
                    Array.isArray(health.coverage) && h(
                      'p',
                      { className: 'dsh-3b-metric-note', style: { marginTop: '8px' } },
                      `历史覆盖范围：${health.coverage[0]} 至 ${health.coverage[1]} · SQL 主库去重记录 ${formatNum(health.coverage[2], 0)} 条 · 最近导入时间：${health.imported_at || '—'} · 快照生成时间：${health.generated_at || '—'}`,
                    ),
                    Array.isArray(health.methods) && h(
                      'ul',
                      { style: { margin: '6px 0 0', paddingLeft: '18px', fontSize: '12px', color: 'var(--dsw-alias-text-tertiary, #8b92a5)', lineHeight: 1.6 } },
                      health.methods.map((m, i) => h('li', { key: i }, m)),
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
