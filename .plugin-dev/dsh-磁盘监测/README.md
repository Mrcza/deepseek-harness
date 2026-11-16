# 磁盘监测 (`@local/dsh-disk-monitor`)

DeepSeek Harness 轻量级物理磁盘读写监测插件，采用**归藏（Guizang）杂志风**排版设计。

## 核心特性

1. **轻量“抄电表”采集，关闭零残留**：
   - 不运行常驻 `iostat` 进程；仅在采样节点通过 macOS 原生 `ioreg` 与 `diskutil` 瞬时读取内核累计读写字节数并计算自然日增量，用完即退出。
   - 在插件 `dispose` 生命周期中清理所有定时器（采样定时器 + 每日 07:00 定时器）并立即终止所有在途子进程，确保关闭或卸载插件时退出一切监测进程。
2. **仅保留真实物理内置与外接磁盘（以卷名称为主标签）**：
   - 自动过滤虚拟磁盘镜像（Disk Image）与系统恢复/引导辅助分区，精确将 APFS 容器卷（如 `Macintosh HD`）与外接磁盘卷（如 `DataDisk`、`BackupDisk`）映射至对应的物理磁盘驱动器统计。
3. **自然日累加与每日 07:00 自动刷新**：
   - 按本地自然日（`00:00–24:00`）累加读取与写入流量（自动处理系统重启造成的计数器归零），连续保留近 30 天记录。
   - 每日早上 `07:00` 自动触发采样与页面数据更新，同时支持手动点击「立即采样」。
4. **顶部多选与 30 天双柱杂志风图表**：
   - 页面顶部提供多项选择框，自由勾选要展示的磁盘并持久化选择偏好。
   - 每个已选磁盘独立成张，采用归藏杂志风（暖白纸底、衬线大标题、细线网格与等宽数据）上下排列展示近 30 天读取/写入双柱柱状图。

## 安装与启用

在 `/Users/brucechen/Desktop/deepseek-harness` 根目录下执行：

```bash
pnpm dsh plugin add /Users/brucechen/Desktop/deepseek-harness/.plugin-dev/dsh-磁盘监测
pnpm dsh plugin enable @local/dsh-disk-monitor
```
