# WORLD ECHO（世界回声）🌍🔊

> **全球匿名文字与语音社区**  
> 听见世界另一端的心跳，留下穿越经纬的回声。

WORLD ECHO 是一个无需复杂打包构建、零构建成本、基于 Cloudflare Pages + Pages Functions + D1 + GitHub REST API + jsDelivr CDN 的轻量现代化全栈匿名社交平台。

---

## 🌟 核心特色与功能演进

1. **零构建深空地球前端（Zero-Build Frontend）**
   - 纯原生 HTML5 + CSS3 + Vanilla ES6+ 编写。
   - 通过 CDN 引入 `Globe.gl` 与 `Three.js` 呈现高拟真 3D 深空夜光地球。
   - 无需 `npm run build`、无需 Vite/Webpack，代码即改即现，直接托管于 Cloudflare Pages 静态根目录。

2. **🌐 全球自由语言切换（Multi-Language i18n）**
   - 内置 9 大主流语言界面即时无感切换：
     🇨🇳 简体中文、🇺🇸 English、🇯🇵 日本語、🇰🇷 한국어、🇪🇸 Español、🇫🇷 Français、🇩🇪 Deutsch、🇷🇺 Русский、🇸🇦 العربية。
   - 自动适配访客浏览器偏好或所在国籍，并提供顶部一键下拉自由切换，选择即时持久化到本地。

3. **☀️ 实时太阳光照与昼夜天象追踪（Real-Time Solar Day/Night Tracker）**
   - **天文级实时演算**：服务端与客户端根据当前 UTC 时间动态计算太阳直射点经纬度（Subsolar Point）。
   - **3D 地球直射光斑**：在 3D 地球上以金色涟漪光圈实时投射太阳正射位置。
   - **全球昼夜精准区分**：自动计算全球 45+ 国度此时此刻的太阳高度角与当地粗略太阳时，区分 **☀️ 白昼**、**🌅 晨昏拂晓**、**🌙 黑夜沉睡**。
   - **昼夜沉浸筛选**：支持一键切换「☀️ 仅看阳光照耀下的国家」与「🌙 仅看沉睡在夜幕中的国度」，卡片带有时区与日照徽章。

4. **Serverless 无服务器后端**
   - 基于 Cloudflare Pages Functions（`functions/api/echo.js`）。
   - 毫秒级全球边缘冷启动响应，极低延迟。

5. **双擎免付费存储架构（No R2 Needed）**
   - **结构化元数据**：存储于 **Cloudflare D1**（分布式 SQL 数据库，绑定变量：`DB`）。
   - **语音二进制文件**：录音直传至 GitHub 公开仓库（如 `world-echo-media`），通过 **jsDelivr CDN** 全球加速分发播放，删除时同步调用 GitHub API 实现彻底的双端销毁。

6. **隐私先行（Privacy First）**
   - 严禁收集 GPS 经纬度与精确城市位置，仅由服务端从 Cloudflare 边缘节点网络读取 2 位 ISO 国家代码（如 `CN`, `US`, `JP`）。
   - 支持发布时勾选「隐藏国家」，保护极端隐私需求。
   - 客户端基于 LocalStorage 渐进式生成匿名身份，支持一键导出/导入「身份恢复码」。

7. **全维情感与声浪感知**
   - 9 大全球情绪天气胶囊（平静、开心、希望、孤独、疲惫、温暖、难过、焦虑、愤怒）。
   - 60 秒原生麦克风录音机，实时波形动效、录音倒计时、试听与重录。

---

## 📁 项目目录结构

```text
world-echo/
├── index.html                  # 前台主页面（3D 地球、昼夜光照天象、9国语言、匿名身份、文字/语音发布、情绪天气、回复与点赞）
├── admin.html                  # 管理后台页面（密码校验、待审/被举报内容处理、一键双端删除）
├── deploy_to_github.py         # 自动部署脚本（免装 Git，原生 Python 一键同步推送至 GitHub）
├── migrations/
│   └── 0001_init.sql           # D1 数据库初始化建表与索引脚本（5 张核心表）
├── functions/
│   └── api/
│       └── echo.js             # 核心后端接口（GET 统计/列表、POST 发布/互动、DELETE 双端清理）
└── README.md                   # 部署与环境变量配置说明文档
```

---

## 🚀 一键自动部署至 GitHub

本项目自带无需安装任何 Git 客户端的原生 Python 自动同步部署脚本 `deploy_to_github.py`：

```bash
# 运行部署命令（填入你的 GitHub PAT 和仓库名称）：
python deploy_to_github.py --token <你的_GITHUB_PERSONAL_ACCESS_TOKEN> --repo <你的用户名>/world-echo
```
> **提示**：如果目标仓库在 GitHub 上尚不存在，脚本会自动为你创建公开仓库并将全站所有文件上传就绪！

---

## ☁️ 部署至 Cloudflare Pages 全流程

### 第一步：准备 GitHub 媒体仓库与 Token
1. 在 GitHub 上新建用于存放音频文件的仓库（如 `your-username/world-echo-media`，勾选初始化 README）。
2. 生成具备 `repo` 权限的 GitHub Personal Access Token (PAT)。

### 第二步：初始化 Cloudflare D1 数据库
1. 进入 Cloudflare Dashboard -> **Storage & Databases** -> **D1 SQL Database**。
2. 创建名为 `world_echo_db` 的数据库。
3. 在该数据库的 **Console** 中粘贴执行 `migrations/0001_init.sql`。

### 第三步：在 Cloudflare Pages 中连接部署
1. 在 Cloudflare Dashboard -> **Workers & Pages** -> **Create application** -> **Pages** -> **Connect to Git**。
2. 选择刚刚部署好的 `world-echo` 仓库。
3. 构建参数保持默认（Framework preset: `None`, Build command: 空, Build output directory: `/`）。
4. 部署后在 **Settings** 完成两处配置：
   - **Functions** -> **D1 database bindings**：绑定变量名 `DB` 指向 `world_echo_db`。
   - **Environment variables**：添加 `GITHUB_REPO`、`GITHUB_TOKEN`、`ADMIN_PASSWORD`。
5. 在 Deployments 中点击 **Retry deployment** 使环境变量生效。

---

## 📜 许可证

MIT License. Designed with deep-space aesthetics & human warmth.
