# SiYuan × EasyRead

在思源笔记中导入、关联和整理 EasyRead 阅读内容。要求 **思源 3.8.9+**。

## 功能

- **PDF 导入**：右键文档中的 `assets/*.pdf` 附件链接，或包含 PDF 链接的块图标，选择「上传 PDF 到 EasyRead」。支持 PDF 文件名与 `#page=` 链接，最多 50 MiB。
- **文档导入**：右键文档树中的单篇文档，或编辑器标题图标 → EasyRead → 导入文档。内核导出 Markdown，经思源 Lute 转为 HTML 后提交，不需要把私有文档发布到公网。
- **文章绑定**：搜索 EasyRead 标题/作者或直接填写文章 ID，将一篇思源文档关联到一篇文章。导入时可选择完成后绑定；不会覆盖已有绑定。
- **选择性同步**：分别选择整篇/段落笔记与问题、划线摘录与颜色、双语正文；先预览 Markdown，再确认同步。每条内容带回到 EasyRead 原句的链接。
- **安全快照**：同步方向为 **EasyRead → 思源**。内容未变时不重复创建，内容改变时新增子文档快照。原文、历史快照和你对快照的编辑都不会被覆盖；不自动删除旧快照、不回写 EasyRead。
- 顶栏 EasyRead 图标提供当前文档操作、导入任务和连接设置。任务持久保存；`done` 只表示曾经入库，**不表示翻译完成或文章仍存在**。每条历史提供「移除记录」，离线或旧服务不可达时也能清理。

## 安装与配置

1. 构建或取得 `package.zip`，解压到思源工作空间的 `data/plugins/siyuan-easyread/`，确保 `plugin.json`、`index.js`、`kernel.js` 位于该目录第一层。安装/替换文件时关闭插件，完成后在集市 → 已下载中启用。不要把源码仓库直接当作可运行安装包。
2. 在思源确认插件信任并启用插件；如果内核未运行，前端会提示，**不会降级为前端直连**。
3. 在 EasyRead 启用开放 API，并重启 EasyRead。最简单的方式为 `EASYREAD_OPEN_API=1`，或合并 `{"open_api":{"enabled":true}}` 到其配置。参见 [EasyRead 开放接口说明](https://github.com/Jasaxion/easyread/blob/main/docs/open-api.md)。
4. 在插件的「连接设置」填入 EasyRead 服务基址，例如 `http://127.0.0.1:8765`。也支持反向代理路径和粘贴 `/api/v1` 基址。
5. 若 EasyRead 开启访问保护，填写**现有访问授权码**，不是思源 API Token。点击保存，再测试已保存连接。

**地址从思源内核所在机器访问。** 如果内核运行在 jd-mac，`127.0.0.1` 就是 jd-mac，而不是正在浏览思源的电脑。跨机器时使用内核和阅读客户端均可访问的 EasyRead 地址，并配置 EasyRead 的监听地址、Host 白名单；推荐 HTTPS。

文档导入需要配套 [Jasaxion/easyread](https://github.com/Jasaxion/easyread) 分支新增的 `POST /api/v1/imports/html`。连接测试会显示服务是否在 `/info.capabilities` 声明 `import_html`。仅有旧版开放 API 的服务仍能用 PDF 导入、绑定和同步。

### 导入与保留范围

- 默认**只导入，不启动翻译**。明确勾选「请求翻译」才可能调用收费模型。
- 文档导入仅导出选中文档，不递归导入子文档。普通 Markdown、标题、列表、表格、代码和公式按思源导出能力处理；这不是 `.sy` 数据的无损迁移。
- 本地 PNG/JPEG/GIF/WebP 图片经内核读取并内嵌，总图片预算 5 MiB，最终 HTML 最多 8 MiB。远程图片、SVG、不可读或超限图片被省略并提示；不会代你抓取外部资源。
- EasyRead 服务会进一步移除脚本、CSS、表单、iframe、SVG 和远程媒体。数据库、挂件、嵌入查询及自定义块不保证还原；需要精确版式时请导出 PDF 后导入。
- 完全相同的 HTML、标题、来源 ID 重复导入会去重；源文档改变则新建 EasyRead 文章快照，不覆盖旧文章批注。已有绑定不会自动切到新快照，需要手动更换。
- 双语同步使用 `view=effective`，包含 EasyRead 中已保存的译文修订。`en`/`zh` 表示源语言/目标语言，不限定英文和中文。未完成译文的段落保留现有原文，空结构化正文会拒绝同步。
- 正文图像本身不下载到思源，保留图注、图中文字和原文位置链接。笔记中的相对图片路径、手写画布、贴纸及 AI 对话记录目前不属于完整资源同步范围。
- 当前 UI 主要为中文；已验证桌面浏览器前端及 macOS 内核。其他平台使用同一内核 API，但尚未进行真机验收。

## 在 EasyRead 删除文章后

- **不联动删除思源内容**：源文档、已经同步的快照和现有绑定都保留，插件不会自动解绑或重新导入文章。继续同步时会明确提示文章不存在；你可以在绑定面板手动「解除绑定」或选择另一篇文章。
- **导入记录是历史，不是文献列表**：EasyRead 的文章删除与任务记录独立；刷新任务会检查文章是否还在当前文献库。远端任务本身不存在时也会单独提示，不会混同为 API 未开启。
- 点击任务右侧 **「移除记录」** 并确认，只移除插件私有 `tasks.json` 中对应服务的这条历史，不删除/解绑任何文档，不删除 EasyRead 的任务记录，也不取消仍在运行的导入或翻译。移除后不再跟踪该任务或执行其尚未完成的自动绑定；已有绑定保持不变。
- 网络中断、授权失败、API 被关闭时不会擅自判定文章已删除。移除记录不依赖 EasyRead 在线。

## 数据与恢复

- `settings.json`：服务地址与授权码，存储于思源 `data/storage/petal/siyuan-easyread/`。只由内核读取，前端只收到「是否已配置」。这是私有插件存储，**不是加密保险箱，可能随思源工作空间同步**；不要提交到 Git。
- `tasks.json`：任务 ID、服务地址、状态与可选绑定目标。保留活动/未知任务及近期完成记录，不存正文或凭据。
- 文档 `custom-easyread-binding` 属性：文章 ID、服务地址、选择项、最近快照和恢复记录。不含凭据。
- 子文档 `custom-easyread-source` / `custom-easyread-hash`：归属与内容指纹；正文末尾的快照标识用于响应丢失后的恢复，请保留。
- 更换服务地址会清除旧授权码，除非重新输入。绑定属于另一个服务时拒绝同步。
- 上传超时：先检查任务与 EasyRead 文献库，**不要盲目重新上传**。若服务已返回任务 ID、但本地任务记录保存失败，插件会显示并保留这个 ID。
- 同步结果未知：打开绑定面板，点击「确认上次同步结果」。确认失败时可检查指定快照 ID，再显式「放弃待确认记录」；此操作只清除记录，不删除潜在快照，再次同步可能产生另一份快照。
- 解除绑定不会删除任何文档或 EasyRead 数据。没有定时全库扫描、自动同步、远端写入重试或自动清理。

## 架构

```text
思源 index.js：菜单 / 设置 / 预览
          │  Plugin.kernel.rpc.call
          ▼
思源 kernel.js：参数校验 / 任务 / 文档读写 / 快照
          ├── siyuan.client.fetch → 思源内核 API
          └── /api/network/forwardProxy → EasyRead /api/v1
```

前端没有 `fetch`/XHR，也不读取 PDF 文件内容或发出 EasyRead API 请求。打开 EasyRead 阅读页只是用户触发的网页跳转，不属于 API 直连。所有工作空间文件读写通过思源内核接口，不使用 Node/Electron `fs`。

## 开发与验证

需要 Node.js 22+ 和 `zip` 命令：

```sh
npm ci
npm run package   # TypeScript、关键测试、构建和打包
```

产物为 `dist/` 和 `package.zip`，都不提交到 Git。仓库 CI 为提交生成安装包 artifact，不会自动发布集市版本。

- `npm test`：URL/路径校验、同步渲染、内核请求体、分页完整性、凭据隔离、部分失败与恢复记录。
- `tests/kernel-smoke.py`：真实思源 Goja/RPC/文件及文档 API + 本地模拟 EasyRead，验证内核加载、原始 PDF 字节、Markdown 导出、快照创建/去重/旧内容保留。**仅能用于脚本要求的隔离工作空间，不能指向个人笔记。**
- 已额外在 jd-mac 思源 3.8.9 隔离内核与真实 EasyRead 后端联调文档导入、PDF 导入、任务绑定与笔记/划线/双语同步；测试后端停用模型/预处理 worker，不测试收费翻译质量。

开发参考：[官方插件示例](https://github.com/siyuan-note/plugin-sample)、[Petal SDK](https://github.com/siyuan-note/petal)。使用原生 API，无前端框架和运行时 npm 依赖。

## English summary

A SiYuan 3.8.9+ kernel plugin for importing PDF attachments and private Markdown documents into EasyRead, binding articles, and pulling selected notes, highlights and bilingual text. Requests and document writes run in `kernel.js`; the UI only calls RPC. Document import requires the companion EasyRead branch with `import_html` support. Sync creates append-only child snapshots, deduplicates unchanged content and never overwrites the source or previous snapshots. Translation is opt-in. Build with `npm ci && npm run package`; install the contents of `package.zip` under `data/plugins/siyuan-easyread/`. Settings contain a private—but not encrypted—access code and may sync with the SiYuan workspace. Deleting an EasyRead article preserves SiYuan documents, snapshots and existing bindings. Version 0.1.1 adds per-task local history removal (also available offline) and distinct missing-article/task messages. Removing history never deletes remote data or cancels running work; it stops tracking and pending auto-binding only.
