# 汇报助手 · 周/双周工作总结 PPT 自动生成

从项目要点素材生成可汇报的周报 / 双周报初稿，预览微调后导出标准 PPTX。

对应产品文档：周/双周工作总结固定结构（封面 → 目录 → 重要事项 → 问题建议 → 下周计划 → 结束页）。样例参考研发周报（20260911）的项目拆页与计划表，**不含**样例结束页上的 1ppt.com 广告水印，也**不含**年度甘特图（二期）。导出版式对齐该周总结结构（蓝金企业风，由代码绘制，不在运行时读取样例二进制）。可选参考文件见 `templates/README.md`（部署时可放入 `templates/week-summary-software-20260911.pptx`）。

## 本地运行

需要 Node.js 18+。在项目根目录操作（Windows 部署根目录为 `E:\grok_bot`）。只使用本目录的 `.env` 和 `node_modules`，不要改系统全局 npm / 环境变量。

```bat
cd /d E:\grok_bot
copy .env.example .env
```

编辑 `.env`，填写 MySQL 连接（库名使用 `grok_bot`）。本地附属文件目录：

```
DATA_DIR=data
```

即 `E:\grok_bot\data`（日志等）。草稿正文在远程 MySQL，不写本地 JSON/SQLite。

安装依赖并启动独立进程 `weekly-report-ppt`（默认端口 **5174**，可用 `PORT` 覆盖）：

```bat
npm install
npm run dev
```

浏览器打开终端提示的地址（默认 [http://localhost:5174](http://localhost:5174)）。开发服务同时提供前端和 `/api/reports`。

生产构建后的合并服务：

```bat
npm run build
npm start
```

或双击 / 注册服务时运行项目内的 `start.cmd`（先 `cd` 到本目录再 `node server\index.js`）。

环境变量（均写在项目 `.env`，不要 `setx`）：

| 变量 | 说明 |
|------|------|
| `HOST` | 监听地址，默认 `0.0.0.0`（本机/局域网） |
| `PORT` | 监听端口，默认 `5174` |
| `SERVICE_NAME` | 进程名，默认 `weekly-report-ppt` |
| `DATA_DIR` | 仅日志等附属文件，必须位于项目目录内，默认 `data` |
| `MYSQL_HOST` / `MYSQL_PORT` / `MYSQL_DATABASE` / `MYSQL_USER` / `MYSQL_PASSWORD` | 远程 MySQL。库使用 `grok_bot`；本应用只建/用 `wr_` 前缀表（`wr_reports`、`wr_yunxiao_items`） |
| `YUNXIAO_ORG_ID` | 云效企业 id（只读导入）。示例值仅用于文档：`62bcfcb73e81781f3ad1d7d7` |
| `YUNXIAO_PAT` | 云效个人访问令牌。请求头 `x-yunxiao-token`。**不要提交** |
| `YUNXIAO_API_BASE_URL` | 可选，默认 `https://openapi-rdc.aliyuncs.com` |
| `YUNXIAO_PROJECT_NAME` | 可选，默认 `DNK-设备软件` |
| `YUNXIAO_SPACE_ID` | 可选，项目 spaceId。默认 `6230f5b04297236a20e79654d4`（DNK-设备软件 / CFRK） |

浏览器 `localStorage` 只作缓存；刷新或同机其它浏览器访问同一服务时以 MySQL 为准。

运行测试：

```bat
npm test
```

含幻灯片页序、PPTX 结构、内存 CRUD、云效映射与（mock OpenAPI 的）导入 HTTP。若 `.env` 中 MySQL 可达，还会跑 `wr_reports` 集成测试。

### 云效只读导入

从云效 `POST /oapi/v1/projex/organizations/{orgId}/workitems:search` 按固定 `YUNXIAO_SPACE_ID` 拉取近 N 天或当前迭代的 **Task**（Bug 可选），写入 `wr_yunxiao_items` 缓存，再映射成周报草稿。不向云效回写。认证用 `x-yunxiao-token`（不要只靠 Bearer）。

1. 在项目 `.env` 填写 `YUNXIAO_ORG_ID`、`YUNXIAO_PAT`（可选 `YUNXIAO_SPACE_ID` / `YUNXIAO_API_BASE_URL`）。
2. `GET /api/yunxiao/workitems` 同步并返回缓存项（部署后应非空）。
3. `POST /api/yunxiao/import` 用选中的 id 创建周报。
4. `GET /api/reports/:id` 核对草稿。

```bat
curl -s "http://localhost:5174/api/yunxiao/workitems?updatedWithinDays=14"
curl -s -X POST http://localhost:5174/api/yunxiao/import -H "Content-Type: application/json" -d "{\"itemIds\":[\"<workitem-id>\"],\"reportPartial\":{\"department\":\"软件研发\",\"title\":\"周工作总结\"}}"
curl -s http://localhost:5174/api/reports/<id>
```

OpenAPI 基址默认 `https://openapi-rdc.aliyuncs.com`，请求头 `x-yunxiao-token: %YUNXIAO_PAT%`。若返回 HTML 登录页，接口会 502，而不是空列表。

### 手动核对草稿持久化

1. 新建周报，填写部门/日期并保存（下一步或预览里的「保存草稿」会立刻写入服务）。
2. 刷新页面，打开同一份草稿，内容仍在。
3. 首页列表按最近更新排列，可继续编辑；再次保存后覆盖。
4. 删除后，`GET /api/reports/:id` 返回 404。

```bat
curl -s -X POST http://localhost:5174/api/reports -H "Content-Type: application/json" -d "{\"title\":\"周工作总结\",\"department\":\"研发\",\"templateType\":\"weekly\"}"
curl -s http://localhost:5174/api/reports
curl -s http://localhost:5174/api/reports/<id>
curl -s -X PUT http://localhost:5174/api/reports/<id> -H "Content-Type: application/json" -d "{\"title\":\"已更新\",\"department\":\"研发\"}"
curl -s -o NUL -w "%%{http_code}" -X DELETE http://localhost:5174/api/reports/<id>
```

## 隔离与回滚

- 文件只出现在 `E:\grok_bot` 及其子目录（`data\`、`node_modules\`、`dist\`、`.env`）。`DATA_DIR` 若指向项目外会启动失败。
- 独立端口（默认 5174）与服务名 `weekly-report-ppt`，不占用其它项目的端口。
- 数据库：只连接 `.env` 指定的 `grok_bot`；迁移仅为 `CREATE TABLE IF NOT EXISTS wr_reports` 与 `wr_yunxiao_items`。不建库、不改其它表、不碰其它 schema。
- 依赖只安装到本项目 `node_modules`（`npm install`，不要 `-g`）。
- **回滚**：停掉本进程；需要时可删本项目目录；SQL 只执行 `server/rollback.sql`（`DROP TABLE IF EXISTS wr_yunxiao_items` / `wr_reports`）。不要 `DROP DATABASE grok_bot`。

## 使用路径（Happy path）

1. 首页点击 **新建周/双周总结**。
2. 填写部门、日期（可选汇报人），选择「周工作总结」或「双周工作总结」。
3. 在素材页可点 **载入样例数据**（对齐样例 PPT 的 7 个项目 + 下周计划），或自行按项目卡片填写。
4. 问题页可勾选「本期无（生成 N/A）」；下周计划可「从重要事项带入项目名」。
5. **生成预览**，在中间画布查看 16:9 页面；右侧可改标题与要点，可上移/下移/删除项目页。
6. **导出 PPTX**，用 PowerPoint 或 WPS 打开。导出字体指定为微软雅黑（`Microsoft YaHei`），在中文 Windows / WPS 下可正常显示。

「从文本一键拆分」是规则启发式（识别 `一、项目` / `①②③`），拆分后需确认。项目卡片仍是主录入方式。

## 技术栈

- Vite + React 19 + TypeScript
- 客户端 `pptxgenjs` 生成真实 `.pptx`
- 本机 Node 服务 `weekly-report-ppt`；草稿存远程 MySQL 表 `wr_reports`，云效缓存表 `wr_yunxiao_items`
- API：`GET/POST /api/reports`，`GET/PUT/DELETE /api/reports/:id`；只读云效 `GET /api/yunxiao/workitems`、`POST /api/yunxiao/import`

## 二期（本 MVP 明确不做）

- 年度计划时间轴 / 甘特总览页
- 飞书文档双向同步
- 团队模板、历史稿库、权限与协作批注
- PDF 导出、一键发飞书群、分享链接
- 解析上次 PPTX 文件导入（目前仅支持「从上次续写」本机草稿）
- AI 智能拆分项目（目前为规则 + 人工确认）
- 账号鉴权、多租户、多机同步、对象存储与自动备份

## 页映射

| 顺序 | 类型 |
|------|------|
| 1 | 封面 |
| 2 | 目录（重要事项 / 问题建议 / 下周计划） |
| 3 | Part 01 重要事项汇报 |
| 4…N | 一项目一页；要点超过 6 条自动续页并标「续」 |
| 随后 | Part 02 + 问题页（或 N/A） |
| 随后 | Part 03 + 下周计划表（序号 / 项目 / 工作内容） |
| 末页 | 感谢聆听（无广告） |
