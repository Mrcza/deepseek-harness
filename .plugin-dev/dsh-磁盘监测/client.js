/**
 * Browser client module of @local/dsh-disk-monitor.
 * Registers:
 *   - Left sidebar entry (`sidebar.panellist`, id: 'disk-monitor', label: '磁盘监测')
 *   - Right main view (`main`, key: 'disk-monitor')
 * Aesthetic: Guizang (归藏) editorial magazine style on warm paper tokens.
 */
window.__ModuleLoader__.load({
  id: '@local/dsh-disk-monitor',
  factory(require) {
    const React = require('react')
    const { useState, useEffect, useCallback, useMemo } = React
    const h = React.createElement

    const STYLE_ID = 'dsh-disk-monitor-styles'

    function injectStyles() {
      if (typeof document === 'undefined') return
      const css = `
        /* 磁盘监测 · 归藏（Guizang）杂志风 */
        .dsh-dm-root {
          --dm-paper: #f1efea;
          --dm-paper-2: #f7f5f1;
          --dm-ink: #0a0a0b;
          --dm-ink-2: #3f3d39;
          --dm-ink-3: #6b675f;
          --dm-ink-4: #8a857c;
          --dm-rule: rgba(10, 10, 11, 0.16);
          --dm-rule-strong: rgba(10, 10, 11, 0.58);
          --dm-texture: rgba(10, 10, 11, 0.026);
          --dm-read: #2b6cb0;
          --dm-write: #c05621;
          --dm-success: #2e6b4f;
          --dm-warn: #9b5a2e;
          --dm-error: #a33a2f;
          --dm-serif: 'Noto Serif SC', 'Source Han Serif SC', 'Songti SC', 'STSong', Georgia, 'Times New Roman', serif;
          --dm-sans: var(--dsw-font-family);
          --dm-mono: var(--ds-font-family-code);
          box-sizing: border-box;
          height: 100%;
          width: 100%;
          overflow-x: hidden;
          overflow-y: auto;
          padding: calc(28px + var(--dsh-frame-top-clearance, 0px)) clamp(20px, 4vw, 48px) 56px;
          background: var(--dm-paper);
          color: var(--dm-ink);
          font-family: var(--dm-sans);
          font-size: 13px;
          line-height: 20px;
          scrollbar-color: var(--dm-ink-4) transparent;
        }
        body[data-ds-dark-theme] .dsh-dm-root {
          --dm-paper: #0e0d0c;
          --dm-paper-2: #171512;
          --dm-ink: #ece2cf;
          --dm-ink-2: #c8bda9;
          --dm-ink-3: #948b7c;
          --dm-ink-4: #8a8172;
          --dm-rule: rgba(236, 226, 207, 0.16);
          --dm-rule-strong: rgba(236, 226, 207, 0.55);
          --dm-texture: rgba(236, 226, 207, 0.04);
          --dm-read: #56b7e6;
          --dm-write: #e08a5a;
          --dm-success: #7fbf9a;
          --dm-warn: #d9a76a;
          --dm-error: #e08a7d;
        }

        .dsh-dm-container {
          max-width: 1120px;
          margin: 0 auto;
          display: flex;
          flex-direction: column;
          gap: 24px;
        }

        /* 杂志风页头 */
        .dsh-dm-topbar {
          display: flex;
          flex-wrap: wrap;
          align-items: flex-end;
          justify-content: space-between;
          gap: 16px 24px;
          padding-bottom: 18px;
          border-bottom: 2px solid var(--dm-ink);
        }
        .dsh-dm-brand {
          display: flex;
          flex-direction: column;
          gap: 6px;
          min-width: 0;
        }
        .dsh-dm-eyebrow {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 10px;
          font-family: var(--dm-mono);
          font-size: 10.5px;
          line-height: 14px;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--dm-ink-3);
        }
        .dsh-dm-title-row {
          display: flex;
          flex-wrap: wrap;
          align-items: baseline;
          gap: 12px;
        }
        .dsh-dm-title {
          margin: 0;
          font-family: var(--dm-serif);
          font-size: 28px;
          line-height: 36px;
          font-weight: 500;
          letter-spacing: 0.03em;
        }
        .dsh-dm-subtitle {
          margin: 0;
          font-size: 12px;
          line-height: 18px;
          color: var(--dm-ink-3);
        }
        .dsh-dm-actions {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 8px;
        }

        .dsh-dm-btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          height: 30px;
          padding: 0 12px;
          box-sizing: border-box;
          border: 1px solid var(--dm-rule-strong);
          border-radius: 2px;
          background: transparent;
          color: var(--dm-ink);
          font-family: inherit;
          font-size: 12px;
          line-height: 18px;
          font-weight: 500;
          cursor: pointer;
          transition: background-color 120ms ease;
        }
        .dsh-dm-btn.primary {
          background: var(--dm-ink);
          border-color: var(--dm-ink);
          color: var(--dm-paper);
        }
        .dsh-dm-btn:disabled {
          opacity: 0.45;
          cursor: not-allowed;
        }
        @media (hover: hover) {
          .dsh-dm-btn:hover:not(:disabled) {
            background: color-mix(in srgb, var(--dm-ink) 7%, transparent);
          }
          .dsh-dm-btn.primary:hover:not(:disabled) {
            background: color-mix(in srgb, var(--dm-ink) 84%, var(--dm-paper));
          }
        }

        .dsh-dm-seg {
          display: inline-flex;
          padding: 2px;
          border: 1px solid var(--dm-rule-strong);
          border-radius: 2px;
          background: transparent;
        }
        .dsh-dm-seg button {
          height: 24px;
          padding: 0 10px;
          border: none;
          background: transparent;
          color: var(--dm-ink-3);
          font-family: var(--dm-mono);
          font-size: 11.5px;
          cursor: pointer;
        }
        .dsh-dm-seg button[aria-pressed='true'] {
          background: var(--dm-ink);
          color: var(--dm-paper);
          font-weight: 500;
        }

        /* 顶部磁盘多项选择栏 */
        .dsh-dm-selector-panel {
          display: flex;
          flex-direction: column;
          gap: 12px;
          padding: 16px 20px;
          border: 1px solid var(--dm-rule);
          border-radius: 3px;
          background: var(--dm-paper-2);
        }
        .dsh-dm-selector-head {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          justify-content: space-between;
          gap: 8px 16px;
        }
        .dsh-dm-selector-title {
          display: flex;
          align-items: baseline;
          gap: 8px;
          font-family: var(--dm-serif);
          font-size: 15px;
          line-height: 22px;
          font-weight: 500;
        }
        .dsh-dm-selector-meta {
          font-family: var(--dm-mono);
          font-size: 11px;
          color: var(--dm-ink-3);
        }
        .dsh-dm-checkbox-list {
          display: flex;
          flex-wrap: wrap;
          gap: 10px;
        }
        .dsh-dm-check-pill {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 7px 12px;
          border: 1px solid var(--dm-rule);
          border-radius: 2px;
          background: var(--dm-paper);
          color: var(--dm-ink-2);
          font-size: 12.5px;
          line-height: 18px;
          cursor: pointer;
          user-select: none;
          transition: border-color 120ms ease, background-color 120ms ease;
        }
        .dsh-dm-check-pill.checked {
          border-color: var(--dm-ink);
          background: color-mix(in srgb, var(--dm-ink) 6%, var(--dm-paper));
          color: var(--dm-ink);
          font-weight: 500;
        }
        .dsh-dm-check-pill input[type='checkbox'] {
          width: 14px;
          height: 14px;
          margin: 0;
          accent-color: var(--dm-ink);
          cursor: pointer;
        }
        .dsh-dm-pill-tag {
          font-family: var(--dm-mono);
          font-size: 10.5px;
          padding: 1px 5px;
          border: 1px solid var(--dm-rule);
          border-radius: 2px;
          color: var(--dm-ink-3);
        }

        /* 提示条 */
        .dsh-dm-notice {
          padding: 10px 14px;
          border: 1px solid var(--dm-rule);
          border-left: 2px solid var(--dm-warn);
          border-radius: 2px;
          font-size: 12px;
          color: var(--dm-ink);
        }
        .dsh-dm-notice.error {
          border-left-color: var(--dm-error);
        }

        /* 磁盘卡片纵向列表（每盘独立一张杂志风卡片） */
        .dsh-dm-cards-stack {
          display: flex;
          flex-direction: column;
          gap: 24px;
        }
        .dsh-dm-card {
          display: flex;
          flex-direction: column;
          gap: 16px;
          padding: 22px 24px;
          border: 1px solid var(--dm-rule);
          border-radius: 3px;
          background: var(--dm-paper-2);
        }
        .dsh-dm-card-head {
          display: flex;
          flex-wrap: wrap;
          align-items: flex-start;
          justify-content: space-between;
          gap: 12px 20px;
          padding-bottom: 14px;
          border-bottom: 1px solid var(--dm-rule);
        }
        .dsh-dm-card-title-group {
          display: flex;
          flex-direction: column;
          gap: 4px;
          min-width: 0;
        }
        .dsh-dm-card-title-line {
          display: flex;
          flex-wrap: wrap;
          align-items: baseline;
          gap: 10px;
        }
        .dsh-dm-index {
          font-family: var(--dm-mono);
          font-size: 11px;
          color: var(--dm-ink-4);
          font-variant-numeric: tabular-nums;
        }
        .dsh-dm-vol-name {
          margin: 0;
          font-family: var(--dm-serif);
          font-size: 22px;
          line-height: 28px;
          font-weight: 500;
          letter-spacing: 0.01em;
        }
        .dsh-dm-card-sub {
          font-family: var(--dm-mono);
          font-size: 11px;
          line-height: 16px;
          color: var(--dm-ink-3);
        }
        .dsh-dm-status-badge {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          height: 22px;
          padding: 0 8px;
          border: 1px solid var(--dm-rule);
          border-radius: 2px;
          font-family: var(--dm-mono);
          font-size: 11px;
          color: var(--dm-ink-2);
        }
        .dsh-dm-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: var(--dm-success);
        }

        /* 4 格 KPI 指标带 */
        .dsh-dm-kpi-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 12px;
        }
        @media (min-width: 720px) {
          .dsh-dm-kpi-grid {
            grid-template-columns: repeat(4, minmax(0, 1fr));
          }
        }
        .dsh-dm-kpi-box {
          display: flex;
          flex-direction: column;
          gap: 4px;
          padding: 10px 12px;
          border: 1px solid var(--dm-rule);
          border-radius: 2px;
          background: var(--dm-paper);
        }
        .dsh-dm-kpi-label {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 11px;
          line-height: 16px;
          color: var(--dm-ink-3);
        }
        .dsh-dm-swatch {
          display: inline-block;
          width: 8px;
          height: 8px;
          border-radius: 1px;
        }
        .dsh-dm-swatch.read {
          background: var(--dm-read);
        }
        .dsh-dm-swatch.write {
          background: var(--dm-write);
        }
        .dsh-dm-kpi-val {
          font-family: var(--dm-serif);
          font-size: 20px;
          line-height: 26px;
          font-weight: 400;
          font-variant-numeric: tabular-nums;
          color: var(--dm-ink);
        }

        /* 双柱柱状图 */
        .dsh-dm-chart-header {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          justify-content: space-between;
          gap: 8px 16px;
          font-family: var(--dm-mono);
          font-size: 11px;
          color: var(--dm-ink-3);
        }
        .dsh-dm-legend {
          display: flex;
          align-items: center;
          gap: 14px;
        }
        .dsh-dm-legend-item {
          display: inline-flex;
          align-items: center;
          gap: 5px;
        }
        .dsh-dm-hover-readout {
          color: var(--dm-ink);
          font-variant-numeric: tabular-nums;
        }

        .dsh-dm-plot-wrap {
          display: grid;
          grid-template-columns: 54px minmax(0, 1fr);
          gap: 8px;
          align-items: stretch;
          height: 190px;
        }
        .dsh-dm-yaxis {
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          padding: 2px 0;
          font-family: var(--dm-mono);
          font-size: 10.5px;
          line-height: 14px;
          font-variant-numeric: tabular-nums;
          color: var(--dm-ink-4);
          text-align: right;
        }
        .dsh-dm-bars-area {
          position: relative;
          display: grid;
          align-items: end;
          height: 100%;
          box-sizing: border-box;
          padding: 8px 8px 0;
          border: 1px solid var(--dm-rule);
          border-radius: 2px;
          background-color: var(--dm-paper);
          background-image:
            repeating-linear-gradient(45deg, transparent 0 10px, var(--dm-texture) 10px 10.5px),
            repeating-linear-gradient(-45deg, transparent 0 10px, var(--dm-texture) 10px 10.5px);
        }
        .dsh-dm-gridline {
          position: absolute;
          left: 8px;
          right: 8px;
          height: 0;
          border-top: 1px solid var(--dm-rule);
          pointer-events: none;
          z-index: 0;
        }
        .dsh-dm-gridline-1 {
          top: 33.333%;
        }
        .dsh-dm-gridline-2 {
          top: 66.666%;
        }
        .dsh-dm-day-group {
          position: relative;
          z-index: 1;
          height: 100%;
          display: flex;
          align-items: flex-end;
          justify-content: center;
          gap: 1px;
          padding: 0 1px;
          cursor: crosshair;
        }
        @media (hover: hover) {
          .dsh-dm-day-group:hover {
            background: color-mix(in srgb, var(--dm-ink) 5%, transparent);
          }
        }
        .dsh-dm-bar-read,
        .dsh-dm-bar-write {
          flex: 1 1 0;
          min-width: 1px;
          max-width: 8px;
          transition: opacity 100ms ease;
        }
        .dsh-dm-bar-read {
          background: var(--dm-read);
        }
        .dsh-dm-bar-write {
          background: var(--dm-write);
        }
        .dsh-dm-bar-zero {
          height: 1px !important;
          opacity: 0.25;
        }
        .dsh-dm-xaxis {
          display: flex;
          justify-content: space-between;
          padding-left: 62px;
          font-family: var(--dm-mono);
          font-size: 10.5px;
          line-height: 14px;
          font-variant-numeric: tabular-nums;
          color: var(--dm-ink-4);
        }

        .dsh-dm-empty {
          padding: 48px 24px;
          text-align: center;
          border: 1px dashed var(--dm-rule-strong);
          border-radius: 3px;
          background: var(--dm-paper-2);
          color: var(--dm-ink-3);
          font-size: 13px;
        }

        .dsh-dm-footer {
          padding-top: 12px;
          border-top: 1px solid var(--dm-rule);
          font-family: var(--dm-mono);
          font-size: 11px;
          line-height: 18px;
          color: var(--dm-ink-4);
          display: flex;
          flex-wrap: wrap;
          justify-content: space-between;
          gap: 8px 16px;
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

    function formatBytes(bytes) {
      const val = Number(bytes || 0)
      if (!Number.isFinite(val) || val <= 0) return '0 B'
      const units = ['B', 'KB', 'MB', 'GB', 'TB']
      let idx = 0
      let num = val
      while (num >= 1024 && idx < units.length - 1) {
        num /= 1024
        idx++
      }
      const digits = idx === 0 ? 0 : num >= 100 ? 0 : num >= 10 ? 1 : 2
      return `${num.toFixed(digits)} ${units[idx]}`
    }

    function formatTimeLabel(iso) {
      if (!iso) return '—'
      return String(iso).replace('T', ' ').slice(0, 19)
    }

    async function apiFetch(path, options = {}) {
      const headers = { ...(options.headers || {}) }
      if (options.body !== undefined && !headers['Content-Type']) {
        headers['Content-Type'] = 'application/json'
      }
      const res = await fetch(path, { ...options, headers })
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
        throw new Error(data.error || `请求失败 (${res.status})`)
      }
      return data
    }

    function DiskSidebarIcon({ size = 18 }) {
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
        h('rect', { x: 3, y: 4, width: 18, height: 16, rx: 2.5 }),
        h('line', { x1: 3, y1: 14, x2: 21, y2: 14 }),
        h('circle', { cx: 7.5, cy: 17, r: 0.8, fill: 'currentColor', stroke: 'none' }),
        h('line', { x1: 12, y1: 17, x2: 17, y2: 17 }),
        h('path', { d: 'M7.5 10V8.5M12 10V7M16.5 10V9' }),
      )
    }

    function DiskDualBarCard({ disk, index, days }) {
      const [hoveredDay, setHoveredDay] = useState(null)
      const series = Array.isArray(disk.series) ? disk.series : []
      const isYearView = days > 90

      const maxVal = useMemo(() => {
        let m = 0
        for (const item of series) {
          if (item.readBytes > m) m = item.readBytes
          if (item.writeBytes > m) m = item.writeBytes
        }
        return m > 0 ? m : 1024 * 1024
      }, [series])

      const capacityText = disk.totalBytes > 0
        ? (disk.usedBytes > 0
          ? `容量 ${formatBytes(disk.usedBytes)} / ${formatBytes(disk.totalBytes)}`
          : `总容量 ${formatBytes(disk.totalBytes)}`)
        : '容量未知'
      const mountText = disk.mountPoint ? `挂载 ${disk.mountPoint}` : '未挂载休眠'
      const mediaText = disk.mediaName ? ` · ${disk.mediaName}` : ''

      const firstDate = series[0]?.date || ''
      const midDate = series[Math.floor(series.length / 2)]?.date || ''
      const lastDate = series[series.length - 1]?.date || ''

      return h(
        'article',
        { className: 'dsh-dm-card' },
        h(
          'div',
          { className: 'dsh-dm-card-head' },
          h(
            'div',
            { className: 'dsh-dm-card-title-group' },
            h(
              'div',
              { className: 'dsh-dm-card-title-line' },
              h('span', { className: 'dsh-dm-index' }, String(index + 1).padStart(2, '0')),
              h('h2', { className: 'dsh-dm-vol-name' }, disk.volumeName),
            ),
            h(
              'div',
              { className: 'dsh-dm-card-sub' },
              `${disk.kind === 'internal' ? '物理内置' : '物理外接'} · ${disk.diskId}${mediaText} · ${capacityText} · ${mountText} · 开机累计读 ${formatBytes(disk.rawReadBytes)} / 写 ${formatBytes(disk.rawWriteBytes)}`,
            ),
          ),
          h(
            'span',
            { className: 'dsh-dm-status-badge' },
            h('span', { className: 'dsh-dm-dot', 'aria-hidden': 'true' }),
            disk.mountPoint ? '已连接 · 已挂载' : '已连接 · 未挂载',
          ),
        ),

        h(
          'div',
          { className: 'dsh-dm-kpi-grid' },
          h(
            'div',
            { className: 'dsh-dm-kpi-box' },
            h('span', { className: 'dsh-dm-kpi-label' }, h('span', { className: 'dsh-dm-swatch read' }), '今日读取'),
            h('strong', { className: 'dsh-dm-kpi-val' }, formatBytes(disk.todayReadBytes)),
          ),
          h(
            'div',
            { className: 'dsh-dm-kpi-box' },
            h('span', { className: 'dsh-dm-kpi-label' }, h('span', { className: 'dsh-dm-swatch write' }), '今日写入'),
            h('strong', { className: 'dsh-dm-kpi-val' }, formatBytes(disk.todayWriteBytes)),
          ),
          h(
            'div',
            { className: 'dsh-dm-kpi-box' },
            h('span', { className: 'dsh-dm-kpi-label' }, h('span', { className: 'dsh-dm-swatch read' }), `近${days}天累计读取`),
            h('strong', { className: 'dsh-dm-kpi-val' }, formatBytes(disk.totalReadPeriod)),
          ),
          h(
            'div',
            { className: 'dsh-dm-kpi-box' },
            h('span', { className: 'dsh-dm-kpi-label' }, h('span', { className: 'dsh-dm-swatch write' }), `近${days}天累计写入`),
            h('strong', { className: 'dsh-dm-kpi-val' }, formatBytes(disk.totalWritePeriod)),
          ),
        ),

        h(
          'div',
          { className: 'dsh-dm-chart-header' },
          h(
            'div',
            { className: 'dsh-dm-legend' },
            h('span', { className: 'dsh-dm-legend-item' }, h('span', { className: 'dsh-dm-swatch read' }), '读取 (Read)'),
            h('span', { className: 'dsh-dm-legend-item' }, h('span', { className: 'dsh-dm-swatch write' }), '写入 (Write)'),
          ),
          h(
            'span',
            { className: 'dsh-dm-hover-readout' },
            hoveredDay
              ? `${hoveredDay.date} · 读 ${formatBytes(hoveredDay.readBytes)} / 写 ${formatBytes(hoveredDay.writeBytes)}`
              : `近 ${days} 个自然日（00:00–24:00）双柱流量图 · 悬停查看单日明细`,
          ),
        ),

        h(
          'div',
          { className: 'dsh-dm-plot-wrap' },
          h(
            'div',
            { className: 'dsh-dm-yaxis' },
            h('span', null, formatBytes(maxVal)),
            h('span', null, formatBytes(maxVal / 2)),
            h('span', null, '0'),
          ),
          h(
            'div',
            {
              className: 'dsh-dm-bars-area',
              style: {
                gridTemplateColumns: `repeat(${Math.max(1, series.length)}, minmax(0, 1fr))`,
                columnGap: isYearView ? '0px' : '4px',
              },
              onMouseLeave: () => setHoveredDay(null),
            },
            h('div', { className: 'dsh-dm-gridline dsh-dm-gridline-1', 'aria-hidden': 'true' }),
            h('div', { className: 'dsh-dm-gridline dsh-dm-gridline-2', 'aria-hidden': 'true' }),
            series.map((dayItem) => {
              const readPct = dayItem.readBytes > 0 ? Math.max(2, (dayItem.readBytes / maxVal) * 100) : 0
              const writePct = dayItem.writeBytes > 0 ? Math.max(2, (dayItem.writeBytes / maxVal) * 100) : 0
              return h(
                'div',
                {
                  key: dayItem.date,
                  className: 'dsh-dm-day-group',
                  style: isYearView ? { padding: 0, gap: 0 } : undefined,
                  title: `${dayItem.date}\n读取：${formatBytes(dayItem.readBytes)}\n写入：${formatBytes(dayItem.writeBytes)}`,
                  onMouseEnter: () => setHoveredDay(dayItem),
                },
                h('div', {
                  className: 'dsh-dm-bar-read' + (dayItem.readBytes === 0 ? ' dsh-dm-bar-zero' : ''),
                  style: { height: `${Math.min(100, readPct)}%`, minWidth: isYearView ? '1px' : '2px' },
                }),
                h('div', {
                  className: 'dsh-dm-bar-write' + (dayItem.writeBytes === 0 ? ' dsh-dm-bar-zero' : ''),
                  style: { height: `${Math.min(100, writePct)}%`, minWidth: isYearView ? '1px' : '2px' },
                }),
              )
            }),
          ),
        ),
        h(
          'div',
          { className: 'dsh-dm-xaxis' },
          h('span', null, firstDate),
          h('span', null, midDate),
          h('span', null, lastDate),
        ),
      )
    }

    function DiskMonitorPanel() {
      const [state, setState] = useState(null)
      const [loading, setLoading] = useState(true)
      const [sampling, setSampling] = useState(false)
      const [err, setErr] = useState('')

      useEffect(() => {
        injectStyles()
      }, [])

      const loadState = useCallback(async (signal) => {
        try {
          const data = await apiFetch('/api/disk-monitor/state', { signal })
          setState(data)
          setErr('')
        } catch (e) {
          if (e?.name === 'AbortError') return
          setErr(e?.message || '读取磁盘监测状态失败')
        } finally {
          setLoading(false)
        }
      }, [])

      useEffect(() => {
        const controller = new AbortController()
        loadState(controller.signal)

        const pollTimer = setInterval(() => {
          if (typeof document === 'undefined' || !document.hidden) {
            loadState(controller.signal)
          }
        }, 60000)

        let sevenAmTimer = null
        const scheduleClient7am = () => {
          const now = new Date()
          const target = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 7, 0, 5, 0)
          if (target.getTime() <= now.getTime()) {
            target.setDate(target.getDate() + 1)
          }
          const delay = Math.max(2000, target.getTime() - now.getTime())
          sevenAmTimer = setTimeout(() => {
            loadState(controller.signal)
            scheduleClient7am()
          }, delay)
        }
        scheduleClient7am()

        return () => {
          controller.abort()
          clearInterval(pollTimer)
          if (sevenAmTimer) clearTimeout(sevenAmTimer)
        }
      }, [loadState])

      const handleManualSample = async () => {
        setSampling(true)
        setErr('')
        try {
          const data = await apiFetch('/api/disk-monitor/sample', { method: 'POST', body: '{}' })
          setState(data)
        } catch (e) {
          setErr(e?.message || '采样失败')
        } finally {
          setSampling(false)
        }
      }

      const saveSelectedIds = async (nextIds) => {
        setState(prev => (prev ? { ...prev, selectedIds: nextIds } : prev))
        try {
          const updated = await apiFetch('/api/disk-monitor/preferences', {
            method: 'POST',
            body: JSON.stringify({ selectedIds: nextIds }),
          })
          setState(updated)
        } catch (e) {
          setErr(e?.message || '保存磁盘筛选偏好失败')
        }
      }

      const saveDays = async (nextDays) => {
        setState(prev => (prev ? { ...prev, days: nextDays } : prev))
        try {
          const updated = await apiFetch('/api/disk-monitor/preferences', {
            method: 'POST',
            body: JSON.stringify({ days: nextDays }),
          })
          setState(updated)
        } catch (e) {
          setErr(e?.message || '切换统计天数失败')
        }
      }

      const days = state?.days || 30
      const disks = state?.disks || []
      const selectedSet = useMemo(() => new Set(state?.selectedIds || []), [state?.selectedIds])

      const toggleDisk = (diskId) => {
        const next = new Set(selectedSet)
        if (next.has(diskId)) next.delete(diskId)
        else next.add(diskId)
        saveSelectedIds(Array.from(next))
      }

      const selectAll = () => {
        saveSelectedIds(disks.map(d => d.id))
      }

      const clearAll = () => {
        saveSelectedIds([])
      }

      const visibleDisks = useMemo(
        () => disks.filter(d => selectedSet.has(d.id)),
        [disks, selectedSet],
      )

      return h(
        'div',
        { className: 'dsh-dm-root' },
        h(
          'div',
          { className: 'dsh-dm-container' },
          h(
            'header',
            { className: 'dsh-dm-topbar' },
            h(
              'div',
              { className: 'dsh-dm-brand' },
              h(
                'div',
                { className: 'dsh-dm-eyebrow' },
                h('span', null, `DISK I/O JOURNAL · ${days}D`),
                h('span', null, '自然日 00:00–24:00 累加'),
                h('span', null, '每日 07:00 自动更新'),
              ),
              h(
                'div',
                { className: 'dsh-dm-title-row' },
                h('h1', { className: 'dsh-dm-title' }, '磁盘监测'),
              ),
              h(
                'p',
                { className: 'dsh-dm-subtitle' },
                `统计主机物理内置与外接磁盘读写流量 · 最近采样：${formatTimeLabel(state?.lastSampleAt)} · 下次定时刷新：${formatTimeLabel(state?.nextScheduled7amAt)}`,
              ),
            ),
            h(
              'div',
              { className: 'dsh-dm-actions' },
              h(
                'div',
                { className: 'dsh-dm-seg', role: 'group', 'aria-label': '展示时间范围' },
                [30, 365].map(d => h(
                  'button',
                  {
                    key: d,
                    type: 'button',
                    'aria-pressed': days === d,
                    onClick: () => saveDays(d),
                  },
                  `近 ${d} 天`,
                )),
              ),
              h(
                'button',
                {
                  type: 'button',
                  className: 'dsh-dm-btn primary',
                  disabled: sampling || loading,
                  onClick: handleManualSample,
                },
                sampling ? '正在采样…' : '立即采样',
              ),
            ),
          ),

          err && h('div', { className: 'dsh-dm-notice error' }, err),

          /* 顶部多项选择框 */
          h(
            'section',
            { className: 'dsh-dm-selector-panel', 'aria-label': '选择要展示的磁盘' },
            h(
              'div',
              { className: 'dsh-dm-selector-head' },
              h(
                'div',
                { className: 'dsh-dm-selector-title' },
                h('span', null, '展示磁盘筛选'),
                h('span', { className: 'dsh-dm-selector-meta' }, `当前已连接 ${disks.length} 块 · 已选 ${visibleDisks.length}`),
              ),
              h(
                'div',
                { className: 'dsh-dm-actions' },
                h('button', { type: 'button', className: 'dsh-dm-btn', onClick: selectAll, disabled: disks.length === 0 }, '全选'),
                h('button', { type: 'button', className: 'dsh-dm-btn', onClick: clearAll, disabled: disks.length === 0 }, '清空'),
              ),
            ),
            disks.length === 0
              ? h('p', { className: 'dsh-dm-subtitle' }, loading ? '正在扫描主机物理磁盘…' : '未检测到符合条件的物理磁盘。')
              : h(
                'div',
                { className: 'dsh-dm-checkbox-list' },
                disks.map(disk => {
                  const checked = selectedSet.has(disk.id)
                  return h(
                    'label',
                    {
                      key: disk.id,
                      className: 'dsh-dm-check-pill' + (checked ? ' checked' : ''),
                    },
                    h('input', {
                      type: 'checkbox',
                      checked,
                      onChange: () => toggleDisk(disk.id),
                    }),
                    h('span', null, disk.volumeName),
                    h('span', { className: 'dsh-dm-pill-tag' }, `${disk.kind === 'internal' ? '内置' : '外接'} · ${disk.diskId}`),
                  )
                }),
              ),
          ),

          /* 磁盘双柱卡片（上下排列） */
          loading && !state
            ? h('div', { className: 'dsh-dm-empty' }, '正在读取磁盘读写记录…')
            : visibleDisks.length === 0
              ? h('div', { className: 'dsh-dm-empty' }, '请在上方勾选至少一个磁盘以查看读写柱状图。')
              : h(
                'section',
                { className: 'dsh-dm-cards-stack', 'aria-label': `磁盘近${days}天读写趋势` },
                visibleDisks.map((disk, idx) => h(DiskDualBarCard, { key: disk.id, disk, index: idx, days })),
              ),

          h(
            'footer',
            { className: 'dsh-dm-footer' },
            h('span', null, '采集方式：macOS ioreg/diskutil 瞬时抄表（历史数据永久保留，关闭插件即退出全部监测任务）'),
            h('span', null, `上次 07:00 更新：${formatTimeLabel(state?.lastScheduled7amAt)}`),
          ),
        ),
      )
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('sidebar.panellist', () =>
          ctx.slots.register(
            {
              name: 'sidebar.panellist',
              id: 'disk-monitor',
              order: 35,
              label: () => '磁盘监测',
            },
            DiskSidebarIcon,
          ),
        )

        ctx.slots.inject('main', () =>
          ctx.slots.register(
            {
              name: 'main',
              key: 'disk-monitor',
            },
            DiskMonitorPanel,
          ),
        )
      },
    }
  },
})
