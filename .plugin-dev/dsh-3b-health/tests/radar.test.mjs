/**
 * 六维雷达与连续评分回归测试：直接跑 focus-model.mjs 提取出来的引擎。
 * 真实快照下指标全部 fresh，carried 与 missing 两条路径只能靠合成快照覆盖。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadFocusModel } from '../scripts/lib/focus-model.mjs'

const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const real = await loadFocusModel(pluginRoot)
const health = real.health
const profile = real.model.profile

/** 改写快照里的指定指标，用于制造 fresh / carried / missing 三态。 */
function withMetrics(base, rewrite) {
  const clone = JSON.parse(JSON.stringify(base))
  clone.trend.metrics = clone.trend.metrics.map((metric) => ({ ...metric, values: rewrite({ id: metric.id, values: metric.values }) }))
  return clone
}

test('radar exposes six axes in the fixed order', () => {
  const { radar } = real.model
  assert.equal(radar.axes.length, 6)
  assert.deepEqual(radar.axes.map((axis) => axis.domain), [1, 2, 3, 4, 5, 6])
  assert.deepEqual(radar.axes.map((axis) => axis.label), ['体脂体态', '肌肉储备', '心肺适能', '日常活动', '睡眠恢复', '步态平衡'])
})

test('every axis label is four characters so the hexagon reads evenly', () => {
  for (const axis of real.model.radar.axes) assert.equal(axis.label.length, 4, axis.label)
})

test('tier boundaries sit on the five ring radii', () => {
  const tierOf = (score) => (score >= 80 ? '优秀' : score >= 60 ? '良好' : score >= 40 ? '一般' : score >= 20 ? '待改善' : '需改善')
  for (const [score, expected] of [[100, '优秀'], [80, '优秀'], [79, '良好'], [60, '良好'], [59, '一般'], [40, '一般'], [39, '待改善'], [20, '待改善'], [19, '需改善'], [0, '需改善']]) {
    assert.equal(tierOf(score), expected, 'score ' + score)
  }
})

test('no axis reaches a perfect score on ordinary healthy data', () => {
  /* 旧口径把「正常」压进 93–100，导致满分；新曲线下区间正中只有 78 分。 */
  for (const axis of real.model.radar.axes) {
    if (axis.score === null) continue
    assert.ok(axis.score < 100, axis.label + ' should not be a perfect score: ' + axis.score)
  }
})

test('composite score is a weighted mean of every scored metric', () => {
  const { model } = real
  assert.ok(model.score !== null)
  /* 综合分用全部已评分指标，不只是「重点关注」显示的那几张卡。 */
  const shown = model.cards.reduce((sum, card) => sum + card.weight, 0)
  const all = model.radar.axes.reduce((sum, axis) => sum + (axis.members ? axis.members.length : 0), 0)
  assert.ok(all > model.cards.length, 'radar covers more metrics than the shown cards')
  assert.ok(model.score >= 0 && model.score <= 100)
  assert.ok(shown > 0)
  assert.equal(model.scoreTierIndex, [80, 60, 40, 20, 0].findIndex((min) => model.score >= min))
})

test('a domain whose indicators all carry forward is marked carried', async () => {
  const synthetic = withMetrics(health, ({ id, values }) => {
    if (id !== 'sleep' && id !== 'hrv') return values
    const out = values.slice()
    for (let index = out.length - 8; index < out.length; index += 1) out[index] = null
    return out
  })
  const engine = await loadFocusModel(pluginRoot, { healthOverride: synthetic, profile })
  const axis = engine.model.radar.axes.find((item) => item.domain === 5)
  assert.equal(axis.state, 'carried')
  assert.ok(axis.carriedDate)
  assert.ok(axis.score !== null)
})

test('a domain with no records is missing and excluded from the average', async () => {
  const synthetic = withMetrics(health, ({ id, values }) => (id === 'sleep' || id === 'hrv' ? values.map(() => null) : values))
  const engine = await loadFocusModel(pluginRoot, { healthOverride: synthetic, profile })
  const axis = engine.model.radar.axes.find((item) => item.domain === 5)
  assert.equal(axis.state, 'missing')
  assert.equal(axis.score, null)
  assert.equal(engine.model.radar.usableCount, 5)
  assert.match(engine.model.radar.staleNote, /睡眠恢复/)
})

test('percentile scale metrics produce different scores across the range', async () => {
  /* VO2max 用 FRIEND 百分位：旧的单边公式下高低值同分，新曲线必须拉开。 */
  const low = withMetrics(health, ({ id, values }) => (id === 'vo2max' ? values.map(() => 24) : values))
  const high = withMetrics(health, ({ id, values }) => (id === 'vo2max' ? values.map(() => 55) : values))
  const lowModel = await loadFocusModel(pluginRoot, { healthOverride: low, profile })
  const highModel = await loadFocusModel(pluginRoot, { healthOverride: high, profile })
  const lowAxis = lowModel.model.radar.axes.find((axis) => axis.domain === 3)
  const highAxis = highModel.model.radar.axes.find((axis) => axis.domain === 3)
  assert.ok(lowAxis && highAxis, 'cardio axis exists in both models')
  assert.ok(highAxis.score - lowAxis.score > 10, 'spread should be visible: ' + lowAxis.score + ' -> ' + highAxis.score)
})

test('an axis never reports a shortfall whose indicator is already standard', () => {
  for (const axis of real.model.radar.axes) {
    if (!axis.shortfall) continue
    assert.notEqual(axis.shortfall.status, '标准', axis.label)
  }
})
