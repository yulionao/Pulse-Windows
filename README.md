# Pulse for Windows

Pulse 是一款 Windows 托盘用量面板，用于集中查看 AI 编程订阅和 API 平台的配额。界面采用简洁、安静的 Pulse 原生风格，并自动跟随 Windows 浅色或深色模式。

## 内置数据源

- Claude：支持官方 Claude 登录、5 小时与周用量、本地 token 统计。
- Codex：支持官方 Codex 设备登录、订阅用量与本地 token 统计。
- 智谱 CodePlan、Kimi CodePlan、MiniMax Coding Plan。
- OpenCodeGo Plan。
- SubAPI（兼容 Sub2API 服务）：自动读取平台消费、请求、Token 与日/周/月额度，可手动选择展示平台并默认隐藏空模块。
- DeepSeek、Tavily。

## 功能

- 系统托盘常驻、开机启动和定时刷新。
- 分组或标签页概览。
- 折线图或堆叠柱图统计。
- 中英文界面，自动跟随 Windows 浅色或深色模式。
- 内置 Python、Codex CLI 与 Claude CLI，无需另外安装运行环境。
- 配置与旧版 UsageBoard 共用 `%APPDATA%\UsageBoard`，升级不会丢失数据。

## 开发

```powershell
cd windows
npm install
npm run python:prepare
npm test
npm start
```

## 构建

```powershell
cd windows
npm run dist
```

输出为 Windows x64 安装版和便携版。详细信息见 [windows/README.md](windows/README.md)。

## 许可证

[MIT](LICENSE)
