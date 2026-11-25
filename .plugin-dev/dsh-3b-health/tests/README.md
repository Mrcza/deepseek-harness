# 3B健康测试

## 运行

```sh
node --test tests/
```

测试直接用 `node:test`（Node 26 自带，无第三方依赖），通过 `scripts/lib/focus-model.mjs` 加载 `client.js` 的 `focus-engine` 区域，与页面和两份日报跑同一份代码。

## 为什么需要合成数据

真实快照下 14 项指标全部处于 `fresh` 态，`carried`（近 7 日无值、30 日窗口内有实测）与 `missing`（整窗无记录）两条路径跑不到。测试通过 `loadFocusModel(pluginRoot, { healthOverride })` 注入改写后的快照来覆盖它们，不读写 `runtime/` 下的任何文件。

## 覆盖范围

- 雷达固定输出 5 条轴，顺序与生理域 1–5 一致
- 档位边界 80/60/40/20 与 5 圈刻度对齐
- 综合评分使用全量 0–100，不再是被压缩的旧口径
- 全部指标沿用时该轴标 `carried` 并记录沿用日期
- 整窗无记录时该轴 `missing`、不计入平均、写进 `staleNote`
- 域内指标全部达标时不编造短板
