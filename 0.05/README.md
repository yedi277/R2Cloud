
# MyCloud - 轻量私有云盘 0.03

基于 Cloudflare Workers + KV + R2 的全功能私有云存储系统，单文件架构，带WebDAV 的服务，零服务器成本，部署即用。
## 更新部分

0.03版
- 手机端UI优化 
- 编辑器相关优化
- 优化文件类型图标
- .url文件可跳转对应网址
- .html 网页内渲染预览
- 新增批量下载 → ZIP 打包
- 新增 新建文件 .txt .md
- 一键新建并内联重命名 (单文件版)
- 重命名不变保存导致文件删除
- 快捷键添加

## 预览

<img width="1217" height="684" alt="image" src="https://github.com/user-attachments/assets/ca284418-e213-45ab-9628-9b4a165439ab" />
<img width="1217" height="686" alt="image" src="https://github.com/user-attachments/assets/a4bce4f7-f8ae-4a7e-9568-a751b153ba7a" />

## 特性概览

- 单文件部署 — 全部后端 API 与前端页面打包在一个 `worker.js` 中
- 零服务器成本 — 迳用 Cloudflare Workers 免费额度即可运行
- 三级权限体系 — 管理员 / 注册用户 / 游客，灵活管控
- 全平台适配 — 暗色模式、移动端响应式布局
- 安全分享 — 密码保护、有效期控制、访问统计
- 带文本编辑器，支持 50+ 种代码高亮扩展名
- 兼容 WebDAV 的服务
---
## 多版本 

- 多用户版:	worker.js
- 单用户版:	worker_Single.js
- WEBdav纯后台版:worker_webdav.js
- WEBdav网页UI版:worker_webdavUI.js

## 管理员登录提示 

(ADMIN_PASSWORD:填写的就是管理员登录密码)
- !!!管理员登录 输入密码后, 点击游客登录.
管理员链接 WEBdav :账户随意填写 填写管理员密码.

## Cloudflare部署指南

部署非常简单,全程在 Cloudflare Dashboard 中完成.

先开通 Cloudflare 账户。
再开通 KV、R2和 Workers 服务。(R2开通需要绑定支付)

### 1. 创建 Cloudflare 资源

#### 创建 R2 存储桶

登录 Cloudflare 存储和数据库 -> R2 对象存储 ->概述 创建存储桶。
记下您的存储桶名称（例如 mycloud-r2）。

#### 创建 KV 命名空间

登录 Cloudflare 存储和数据库 -> Workers KV -> 创建命名空间。
记下您的命名空间名称（例如 mycloud-kv）。

#### 创建 Worker

登录 Cloudflare 计算 -> Workers和Pages -> 创建应用程序 -> 选 Hello World! 开始。
为您的 Worker 命名（例如 mycloud），然后点击 部署。

#### 上传代码

在 Worker 页面，右上角点击 编辑代码。
将本项目提供的 worker.js 文件内容完整粘贴进去。
点击 部署。

### 配置绑定

#### 配置环境变量：
返回 Worker 概览页面，
点击: 设置 -> 变量和密钥 -> 添加

- 类型:	  文本
- 变量名称: ADMIN_PASSWORD
- 值：	  设置您的管理员登录密码。

#### 配置 R2	绑定：

点击:绑定 -> 添加绑定 -> R2 存储桶 -> 添加绑定

- 变量名称：R2_BUCKET
- R2 存储桶：选择您在前面创建的存储桶。

#### 配置 KV	绑定：
(纯webdva版本不需要)
点击:绑定 -> 添加绑定 -> KV 命名空间 -> 添加绑定

- 变量名称：KV_STORE
- KV 命名空间：选择您在前面创建的命名空间。

###  配置 wrangler.toml
```toml
name = "mycloud"
main = "worker.js"
compatibility_date = "2024-01-01"

[[kv_namespaces]]
binding = "KV_STORE"
id = "你的KV命名空间ID"

[[r2_buckets]]
binding = "R2_BUCKET"
bucket_name = "你的R2桶名"

[vars]
ADMIN_PASSWORD = "你的管理员密码"
```
## 功能详解

### 认证与权限

| 角色 | 登录方式 | 权限范围 |
|------|---------|---------|
| 管理员 (admin) | 密码直登 | 全部文件 + 管理后台 |
| 注册用户 (user) | 邮箱 + 密码 | 可限定访问文件夹 + 上传大小 |
| 游客 (guest) | 一键登录（可由管理员关闭） | 仅 `guest/` 目录，只读浏览 |

- JWT 签发与验证（HMAC-SHA256）
- Cookie 机制：HttpOnly、SameSite=Strict、24 小时有效期
- 管理员可按用户设置文件夹白名单与上传大小限制

### WEBdav功能总览

- 支持操作: 浏览、上传、下载、删除、重命名/移动、复制、创建文件夹、能力声明
- 支持标准 Basic Auth（WebDAV 客户端用）和 Cookie（浏览器已登录用户自动识别）。
- 支持协议: WebDAV Class 1 & 2
- 支持分块上传的 Web 界面上传大文件
- 完全复用现有 checkPathAccess 权限系统
	游客默认只能访问 guest 文件夹
	受限用户只能访问授权文件夹
- 权限层级（从上到下逐级检查）
```toml
全局 WebDAV 开关 (webdavEnabled)
  └→ 全局只读模式 (webdavReadOnly)
      └→ 用户级 WebDAV 开关 (per-user webdavEnabled)
          └→ 用户级只读模式 (per-user webdavReadOnly)
              └→ 文件夹访问权限 (allowedFolders)
                  └→ 上传大小限制 (maxUploadSize)
```
## ⌨ 快捷键

| 快捷键 	| 功能 |
|文件列表 / 主界面||
|------|------|
|Ctrl+F	|打开搜索（输入框内也生效）|
|Ctrl+A	|全选|
|Delete	|删除选中项|
|Alt+N/M	|新建文件/文件夹|
|F2	|重命名选中项|
|x	|下载选中项|
|e	|编辑器打开（文件夹跳过）|
|Enter |打开文件夹/文件预览或下载|
|Backspace	|返回上级目录|
|Ctrl+Backspace	|前进|
|↑ ↓ ← →	|移动选择|
|Shift+方向键	|范围多选|
|Escape	|关闭所有弹层|
|编辑器||
|Ctrl+S | 保存|
|Ctrl+G	| 跳转行号|
|Ctrl+Z	| 撤销|
|Ctrl+Y / Ctrl+Shift+Z |重做|
|Ctrl+F |	查找|
|Home/End | 首/末行 |
|搜索框||
|↑ ↓ |上/下移动搜索结果高亮|
|Enter / →	|跳转到文件所在目录并选中|
---
### 文件管理

| 操作 | 说明 |
|------|------|
| 浏览目录 | 面包屑导航，支持网格/列表视图切换 |
| 上传文件 | 表单上传至 R2，拖拽上传，支持大小限制 |
| 下载文件 | 直接从 R2 获取，带正确 Content-Type |
| 删除 | 支持文件与文件夹（自动递归清理子对象） |
| 重命名 | 复制到新 key → 删除旧 key |
| 创建文件夹 | R2 占位对象 `.folder` |
| 创建文本文件 | 直接写入内容到 R2 |
| 编辑文本文件 | GET 读取 / PUT 保存，支持 50+ 种代码高亮扩展名 |

### 文件预览

根据文件扩展名自动识别预览类型：

| 类型 | 支持格式 |
|------|---------|
| 图片 | jpg, jpeg, png, gif, webp, svg, ico, bmp |
| PDF | pdf |
| 视频 | mp4, webm, ogg |
| 音频 | mp3, wav, ogg, flac, m4a |
| 文本/代码 | txt, md, json, js, ts, css, html, py, java, go, rs, vue, jsx, sql … 等 50+ 种 |
| Word | docx |

### 搜索

- **快速模式** — 最多扫描 10 页，实时响应
- **全量模式** — 最多扫描 9999 页，深度检索
- 文件名模糊匹配，最多返回 50 条结果

### 收藏夹

- 每用户独立收藏列表，存储在 KV
- 添加 / 移除 / 列表，首页加载时预注入（省一次 KV 请求）

### 分享系统

| 功能 | 说明 |
|------|------|
| 创建分享 | 选择文件 → 生成 12 位随机 ID |
| 密码保护 | 可选，SHA-256 哈希验证 |
| 有效期 | 1 小时 / 1 天 / 1 个月 / 永久 |
| 访问统计 | 自动记录浏览次数与下载次数 |
| 访客下载 | `/s/{shareId}` 页面，输入密码即可下载 |

### 管理后台

- **统计面板** — 总分享数、浏览数、下载数
- **用户管理** — 创建 / 删除 / 查看注册用户
- **分享管理** — 列表 / 删除分享链接，标记过期状态
- **全局设置** — 游客登录开关、全局上传大小上限
- **用户权限** — 单用户文件夹白名单、专属上传大小限制

---

## 技术架构

```
┌─────────────────────────────────────────────┐
│              Cloudflare Workers              │
│                                             │
│  ┌───────────┐  ┌───────────┐  ┌─────────┐ │
│  │  KV Store  │  │  R2 Bucket │  │  ENV    │ │
│  │           │  │           │  │         │ │
│  │ 用户数据   │  │ 文件存储   │  │ 密码    │ │
│  │ 收藏夹     │  │ 文件内容   │  │         │ │
│  │ 分享信息   │  │           │  │         │ │
│  │ 全局设置   │  │           │  │         │ │
│  │ 用户权限   │  │           │  │         │ │
│  └───────────┘  └───────────┘  └─────────┘ │
│                                             │
│            worker.js (4430 行)               │
│  ┌─────────────────────────────────────────┐│
│  │  后端 API  │  前端 HTML/CSS/JS          ││
│  │  JWT 认证   │  登录页                    ││
│  │  文件 CRUD  │  文件浏览器                ││
│  │  分享逻辑   │  管理后台                  ││
│  │  管理接口   │  分享页                    ││
│  └─────────────────────────────────────────┘│
└─────────────────────────────────────────────┘
```

### 前端设计

- Apple/iOS 风格：毛玻璃 header、圆角卡片、柔和阴影
- CSS 变量驱动亮色 / 暗色主题一键切换
- 完善移动端适配（768px / 480px 断点）
- 右键菜单、拖拽上传、键盘快捷键

---

## API 路由一览

### 认证

| 路由 | 方法 | 说明 |
|------|------|------|
| `/api/login` | POST | 登录（管理员/用户/游客） |
| `/api/logout` | POST | 登出 |
| `/api/auth/check` | GET | 检查认证状态 |

### 文件操作

| 路由 | 方法 | 说明 |
|------|------|------|
| `/api/files/{path}` | GET | 列出目录 / 下载文件 |
| `/api/upload/{path}` | POST | 上传文件 |
| `/api/delete/{path}` | DELETE | 删除文件/文件夹 |
| `/api/rename/{path}` | POST | 重命名 |
| `/api/create-folder` | POST | 创建文件夹 |
| `/api/create-file` | POST | 创建文本文件 |
| `/api/edit/{path}` | GET/PUT | 编辑文本文件 |
| `/api/search` | GET | 搜索文件 |

### 收藏夹

| 路由 | 方法 | 说明 |
|------|------|------|
| `/api/favorites` | GET | 获取收藏列表 |
| `/api/favorites` | POST | 添加收藏 |
| `/api/favorites` | DELETE | 移除收藏 |

### 分享

| 路由 | 方法 | 说明 |
|------|------|------|
| `/api/share` | POST | 创建分享 |
| `/api/share/{id}` | GET | 获取分享信息 |
| `/api/share/{id}/download` | POST | 分享下载 |

### 管理后台

| 路由 | 方法 | 说明 |
|------|------|------|
| `/api/admin/stats` | GET | 统计数据 |
| `/api/admin/settings` | GET/PUT | 全局设置 |
| `/api/admin/users` | GET/POST | 用户列表/创建 |
| `/api/admin/users/{email}` | DELETE | 删除用户 |
| `/api/admin/users/{email}/settings` | GET/PUT | 用户权限 |
| `/api/admin/shares` | GET | 分享列表 |
| `/api/admin/shares/{id}` | DELETE | 删除分享 |

### 页面

| 路由 | 说明 |
|------|------|
| `/` | 文件浏览器（需登录） |
| `/login` | 登录页 |
| `/admin` | 管理后台（需管理员） |
| `/s/{id}` | 分享页（公开） |

---

## 支持的 MIME 类型

文件上传和下载时自动识别以下格式：

| 类别 | 扩展名 |
|------|--------|
| 网页 | html, css, js, json |
| 图片 | png, jpg, jpeg, gif, svg, webp, ico |
| 文档 | pdf, doc, docx, xls, xlsx, ppt, pptx |
| 音视频 | mp3, mp4, webm |
| 文本 | txt, md |
| 压缩 | zip |
| 其他 | 默认 `application/octet-stream` |

---

## 许可

本项目为个人私有云盘，请按需使用。
