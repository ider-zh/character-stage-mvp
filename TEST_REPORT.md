# 验证报告

日期：2026-10-12 UTC。环境：Node.js 24.19.0，Linux，系统 Chromium。

本报告中的 `evidence/` 路径指验证时保留的本地诊断资料；运行日志、浏览器 trace 和生成的报告不提交到 Git。复验可使用文末命令。

## 已通过

- `npm run typecheck`：严格 TypeScript 检查通过。
- `npm test`：28 / 28 通过，0 失败。18 项使用真实 HTTP、WebSocket、SQLite 和图片解码的后端集成测试；10 项摄像头生命周期单元测试。
- `npm run build`：TypeScript + Vite 生产构建通过。
- 开发启动冒烟：`npm run dev` 启动器、Vite 源码入口、会话/API 代理和 WebSocket 代理 hello 均通过（`evidence/development-smoke.log`）。
- `npm run test:production`：本机生产 HTTP 冒烟通过；首页、22 个构建与摄像头资源、3 个种子 PNG、API，以及私有源码/路径穿越探针。
- `npm audit --omit=dev` 和全依赖 `npm audit`：当前锁定依赖均报告 0 个已知漏洞。审计不是安全保证。已将初始 sharp/ws 升级到修复版本 sharp 0.35.5 / ws 8.22.0。

完整最后一次结果在 `evidence/validation.log`，依赖审计在 `evidence/dependency-audit.json` 与 `evidence/dependency-audit-all.json`。

### 后端实际覆盖

- 匿名 HttpOnly 会话、哈希存储、缺会话拒绝、同源 HTTP/WS 保护
- PNG / JPEG / WebP 真实上传和 PNG 规范化，随机存储名与资源可读
- SVG 冒充图片、损坏数据、空数据、错误 MIME、超过 5 MiB、超大尺寸/总像素拒绝
- 路径式角色名拒绝、公共删除禁止、受保护目录不可访问
- 无图像 API 时明确拒绝生成，不产出假的任务/图片
- 两客户端共享上传、位置、动作和在线人数
- 同时抢锁只有一个获准；非持有人不能移动或释放
- 单连接不能囤多个角色的租约；显式释放、断线释放、过期回收、移动续租
- 重连获取新连接身份和新快照
- SQLite 关闭重开后角色、资源、任务、位置保持；临时租约不恢复
- 未完成任务重启恢复、缺失暂存文件任务转为 failed
- 非法 JSON / binary / 无效位置、HTTP/上传/WS 基础限流
- 种子图形内容、透明度、重启不重复种入

### 摄像头单元测试边界

测试运行真实 `useCamera` 源码，但用可控 hook、媒体流、视频、Worker 与计时器替身。覆盖拒绝、迟到授权、加载中关闭、重复开关、模型/采集/Worker 错误、设备断开、卸载、迟到 video.play 和 ImageBitmap 的资源释放。

这些是生命周期逻辑验证，不是浏览器权限界面、真实摄像头、人脸模型推理或设备兼容性验证。

## 未通过浏览器验收，原因明确

11 个 Playwright 场景已经编写并能发现。实际启动测试时，测试服务器正常就绪，但 Chromium 在创建页面前被操作系统阻止：

```text
FATAL: chrome/browser/process_singleton_posix.cc:297
socket() failed: Operation not permitted
```

标准启动及一次获准重试都遇到同一系统限制。独立受支持云浏览器尝试也无法连通隔离的本机测试服务（ERR_CONNECTION_REFUSED）。未通过降低系统安全设置或绕过权限来强行执行。

因此，浏览器套件本次结果为：首个场景在浏览器启动阶段失败，其余 10 个未运行。不能把它称为 UI 测试通过。诊断在 `evidence/playwright-report/` 和 `evidence/playwright-results/`。

以下仍需在允许运行 Chromium 的本机/CI 或实际设备确认：

- 桌面/手机完整页面视觉、布局溢出、真实触摸交互
- 浏览器中的两客户端拖动/弹跳/上传与断线重连
- 摄像头拒绝和关闭的真实权限 UI、视频轨道状态
- MediaPipe Worker 的真实 WASM/模型初始化与推理
- 移动 Safari、WebGL 降级和减少动态效果的视觉表现

已做独立静态复核并修复：服务端错误对象导致 React 渲染崩溃、迟到 HTTP queued 响应覆盖 WS ready、摄像头状态反馈缺失、外部字体依赖、手机关键文字和触控区域过小。前端现在没有运行时外部字体请求；手机上传改为单列，关键操作触区至少 44px。

## Codex CLI 最小验证

已实际调用 `codex exec`；版本为 0.159.2。CLI 在 in-process app-server 初始化时因只读文件系统失败，退出码 1，未开始代码任务。证据：`evidence/codex-smoke.log`。

源码实现与上述已通过测试使用当前获授权的云执行环境完成；没有读取/迁移登录凭据、访问历史 sessions 或更改系统权限。

## 复验命令

```bash
npm ci
npm run typecheck
npm test
npm run build
npm run test:production
CHROMIUM_PATH=/usr/bin/chromium npm run test:e2e
```

本项目未发布到公开站点，未创建外部仓库，未购买服务。
