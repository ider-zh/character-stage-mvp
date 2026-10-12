# 同在 · 角色小庭院

一个可运行、可测试的共享角色舞台 MVP。中文响应式界面，React + TypeScript + PixiJS；Node.js + SQLite + 本地受控文件存储。角色库与舞台对所有访客共享，不创建房间或个人分区。

## 当前能力

- 上传真实 PNG / JPEG / WebP，服务器解码校验后重新编码成 PNG。透明图片效果最好，非透明图不会假装已抠图。
- SQLite 持久化角色、资源地址、位置和处理任务。重启后恢复；待处理任务可继续执行。
- WebSocket 同步上传结果、位置、跳跃、在线人数和拖动状态。
- 单连接持有一个 4 秒拖动租约，移动自动续约；冲突拒绝、断线释放、超时回收。
- PixiJS 整图轻微呼吸、摇摆、弹跳；鼠标和触摸互动；键盘方向键移动、空格跳跃。
- 摄像头默认关闭，仅在点击后请求视频权限，永不请求音频。MediaPipe FaceLandmarker 在浏览器 Worker 运行。画面、脸部参数和本地注视反馈均不上传，也不发给其他访客。
- 摄像头只估计头部位置与眨眼，不是精确视线追踪。权限拒绝、设备缺失、模型失败均退回鼠标玩法。
- 3 个原创种子角色：苔团、月芽、橘子。由项目内 SVG 绘制并栅格化，不是 AI 生成，也不依赖他人角色素材。

这是基础整图动画，不是 Live2D 绑定、自动分层或精细表情动画。没有配置图像生成服务，界面与 API 均明确说明，绝不伪造生成结果。扩展契约在 `server/providers.ts`。

## 快速启动

要求 Node.js 24+。首次安装需要连接 npm 官方仓库。

```bash
npm ci
npm run dev
```

打开 http://127.0.0.1:5173 。开发模式自动启动 Vite 5173 与后端 8787。

正式构建后在本机运行：

```bash
npm run build
npm start
```

打开 http://127.0.0.1:8787 。默认仅绑定本机，不公开上线。所有摄像头运行资源已放在 `public/`，运行时不会访问外部 CDN。

配置：复制 `.env.example` 为 `.env` 后用 `node --env-file=.env --experimental-strip-types server/index.ts` 启动，或由进程环境设置变量。`npm start` 不自动加载 `.env`。不要放入任何 API 密钥到浏览器前缀变量。首版没有 AI 密钥配置项。

如果删除了打包的摄像头资源，运行 `npm run prepare:camera`：从安装包复制固定版本 WASM、下载 Google 固定版本模型并校验 SHA-256。下载只发生在这一步；页面开启摄像头不会下载远程模型。

## 验证

```bash
npm run typecheck
npm test
npm run build
npm run test:production
CHROMIUM_PATH=/usr/bin/chromium npm run test:e2e
# 或在具备浏览器运行权限的环境中一次执行：
npm run check
```

E2E 使用系统 Chromium，默认 `/usr/bin/chromium`，可设置 `CHROMIUM_PATH`。测试启动自己的临时服务器与数据库，无需先启动应用。若本机没有 Chromium，可按 Playwright 官方安装说明安装后指定路径；不要通过关闭系统安全策略解决环境权限限制。

准确的本次验证结果及未验证项见 `TEST_REPORT.md`。已编写测试不代表本环境已经运行通过；浏览器的系统权限错误需和应用错误分开看待。

## 目录

```text
src/                    React UI、共享连接、PixiJS、摄像头 Hook/Worker
server/app.ts           HTTP / WebSocket、租约、任务处理、SQLite
server/images.ts        魔数 / MIME / 尺寸 / 全量解码 / PNG 规范化
server/seeds.ts         原创种子角色 SVG 源码
server/providers.ts     未启用的图像生成 / 分层扩展接口
public/mediapipe/        本地 MediaPipe WASM 与兼容模块 loader
public/models/          固定版本 FaceLandmarker 模型
scripts/prepare-camera.mjs  可重建摄像头资源的脚本
scripts/dev.mjs          本机开发启动器
tests/                  后端集成与浏览器端到端测试
evidence/               本地验证输出（不入 Git）
data/                   运行时 SQLite、assets、pending（不入源码包）
```

## 架构与数据流

1. `GET /api/state` 创建 7 天匿名 HttpOnly / SameSite=Strict 会话。服务端仅保存随机令牌的 SHA-256，不需要个人账号。
2. 同源 WebSocket `/ws` 验证会话后发送完整快照。断线指数退避重连并取新快照；页面本地缓存不充当数据库。
3. `POST /api/characters` 接收二进制图片，`Content-Type` 声明格式，`X-Character-Name` 为 URI 编码名称。校验成功写入暂存 PNG 和 queued 任务，返回 202。
4. 单服务器任务处理器转为 processing，再以随机文件名移动到资源目录，事务写入角色和 ready 任务，广播结果。失败保存 failed 状态。
5. `acquire` 获得短租约；只有持有人能 `move`。坐标每次落 SQLite；`release`、断线和到期都会解锁。动作广播不永久保存。
6. 浏览器 Worker 本地执行模型，输出少量头部位置/眨眼反馈给当前 UI；没有向后端写入此类信息的 API。

位置是归一化舞台坐标。不同屏幕的实际像素位置会不同，但相对位置一致。服务器约束 x 为 0.08–0.92、y 为 0.35–0.90；前端范围略窄以避免遮挡边缘。

## 安全与隐私边界

- 图片上限 5 MiB；边长 64–4096；总像素最多 1600 万；只接受静态 PNG / JPEG / WebP。
- 检查文件魔数与 MIME；不接受 SVG、GIF、可执行内容或客户端文件路径。完整解码后重编码，移除 EXIF 等元数据、附加数据和原文件名；最大输出边长 1024。
- 存储文件名由服务端随机 UUID 生成。只按数据库中登记的 UUID 返回图片；静态资源解析限制在构建目录内。
- 角色名字最多 30 字，拒绝路径字符、控制字符和 HTML 尖括号。React 文本渲染不使用不受信任 HTML。
- 公共访客没有删除接口权限。没有管理后台；需要管理员停机备份后维护数据库和资源文件。
- 基础 HTTP / 上传 / WebSocket 动作限流；同 IP 最多 8 个实时连接、全局最多 128；最多 100 个角色、同时最多 2 个上传处理。只信任直连 IP，不信任任意 X-Forwarded-For。
- 同源校验、HttpOnly 会话、CSP、nosniff、资源同源策略；摄像头只允许当前源，麦克风和地理位置禁用。
- 摄像头开关立即停止所有轨道、终止 Worker、销毁视频对象和计时器。授权弹窗仍未结束时点击关闭，迟到的媒体流也会立刻停止。
- 所有用户上传的角色都会向访问同一服务器的访客公开，请只上传有权分享的图片。无需摄像头也能完整体验基础玩法。

## 首版限制与上线前要求

- 单进程 SQLite + 文件存储，适合本机原型与小规模演示。不是可横向扩容的多实例服务；扩容需共享数据库、对象存储、分布式租约与消息总线。
- 没有账号、审核、举报、管理权限、备份调度或垃圾内容治理。匿名公共写入不能替代生产环境防滥用系统。
- 需要自己备份整个 `data/` 目录。持久化依赖可写且保留的磁盘；容器临时盘不能当永久存储。
- 生产部署需要 HTTPS、精确 `ALLOWED_ORIGINS`、`COOKIE_SECURE=1`、反向代理限流/体积上限、备份和运维。未替用户部署或购买服务。
- JPEG / 不透明 WebP / 无透明通道 PNG 会保留背景；没有自动抠图。单层图像无法真正独立眨眼、开口或转头。
- 渲染优先 WebGL；失败时降级为图片兼容模式。低性能设备、人脸模型兼容性和真实摄像头效果还需目标设备实测。
- Worker 使用固定 MediaPipe 0.10.32 的 module-loader 兼容处理；升级该依赖时需重新生成本地资源并重测。
- 动画尊重减少动态效果偏好，且可手动暂停。减少动态时仍保留小幅直接操作反馈。

## 依赖与参考

- [PixiJS Application](https://pixijs.com/8.x/guides/components/application)
- [Node.js SQLite](https://nodejs.org/download/release/latest-v24.x/docs/api/sqlite.html)
- [sharp 安全输入参数](https://sharp.pixelplumbing.com/api-constructor/)
- [Google Face Landmarker Web 指南](https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker/web_js)
- 模型来源：https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task
- 模型 SHA-256：`64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff`
- 第三方依赖/模型保留其原许可证；详情见 `THIRD_PARTY_NOTICES.md`。原创种子图形源码随项目交付。
