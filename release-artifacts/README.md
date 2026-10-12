# 生产构建产物

日期：2026-10-12 UTC。`dist/` 保存本项目源代码执行 `npm run build` 产生的前端生产构建。HTML、打包 JS/CSS 和摄像头资源分批提交；运行前请按下方命令准备资源，确保 WASM 与模型完整。

这是构建产物交付，不代表已公开部署。应用仍依赖仓库内 Node.js 24+ 后端、SQLite 和可持久化文件存储。不要只部署这个静态目录就宣称共享上传和实时同步可用。

## 推荐：从源码复现

在仓库根目录执行：

```bash
npm ci
npm run prepare:camera
npm run build
npm start
```

`prepare:camera` 从固定版本 npm 包复制 WASM，在模型缺失时从 Google 官方源下载固定模型，并校验模型 SHA-256。首次克隆后先执行一次可确保摄像头资源完整；模型和 WASM 运行时均从本站读取。

## 直接使用这份前端产物

先安装依赖，将此处的 `dist/` 复制到仓库根目录的 `dist/`，再补齐摄像头资源并启动后端。以下为 macOS / Linux 命令：

```bash
npm ci
cp -R release-artifacts/dist ./dist
npm run prepare:camera
cp -R public/. dist/
npm start
```

复制前请确认根目录没有旧 `dist/`，避免出现嵌套目录；已有构建时优先使用上面的源码复现流程。

## 已验证与限制

- 本次重新执行 TypeScript + Vite 生产构建通过。
- 生产 HTTP 冒烟通过：HTML、22 个构建/摄像头资源、3 个种子 PNG、API 和私有路径保护。
- 单元/后端测试 28/28 通过，详见根目录 `TEST_REPORT.md`。
- 浏览器视觉、真实摄像头推理、移动端和真实 WebGL 效果仍未验收，不能把 HTTP 资源可读取等同于 UI 验收。
- 不包含 node_modules、运行数据库、上传图片、会话、日志或凭据。第三方资源许可证见根目录 `THIRD_PARTY_NOTICES.md` 与 `licenses/`。
