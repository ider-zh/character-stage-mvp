# 工程交接 · 同在角色小庭院

更新日期：2026-10-12 UTC。面向下一位接手本仓库的 Codex / 开发者。

**当前交付是可运行的共享舞台 MVP，尚未完成浏览器和真实摄像头验收。** 请先复现现状，再继续开发；不要把已有实现、测试文件或静态资源可读等同于效果验收。

## 1. 产品目标与不可丢失的边界

目标是一个公共共享角色舞台：访客上传自己有权分享的角色图片，所有访客看见同一份角色库和舞台，可以用鼠标、触摸、键盘，以及自愿开启的摄像头与角色互动。

- 同一服务器只有一份共享舞台，不是个人角色库，也没有房间划分。
- 上传角色、持久位置、跳跃和拖动占用状态共享；当前选中的角色、鼠标响应、摄像头反馈、暂停动画均为各浏览器本地状态。
- 摄像头默认关闭，只有主动点击才请求视频权限，永不请求音频。视频、面部网格、头部位置和眨眼结果不上传、不广播、不保存到服务端。
- 必须保留上传前的公开性与版权提示。上传内容会转换为 PNG，向同一服务器的访客公开；不要把“服务器移除元数据”描述为“图片内容不公开”。请避免上传私人照片、个人信息或无权分享的作品。
- 当前“注视 / 镜头互动”只是鼻尖位置估计与眨眼带来的整图轻微反馈，不是精准 gaze，也不是眼球朝向校准。没有人脸时回到鼠标反馈，不影响基础玩法。

## 2. 已实现与未实现

### 已实现的代码能力

- 中文响应式 React 页面、公开角色卡片、上传预览和进度、排队 / 处理 / 完成 / 失败状态。
- PNG / JPEG / WebP 服务端真实解码、格式与大小校验、PNG 规范化、受控随机文件名。
- SQLite 持久化、受控本地资源目录、重启恢复任务。
- WebSocket 快照、角色增量、位置、在线连接数、跳跃广播、拖动租约和自动重连。
- PixiJS 单张精灵图的呼吸、摇摆、弹跳；鼠标 / 触摸拖动、方向键移动、空格或 Enter 跳跃。
- 系统减少动态效果设置、手动暂停；WebGL 初始化失败时的图片兼容模式。
- 浏览器 Worker 内 MediaPipe FaceLandmarker 管线，权限 / 加载 / 出错 / 停止 / 卸载生命周期处理。
- 3 个项目自绘种子角色：苔团、月芽、橘子。SVG 源码位于 `server/seeds.ts`，服务器栅格化为透明 PNG；不是 AI 生成素材。

### 尚未实现或不可宣称完成

- 没有 AI 抠图、自动分层、Live2D、骨骼绑定、独立眼口表情或真正转头。上传非透明图片会保留背景；眨眼输入目前只驱动整图微小缩放。
- 没有可用的图像生成服务。`server/providers.ts` 只有扩展接口；`POST /api/generations` 明确返回不可用，不生成假任务或占位“成品”。
- 没有账号系统、审核 / 举报 / 管理后台、删除管理流程、自动备份或多实例部署能力。
- 桌面与手机真实视觉、真实触摸、浏览器摄像头权限 UI、实际 MediaPipe 推理和目标设备兼容性均未验收。

## 3. 技术栈与阅读入口

锁定版本以 `package-lock.json` 为准：Node.js 24+、React 19.3.0、TypeScript 6.0.3、Vite 7.3.6、PixiJS 8.22.0、MediaPipe Tasks Vision 0.10.32、sharp 0.35.5、ws 8.22.0。后端使用 Node 内置 `node:sqlite`，没有独立数据库服务或 Web 框架。

```text
src/App.tsx                 页面、上传、选中角色、暂停和隐私说明
src/Stage.tsx               PixiJS 渲染、整图动画、拖动/键盘、图片降级
src/useSharedStage.ts       HTTP 初始状态、WebSocket、重连、移动节流
src/useCamera.ts            显式权限请求、资源生命周期、超时和失败回退
src/face.worker.ts          本地模型初始化、帧推理、头部位置/眨眼摘要
src/types.ts                Character / Job / Lease / 消息协议
src/styles.css              桌面/移动布局及兼容模式动画
server/index.ts             环境变量、启动与正常退出
server/app.ts               HTTP / WS、SQLite、任务队列、租约、限流
server/images.ts            图片及角色名验证、解码、PNG 规范化
server/seeds.ts              3 个原创种子角色
server/providers.ts         图像生成/分层 provider 扩展契约，尚未接入
public/mediapipe/wasm/       固定版本 WASM、JS 与 module-loader 包装
public/models/              FaceLandmarker 模型
scripts/prepare-camera.mjs  重建摄像头运行资源并校验模型
scripts/dev.mjs             Vite + Node 开发启动器
scripts/smoke-production.mjs 生产构建 HTTP 与资源冒烟
playwright.config.ts        浏览器、临时测试服务与报告设置
tests/                      后端、摄像头生命周期及浏览器测试
data/                       默认运行数据，不进入 Git
evidence/                   本地测试日志/报告，不进入 Git
```

推荐依次读：[README](README.md)、本文件、[验证报告](TEST_REPORT.md)、[测试说明](tests/README.md)、`src/types.ts`、`server/app.ts`，再看当前要修改的前端模块。

## 4. 本地启动、环境变量与测试

在仓库根目录运行。要求 Node.js 24+；安装时需要 npm 官方仓库网络。

```bash
npm ci
npm run dev
```

开发页面为 `http://127.0.0.1:5173`，后端为 `http://127.0.0.1:8787`。Vite 将 `/api`、`/assets`、`/ws` 代理至后端。开发代理地址写在 `vite.config.ts`；若改变后端 HOST / PORT，需要一起调整代理，不能只改环境变量。

生产构建的本机启动：

```bash
npm run build
npm start
```

页面为 `http://127.0.0.1:8787`。默认只监听本机；这一步不等于公开部署。`npm run server` 与 `npm start` 都直接运行 `server/index.ts`，不会自动构建前端。

环境变量见 [`.env.example`](.env.example)：

- `HOST`：默认 `127.0.0.1`。
- `PORT`：默认 `8787`。
- `DATA_DIR`：默认 `./data`，相对于启动进程的工作目录；需要可写、可保留的磁盘。
- `ALLOWED_ORIGINS`：逗号分隔的精确浏览器来源，包含协议、域名和端口。默认允许本机后端端口及 Vite 5173；上线时明确配置实际来源。
- `COOKIE_SECURE`：只有字符串 `1` 才开启 Secure Cookie；本机 HTTP 默认 `0`，正式 HTTPS 应使用 `1`。
- `CHROMIUM_PATH`：测试用的已有 Chromium 可执行文件路径；不是应用配置。

`npm start` 和开发启动器不自动读取 `.env`。可以由进程环境注入；或复制示例文件后显式启动：

```bash
node --env-file=.env --experimental-strip-types server/index.ts
```

当前没有 AI API 密钥变量。以后接 provider 时，密钥只能留在服务端，不能放进 `VITE_*` 等浏览器可见配置，也不能提交到 Git。

复验命令：

```bash
npm run typecheck
npm test
npm run build
npm run test:production
CHROMIUM_PATH=/usr/bin/chromium npm run test:e2e
```

- `npm test` 使用临时 SQLite / HTTP / WebSocket，不需要先启动应用。
- E2E 需要先有 `dist/`；测试自动启动 4173 临时服务和独立测试数据，不需要运行开发服务器。配置使用系统 Chromium，不自动下载浏览器。
- `npm run check` 包含 typecheck、单元/集成测试、build、E2E，**不包含** `test:production`。
- 不要为跑测试修改操作系统安全限制。若当前执行环境禁止浏览器启动，使用正常允许浏览器运行的开发机或 CI，并如实记录未运行阶段。

## 5. API、消息与数据结构

### HTTP

- `GET /api/health`：返回基本健康信息，含 `mode: basic`、`imageGeneration: false`、`storage: sqlite`。
- `GET /api/state`：建立或复用匿名会话并返回 `StageState`。Cookie 名为 `stage_session`，HttpOnly / SameSite=Strict，期限 7 天；数据库仅存令牌 SHA-256 与到期时间。
- `POST /api/characters`：要求匿名会话和允许的来源。请求体直接是二进制图片，**不是 multipart**；`Content-Type` 声明格式，`X-Character-Name` 为 URI 编码后的名称。成功返回 HTTP 202 与 `{ job }`，最终结果经 WebSocket / 后续快照取得。
- `POST /api/generations`：当前 HTTP 503，错误码 `generation_unavailable`。
- `DELETE /api/characters/:id`：公共访客 HTTP 403，`delete_forbidden`，不是可用的管理接口。
- `GET /assets/:uuid.png`：只返回数据库登记角色的规范化 PNG；原文件名和未处理的原始字节不作为下载资源保存。
- 通用 HTTP 错误结构为 `{ error: { code, message } }`。前端应显示字符串 `message`，不能把整个对象渲染成 React 文本。

### 数据模型

定义在 `src/types.ts`；数据库建表语句在 `server/app.ts`。

- `Character`：`id`、`name`、`assetUrl`、`width`、`height`、`x`、`y`、`createdAt`、`mode: 'basic'`、`source: 'seed' | 'upload'`。
- `Job`：`id`、`status: 'queued' | 'processing' | 'ready' | 'failed'`、`characterId`、`error`、`createdAt`。数据库额外保存 `name`、`pendingFile`、`width`、`height` 以支持恢复；公开快照最多取最近 50 项任务。
- `Lease`：`characterId`、`owner`、`expiresAt`。`owner` 是当前 WebSocket 连接 ID，不是永久用户 ID。
- `StageState`：`characters`、`jobs`、`leases`、`online`。在线数按连接计，不是去重人数。
- `FaceFeedback`：`x`、`y`、`blink`、`present`，只在浏览器 Hook / Worker / Stage 间使用，不属于共享协议。

### WebSocket 与共享规则

先请求 `/api/state`，再连接同源 `/ws`。服务端校验匿名会话、来源、连接限额；首次消息 `hello` 提供 `clientId` 和完整快照。

- 客户端消息：`acquire`、`move`、`release`、`bounce`，均带 `characterId`；`move` 额外带 `x/y`。
- 服务端消息：`hello`、`character`、`job`、`lease`、`bounce`、`presence`、`error`。完整联合类型见 `src/types.ts`。
- 同一角色只能有一个租约持有连接；默认 4 秒。获取别的角色会释放本连接旧租约，避免囤锁。非持有人不能移动或释放别人的租约。
- `move` 自动续租，前端拖动静止时每 1.5 秒续租；释放、断线、过期均解锁。重启不恢复临时租约。
- 坐标为归一化比例。服务端限制 x 为 0.08–0.92、y 为 0.35–0.90；前端使用更窄的 x 0.10–0.90、y 0.35–0.85。每次有效移动落 SQLite 并广播，前端约 50ms 合并发送。
- 跳跃是临时事件，广播但不持久化；不要求拖动租约。选中和本地“注视”不抢锁、不改共享位置。
- 断线按约 1、2、4、8、15 秒重试，重新取状态和连接身份，不以页面本地缓存恢复服务器数据。
- 上传时 WebSocket 的 ready 可能先于 HTTP queued 响应到达；保留 `addJob` 防止旧响应覆盖新状态的逻辑及回归测试。

## 6. 持久目录、备份与资源恢复

默认 `data/` 包含：

```text
data/stage.sqlite           characters / jobs / sessions
data/stage.sqlite-wal       SQLite WAL，运行时可能存在
data/stage.sqlite-shm       SQLite 共享内存辅助文件，运行时可能存在
data/assets/<角色 UUID>.png  已发布的规范化角色图片
data/pending/<任务 UUID>.png 待处理的规范化图片
```

任务流程：图片校验 → 写 pending → 插入 queued → processing → 移至 assets → 事务写角色和 ready → 广播。启动时继续 queued / processing；若文件已移动且目标存在可继续完成，缺失必要文件则转 failed，不伪造成功。

- 保持数据库和 assets / pending 同步备份。最简单的原型备份方式是正常停止服务后复制整个 `DATA_DIR`，然后再启动；不要只在写入期间复制 `stage.sqlite`、遗漏 WAL 或单独拷走图片。
- 恢复时停服，把同一份完整快照还原到目标 `DATA_DIR`，确认进程可读写，启动后核对角色、图片、任务和位置。不要把 `.gitignore` 中被排除的数据目录误当成已经进入仓库。
- 数据库为空时会播种 3 个角色；已有记录时不重复播种。已有角色的资产丢失不会自动重建，应该恢复对应备份，而不是删除数据库。
- 当前是单进程设计，没有迁移系统、在线一致性备份、对象存储、自动清理或损坏修复工具。更改 schema 前先设计迁移和回滚，不能静默重建用户数据库。

摄像头资源应位于 `public/`。首次克隆后先运行准备脚本，补齐或校验固定版本资源；`npm run build` 将其复制到 `dist/`，运行时全部从同源读取，不依赖外部 CDN。在安装依赖后运行：

```bash
npm run prepare:camera
npm run build
```

准备脚本从已安装的固定版本包复制 WASM / loader，创建 module-worker 兼容 `.mjs` 包装，并从 Google 下载固定 FaceLandmarker 模型、验证 SHA-256。模型来源、哈希和许可见 [README 参考](README.md#依赖与参考) 与 [第三方声明](THIRD_PARTY_NOTICES.md)。升级 MediaPipe 必须重建资源，并重新验证真实 Worker 初始化；HTTP 200 或文件存在不能证明推理可用。

## 7. 验证现状：已通过、阻塞、未验收

以下来自 2026-10-12 的 [TEST_REPORT.md](TEST_REPORT.md)，不是本次文档修改重新执行的测试结果。

- typecheck、生产 build、开发启动冒烟、生产 HTTP / 静态资源冒烟：已通过。
- `npm test`：**28 / 28 通过**，其中 18 项真实 HTTP / WebSocket / SQLite / 图片解码后端测试，10 项摄像头生命周期单元测试。
- 当时锁定依赖的生产及全量 npm audit 报告均为 0 个已知漏洞；不等于无安全风险，也不是未来审计结果。
- Playwright：发现 11 个场景，**没有任何一个完成浏览器验收**。首个场景在创建页面前因 Chromium `socket() failed: Operation not permitted` 启动失败，其余 10 个未运行。另一浏览器无法连接隔离的本机服务，得到连接拒绝。
- 尚无可信的真实页面视觉、移动端触摸、移动 Safari、降级渲染、真实设备权限 UI、实际镜头流和 MediaPipe 模型推理验收。

摄像头单元测试运行真实 `useCamera` 逻辑，但媒体流、视频、Worker、Hook 环境与计时器是替身，覆盖权限拒绝、迟到授权、加载中关闭、反复开关、设备断开、卸载、Worker / 模型失败和资源释放。它们不验证真实 Worker 模型加载或追踪准确性。

已做的静态修复包括 HTTP 错误对象渲染、上传 queued / ready 竞态、镜头状态文案、外部字体移除和手机触控尺寸。不要据此跳过视觉复验。`evidence/` 是本地诊断输出，未进入 Git；新接手环境应自行生成证据，不假定报告提到的日志随仓库存在。

本项目没有个人登录流程。遇到故障时从真实请求和日志定位：`/api/state`、会话 Cookie、精确 Origin、Vite 代理、`/ws` 握手、资源路径、浏览器进程启动等分别排查。不要虚构“登录失效”根因，也不要把环境级 Chromium 权限故障说成已证实的服务端问题。若确认是服务端缺陷，应修复服务端并补回归测试，不得用关闭校验或伪造成功绕过。

## 8. 下一步建议，按优先级

### P0：在能正常运行浏览器的环境完成验收

1. 复跑完整命令，保留明确的通过 / 失败 / 未运行清单。先让 11 个现有 E2E 真正执行，再修暴露出的产品问题。
2. 检查桌面和手机的整页截图、无横向溢出、上传状态与报错、角色遮挡、触控命中区域、真实拖动与页面滚动冲突、键盘可用性、低动态偏好和图片降级。
3. 用两个独立浏览器上下文验证共享上传、争抢 / 释放租约、位置同步、跳跃、断网重连和服务重启恢复。不能只看单页 DOM 数值。
4. 对修复重跑相关回归与完整 suite，更新验证报告并附可复现证据。不要把截图文件生成失败写成 UI 通过。

### P1：真实设备摄像头与动画质量 PoC

1. 在安全上下文的真实桌面浏览器和目标手机上验证主动授权、拒绝、权限弹窗期间关闭、加载中关闭、反复切换、标签页切换和设备拔出；确认关闭后系统摄像头指示灯 / 轨道停止。
2. 验证本地 WASM / 模型初始化、CPU / 内存 / 帧率、Worker 错误回退、移动 Safari 的 OffscreenCanvas / Worker 支持。用网络检查确认没有视频帧或面部数据离开浏览器。
3. 做小范围图像动画质量 PoC：对透明 / 不透明、不同长宽比和不同角色形态评估现有整图变形效果，再决定是否增加背景移除、分层与眼口局部动画。先定义视觉验收样例、失败回退、性能和成本，不能预先宣称“一张图变 Live2D”。

### P2：接入图像 provider

1. 先与用户确定服务商、图像发送范围、用途、价格上限和期望质量；当前仓库没有此类服务凭据或付费授权。
2. 从 `ImageGenerationProvider.generate(prompt, signal)` 和 `CharacterLayeringProvider.separate(canonicalPng, signal)` 契约实现服务端适配器，加入超时、取消、错误、限额与真实结果验证，再设计持久化任务和前端体验。
3. 保留未配置时的明确提示；不得把错误响应或占位图标记为成功。输出图像也需安全验证、受控存储，涉及新资产类型时更新 schema / 类型 / 测试。

### 公开生产环境前的门槛

- 建立管理员权限、审核 / 举报 / 下架流程与滥用处置。现有匿名 Cookie 不是身份认证或内容治理。
- 保留并加强上传、连接、动作与边缘层限流；当前按直连 IP 计数，不信任任意 `X-Forwarded-For`。反向代理可能让所有访客共用一个 IP 额度，需要明确可信代理方案，不能无条件信任转发头。
- 现有限制为图片 5 MiB、边长 64–4096、总像素 1600 万、输出最大边长 1024、角色总量 100、并发上传校验 2、同 IP WS 8、全局 WS 128。根据容量测试调整，不当成生产容量保证。
- 使用 HTTPS、精确来源列表、Secure Cookie、反向代理 WebSocket 支持与体积上限；不暴露 data / pending / 源码。
- 配置持久磁盘、备份与恢复演练、监控告警和维护流程。多实例扩展需要共享数据库、对象存储、分布式租约和消息总线，不能直接复制当前进程。
- 审查素材权利、第三方许可证与隐私说明。仓库推送和公开站点部署是不同动作，已有 Git 仓库不等于已经上线。

## 9. 交接使用范围

本文记录产品目标、工程现状、验证边界和建议，不代替用户向下一位开发者授权。它不授权发布 / 部署、购买或调用付费服务、发送图片到第三方、设置凭据、修改安全策略或删除用户数据；这些操作应按用户后续明确要求和实际权限处理。

可给下一位 Codex 的开场提示词：

> 请先阅读本仓库 HANDOFF.md、README.md、TEST_REPORT.md 和 tests/README.md，核对当前分支与运行环境。目标是公共共享角色舞台，优先完成现有浏览器测试和手机 UI 验收，再处理发现的问题。保留共享租约、匿名会话校验、摄像头默认关闭且视频/脸数据仅本地处理、上传图片公开提示等边界。请先说明已验证与未验证项，再给出本轮最小改动和验收计划；不要将基础整图动画说成 AI 分层或 Live2D。发布、付费服务、外传图片或安全设置修改需要另行获得我的明确授权。
