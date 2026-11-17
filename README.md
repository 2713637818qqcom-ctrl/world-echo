# WORLD ECHO（世界回声）🌍🔊

> **全球匿名文字与语音社区**  
> 听见世界另一端的心跳，留下穿越经纬的回声。

WORLD ECHO 是一个无需复杂打包构建、零构建成本、基于 Cloudflare Pages + Pages Functions + D1 + GitHub REST API + jsDelivr CDN 的轻量现代化全栈匿名社交平台。

---

## 🌟 核心特色与架构设计

1. **零构建前端（Zero-Build Frontend）**
   - 纯原生 HTML5 + CSS3 + Vanilla ES6+ 编写。
   - 通过 CDN 引入 `Globe.gl` 与 `Three.js` 呈现高拟真 3D 深空夜光地球。
   - 无需 `npm run build`、无需 Vite/Webpack，代码即改即现，直接托管于 Cloudflare Pages 静态根目录。

2. **Serverless 无服务器后端**
   - 基于 Cloudflare Pages Functions（`functions/api/echo.js`）。
   - 毫秒级全球冷启动响应，极低延迟。

3. **双擎免付费存储架构（No R2 Needed）**
   - **结构化元数据**：存储于 **Cloudflare D1**（分布式 SQL 数据库，绑定变量：`DB`）。
   - **语音二进制文件**：录音直传至 GitHub 公开仓库（如 `world-echo-media`），通过 **jsDelivr CDN** 全球加速分发播放，删除时同步调用 GitHub API 实现彻底的双端销毁。

4. **隐私先行（Privacy First）**
   - 严禁收集 GPS 经纬度与精确城市位置，仅由服务端从 Cloudflare 边缘节点网络读取 2 位 ISO 国家代码（如 `CN`, `US`, `JP`）。
   - 支持发布时勾选「隐藏国家」，保护极端隐私需求。
   - 客户端基于 LocalStorage 渐进式生成匿名身份，支持一键导出/导入「身份恢复码」。

5. **全维情感与声浪感知**
   - 9 大全球情绪天气胶囊（平静、开心、希望、孤独、疲惫、温暖、难过、焦虑、愤怒）。
   - 60 秒原生麦克风录音机，实时波形动效、录音倒计时、试听与重录。
   - 3D 地球光柱按情绪与内容类型（青色声浪 / 蓝色文字）动态增高，支持旋转、漫游与国家聚焦。

---

## 📁 项目目录结构

```text
world-echo/
├── index.html                  # 前台主页面（3D 地球、匿名身份、文字/语音发布、情绪天气、国家筛选、回复与点赞）
├── admin.html                  # 管理后台页面（密码校验、待审/被举报内容处理、一键双端删除）
├── migrations/
│   └── 0001_init.sql           # D1 数据库初始化建表与索引脚本（5 张核心表）
├── functions/
│   └── api/
│       └── echo.js             # 核心后端接口（GET 统计/列表、POST 发布/互动、DELETE 双端清理）
└── README.md                   # 部署与环境变量配置说明文档
```

---

## 🚀 部署配置全流程指南

### 第一步：准备 GitHub 媒体仓库与 Token
1. 在 GitHub 上新建一个公开仓库（Public Repository），例如 `your-username/world-echo-media`。
   - *提示：创建时勾选「Add a README file」，确保存在 `main` 分支。*
2. 创建 GitHub Personal Access Token (PAT)：
   - 访问 GitHub -> Settings -> Developer settings -> Personal access tokens (Tokens classic)。
   - 点击 **Generate new token (classic)**，勾选 `repo` 权限（允许读写仓库文件）。
   - 保存生成的 Token（如 `ghp_xxxxxxxxxxxx`）。

---

### 第二步：初始化 Cloudflare D1 数据库
你可以选择通过 **Cloudflare 控制台** 或 **Wrangler 命令行** 完成初始化：

#### 方式 A：通过 Cloudflare Web 控制台（推荐新手）
1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com/)。
2. 左侧菜单进入 **Storage & Databases** -> **D1 SQL Database**。
3. 点击 **Create database**，输入数据库名称 `world_echo_db`。
4. 创建完成后，进入该数据库详情页的 **Console（控制台）** 标签页。
5. 复制 `migrations/0001_init.sql` 中的全部 SQL 内容，粘贴并点击 **Execute** 执行建表。

#### 方式 B：通过 Wrangler CLI 命令行
```bash
# 登录 Cloudflare
npx wrangler login

# 创建 D1 数据库
npx wrangler d1 create world_echo_db

# 执行数据库迁移脚本（填入你创建后生成的 database_id 或名称）
npx wrangler d1 execute world_echo_db --file=./migrations/0001_init.sql
```

---

### 第三步：部署至 Cloudflare Pages
1. 将当前项目推送至 GitHub 或 GitLab 私有/公开仓库。
2. 在 Cloudflare Dashboard 中，点击 **Workers & Pages** -> **Create application** -> **Pages** -> **Connect to Git**。
3. 选择你的项目仓库，进入配置页：
   - **Framework preset**: `None`
   - **Build command**: *（保持为空）*
   - **Build output directory**: `/`（或留空代表根目录）
4. 点击 **Save and Deploy** 首次发布。

---

### 第四步：配置 Pages 环境变量与 D1 绑定

部署完成后，进入 Cloudflare Pages 该项目的 **Settings** 页面：

#### 1. 绑定 D1 数据库
- 进入 **Settings** -> **Functions** -> **D1 database bindings**。
- 点击 **Add binding**：
  - **Variable name（变量名称）**: 必须严格填写 `DB`
  - **D1 database**: 选择刚刚创建的 `world_echo_db`
- 点击 **Save** 保存。

#### 2. 配置环境变量
- 进入 **Settings** -> **Environment variables**。
- 添加以下 3 个环境变量（生产与预览环境均填）：
  | 变量名 | 说明 | 示例值 |
  | :--- | :--- | :--- |
  | `GITHUB_REPO` | 存放音频的 GitHub 仓库路径 | `your-username/world-echo-media` |
  | `GITHUB_TOKEN` | 具备写入权限的 GitHub PAT | `ghp_xxxxxxxxxxxxxxxxxxxx` |
  | `ADMIN_PASSWORD` | 管理后台登录与删除密码 | `YourSuperSafeSecret2026!` |
- 点击 **Save** 保存。

> ⚠️ **重要**：绑定与环境变量添加后，请在 **Deployments** 选项卡点击最新的一次构建旁边的 `...` -> **Retry deployment**（重试部署），使新的环境变量生效。

---

## 💻 本地预览与调试

因为本项目为零构建静态项目，你可以直接使用任何本地静态服务器预览前台界面（如 VSCode Live Server、`python -m http.server 8000` 或 `npx serve .`）。

如需在本地同时调试 Functions 与 D1 数据库，可使用 Wrangler 运行：
```bash
# 启动本地 Pages Functions 模拟环境
npx wrangler pages dev . --d1 DB=world_echo_db
```

---

## 🛡️ 安全与防刷机制

- **SHA-256 身份隔离**：前端用户的原始身份 Token 仅保存在其自身浏览器的 `localStorage` 中，服务端通过 Web Crypto API 计算其 SHA-256 哈希值入库，杜绝撞库与凭证泄露。
- **并发与网络重试**：GitHub REST API 语音文件上传内置 409 Conflict 冲突自动重试机制（自动重试 2 次并引入退避时延）。
- **自动化社区巡查**：留言被举报达 5 次自动从公共流隐藏（`status='hidden'`），流转至 `admin.html` 待管理员复核。
- **双端彻底销毁**：管理员或作者本人删除带有语音的留言时，系统同时调用 GitHub Contents API 移除远端音频文件，并级联物理删除 D1 评论与点赞记录，无残留垃圾文件。

---

## 📜 许可证

MIT License. Designed with deep-space aesthetics & human warmth.
