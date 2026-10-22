# Desktop Calendar

## Windows 安装

从 [Calendar 下载页](https://github.com/ybenzou/calendar/releases/latest) 下载 `Desktop-Calendar-0.2.22-x64-setup.exe`，双击安装后启动 **Desktop Calendar**，无需安装 Node.js 或 Python。安装包尚未代码签名。

每位用户使用自己的本地空白日历，不附带作者的日程、学校订阅或密钥。支持单屏与多屏，默认放在第二屏，没有第二屏则使用主屏。奶蛙页及 Agent 活跃度需要另行运行 Naiwa；普通日历可独立使用。系统托盘的日历图标可显示、隐藏或退出日历。

## 更新

0.2.22：月历与当天明细统一按实际开始时间排序；活动组使用当天子日程的时间，避免 17:00 会议因全天存储范围排在 10:00 课程之前。真正的全天日程仍排在最前。

0.2.21：屏幕颜色与角色眼神使用同一个关注目标。悬停／键盘聚焦优先，鼠标跨过屏幕间隙时保留目标 650ms；进入新屏幕会取消旧释放计时。释放后恢复自动巡视，点击桌边物件会主动交还关注权。移除独立的 hover 变色规则，避免自动与鼠标出现两处高亮。

0.2.20：奶蛙工作时位于桌后，休息时随原生过渡进度平滑移到桌下，固定画布不变。移除“全部 / Cursor / Codex”筛选与会话屏幕的客户端文字，始终显示全部会话，保留项目、状态、编号和跳转。

0.2.19：优化奶蛙悬停响应。动画帧只绘制画布，元数据实际变化时才更新 React 状态；悬停本地高亮立即反馈，视线请求按浏览器帧合并、量化并去重。配合 Naiwa 0.9.9，不再因鼠标经过屏幕而同步全部会话和隐藏控件。E2E 同时记录浏览器绘制帧率、指针事件延迟和长任务。

0.2.18：修复奶蛙切换时的闪烁。工作、躺下和起身共用固定画布与位置，原生端围绕脚下位置平滑适配休息姿势；复用图片解码器，使用一次画布覆盖绘制透明与不透明像素。配合 Naiwa 0.9.8，左右注视与动作结束衔接均平滑处理，工作数量变化不重启动作。

0.2.17：工作场景加入可互动的台灯、植物和笔记。复用 Naiwa 0.9.7 的行为编排与视线目标，在操作、观察、阅读和记录之间以不固定时长换动作；桌边物件只影响动画，不跳转客户端、不修改会话状态。保留原画、固定屏位和原有日程，减少独立定时器，让同一个角色在桌面与日历使用一致行为。

0.2.16：配合 Naiwa 0.9.6 按同时工作的 Agent 数自动切换休息、专注、并行和忙碌动作。进行中计数使用奶蛙提供的真实工作数量，不包含等待、断线和结束会话；筛选和悬停不改变整体工作状态。多屏巡视频率随工作量变化，原有屏位、日程和 SQLite 记录保留。

0.2.15：奶蛙与两侧会话屏幕组成一个场景，跟随运行会话改变朝向、视线和工作动作；悬停看屏幕，点击跳转窗口。奶蛙画布按实际显示尺寸和屏幕 DPI 输出，配合 Naiwa 0.9.4 统一各姿态的像素边缘处理，减少重复缩放带来的模糊与阶梯边缘。

0.2.13：右侧支持“日程 / 奶蛙”切换，选择持久化到 SQLite。奶蛙页使用 Naiwa 0.9.4 的本地实时动画与会话，使用固定屏位的多屏工作台，支持屏幕跳转、客户端筛选和最近动作详情；完成会话保持可见，元数据保存到 Naiwa 的 sessions.sqlite。切回日程或关闭日历自动恢复桌宠；点击日期自动打开当天详情。动画通过当前用户权限的本地命名管道传递，不启动额外采集器，也不捕获桌面。

本机版本 0.2.13：Today 使用炭灰色日期数字、TODAY 字样、同色下划线及 2px 四周边框，保留原有日期字体和字号；Agent 每日明细使用紧凑的项目时长横条和图标指标。活动组在月历与当天列表直接显示当地起止时间，完整时间线显示整组实际起止时间。右上角小色块表示 Agent 活跃程度，其他日期的细边框表示选中日期。

本机桌面已有联合启动入口 `Naiwa-Calendar.exe`，双击同时启动日历与奶蛙。它直接使用本项目的 `out/` 构建产物和原来的 `%USERPROFILE%\.desktop-calendar\dev` SQLite 数据；不需要运行开发服务器。更新代码后运行 `pnpm build` 即可供下次启动使用。启动器源码与重新生成方法见相邻项目 `../naiwa/scripts/build_desktop_launcher.ps1` 和 `../naiwa/README.md`。

本地优先、可编程的 Windows 桌面日历。独立项目根目录为 `D:\Yuanben\FE\calendar`，不依赖 FE 根目录的 Next.js 应用。

## 开发与验证

要求 Node.js 20.19+、pnpm 10、Visual Studio 2022 Build Tools 的 C++ 桌面组件。安装版自带运行环境，不要求另装 Node.js。

```powershell
cd D:\Yuanben\FE\calendar
pnpm install
pnpm native:build
pnpm dev
```

```powershell
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm test:e2e
pnpm dist:win
pnpm test:package
```

单元测试使用 Electron 自带 Node 运行，以匹配 SQLite 原生模块的 ABI。E2E 在独立临时数据目录和普通窗口中运行，不改变个人日程。

## CLI

桌面顶部也提供统一命令栏：中文安排先生成AI预览；可直接输入 `calendar list --date 2026-10-14` 或 `settings set {"theme":"warm"}`。`/外观`、`/订阅`、`/备份`、`/AI设置` 打开隐藏功能，`/刷新` 更新学校订阅，`/新建` 打开表单，`/状态` 查看诊断信息。

开发模式先 `pnpm build`，再使用 `pnpm cli <命令>`。纯 JSON 自动化请直接调用 `node out/cli/index.cjs`，避免 pnpm 自身输出混入 JSON。

安装包位于 `release/`。安装器提供用户 PATH 选项，安装后重新打开终端即可直接使用 `calendar`；不加入 PATH 时调用安装目录的 `calendar.exe`。

```powershell
calendar run
calendar add --title "论文讨论" --start "2026-10-14T15:00:00+08:00" --end "2026-10-14T16:00:00+08:00" --timezone "Asia/Hong_Kong" --request-id "discussion-20261014" --json
calendar list --date "2026-10-14" --json
calendar update --id "事件ID" --title "新的标题" --expected-version 1
calendar move --id "事件ID" --date "2026-10-15" --expected-version 2
calendar delete --id "事件ID" --expected-version 3
calendar undo --operation-id "操作ID"
```

运行生命周期：`run/quit/status`。事件：`add/list/get/update/delete/move/undo`。视图：`view --date/--month/--today`。窗口：`window --action show|hide|close|attach|detach|diagnostic|bounds|editor|status`；bounds 接受 `--x/--y/--width/--height`，editor 接受 `--id/--date`。

设置：`settings get/set`；本地日历：`calendars list/add/update/delete`；备份：`backup create/list/restore`；AI：`ai key/preview/apply/cancel`。完整参数见 `calendar --help` 和各子命令 `--help`。

每个命令支持 `--input 文件.json` 或 `--input -`，输入是该命令的参数对象。显式命令参数覆盖 JSON 同名字段。`--json` 成功输出 `{ok:true,data:...}`，失败输出 `{ok:false,error:{code,message}}` 到 stderr 并返回非零退出码。

```powershell
'{"theme":"memphis","opacity":0.9,"fontSize":15}' | calendar settings set --input - --json
'{"x":350,"y":80,"width":1100,"height":720}' | calendar window --action bounds --input -
'{"title":"出差","start":"2026-10-20","end":"2026-10-23","allDay":true}' | calendar add --input -
'{"autoStart":true}' | calendar settings set --input -
```

写操作支持 `--dry-run`，不会写入日程；AI preview 自身即预览，不再接收 dry-run。数据写操作默认生成请求 ID，脚本跨调用重试应显式传递相同 `--request-id`。相同请求 ID 的参数发生变化会被拒绝。`--expected-version` 防止覆盖后续修改。

非空日历删除必须加 `--include-events`；默认日历不可删除。恢复必须使用 `backup restore --id "备份ID.sqlite" --confirm`，会先创建安全备份。全天事件结束日期不包含该日。

`window close` 关闭界面但保留服务；`quit` 关闭全部进程。数据命令可以自动启动无界面服务；UI 专属命令在 UI 未运行时返回 `UI_NOT_RUNNING`。

## 顶部命令栏批量添加

直接粘贴一条`batch add`命令，不需要PowerShell或AI。下面为合成示例：

```text
batch add {"title":"活动安排","key":"example-group-202610","timezone":"Asia/Hong_Kong","events":[{"title":"准备","start":"2026-10-13T16:00:00+08:00","end":"2026-10-13T18:00:00+08:00"},{"title":"开始提醒","start":"2026-10-14T09:10:00+08:00"}]}
```

月历每个相关日期只显示一张活动组卡片，点击后右侧按日期、时间展示子项，可折叠日期、编辑或删除子项。省略end的定时子项是时间点；全天子项必须提供不包含结束日的end日期。key避免同一条命令重复粘贴造成重复活动组；内容改变需更换key，或编辑现有活动组。

CLI对应`calendar batch add --input 文件.json`，代码接口为`batch.add`。`update/delete/move --id 活动组ID --item-id 子项ID --expected-version 父版本`操作子项；`move --id 活动组ID --date 日期`整体改期；`undo --operation-id`整组撤销。`view --group-id 活动组ID`打开右侧时间线。

## 代码调用

构建后可在 Node.js 中使用轻量客户端。它不直接访问 SQLite，也不要求加载 SQLite 原生模块。

```javascript
const { createCalendarClient } = require('./out/sdk/index.cjs')
const client = createCalendarClient() // 正式版脚本应传入正式版数据目录
const result = await client.execute({
  command: 'add',
  args: { title: '讨论', start: '2026-10-14T15:00:00+08:00', end: '2026-10-14T16:00:00+08:00' },
  requestId: 'discussion-from-code'
})
```

客户端要求服务已运行，可先执行任意数据 CLI 命令。业务命令采用 CLI 名称；分组命令用 `settings.set`、`backup.create` 等点号形式。

## 数据与安全

- 开发数据：`%USERPROFILE%\.desktop-calendar\dev`；安装版：`%USERPROFILE%\.desktop-calendar\main`。固定目录避免 Windows 应用隔离导致重启后读取另一份空库；旧 AppData 和 Codex 隔离目录中的数据库会在首次启动时迁移，原文件保留。测试可用 `CALENDAR_DATA_DIR` 指定独立目录。
- SQLite 开启 WAL 与 FULL 同步；服务是唯一数据库访问入口。本地 named pipe 限制当前用户，并拒绝网络登录身份。
- 用户目录内保存 `calendar.sqlite`、`backups/`、`logs/` 和加密 AI 凭据。每天自动备份，保留最近 14 份；日志保留 7 天，不记录事件正文和凭据。
- 运行时图标和界面资源全部在本机。Google／Outlook 尚未授权或同步，仅保留连接接口与映射表。

## AI 配置

首个适配支持 OpenAI-compatible Chat Completions JSON mode，端点必须 HTTPS（本机服务可 HTTP）。模型与地址可配置，默认模型为 `gpt-4.1-mini`，账号是否支持需实际验证。

```powershell
calendar settings set --ai-base-url "https://api.openai.com/v1" --ai-model "gpt-4.1-mini"
# 凭据通过 stdin 提交，不放进命令参数；从你的凭据管理流程取得 JSON 对象 {"key":"..."}。
calendar ai key --input -
calendar ai preview --text "下周三下午三点安排一小时论文讨论" --json
calendar ai apply --id "预览ID" --json
calendar ai cancel --id "预览ID" --json
```

AI 会发送前 30 天至后 90 天范围内至多 300 条日程（含备注）到你配置的服务。预览显示命令、明确时间和冲突；确认前不写入事件。预览一小时过期，重复 apply 返回原结果。取消后无法 apply。仅使用模拟模型完成自动验证，真实 API 需要用户凭据。

接口依据：[OpenAI structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=chat)。模型返回仍通过本地 Zod 和业务校验，不直接执行 SQL。

## 桌面验证与当前边界

默认铺满第二屏的可用区域，保留任务栏。外观设置可选择屏幕与填充方式；命令可设置 `preferredDisplay`、稳定 `displayId`、`fillDisplay`。默认时区为 `Asia/Hong_Kong`，界面显示HKT。

## Agent 活跃度

月历日期格子始终叠加 Agent 热图，无需切换模式。颜色默认按累计工作时长分档：少于 15 分钟、15–59 分钟、1–4 小时、4 小时及以上。点击日期在右侧查看工作时长、工具调用、开始/完成任务，以及项目和客户端分布，原有日程照常显示。

从奶蛙的 `%USERPROFILE%/.agent-pet` 元数据事件中自动采集 Cursor、Codex App、VS Code Codex 和 SSH 来源；`NAIWA_HOME` 或 `CALENDAR_AGENT_DATA_DIR` 可以指定来源目录。日历每五秒采集一次，在自己的数据目录中保存 `agent-activity.sqlite`，只保存事件计数所需的时间、客户端和项目标签，不读取聊天记录、提示词、代码或工具参数。

工作时长按任务运行区间计算，扣除已记录的等待确认，并行会话分别累计；窗口关闭和断连会结束区间，三分钟无新事件的未完成任务暂停实时累计，明确完成后确认完整区间。工作区间、会话状态和工具/任务计数都保存在 SQLite 中。旧事件日志仅保留近期片段，首次接入前的历史不能完整补回；导入片段和采集中断会标为“部分记录”，没有记录的历史日期显示“无采集数据”。Token 尚无真实用量来源，不显示估算数字。

```powershell
calendar activity list --from 2026-10-01 --to 2026-11-01 --json
```

## 学校 ICS 订阅

在“学校日历导入”中粘贴学校 Subscription URL，或使用 CLI。首次请求后保存在本地 SQLite；启动、恢复窗口和后台不会持续请求，仅手动更新时再次获取。学校页面需先启用 Internet Calendar 并保存。

```powershell
# JSON输入包含name、url、timezone；URL含令牌时从安全输入提交，不存入脚本或命令历史。
calendar subscriptions add --input - --json
calendar subscriptions list --json
calendar subscriptions refresh --json
calendar subscriptions update --id "订阅ID" --input - --json
calendar subscriptions remove --id "订阅ID" --confirm
'{"preferredDisplay":2,"fillDisplay":true,"timezone":"Asia/Hong_Kong"}' | calendar settings set --input -
```

这是一次导入，后续仅手动更新；支持重复课表与排除日期，更新失败保留已导入的数据。学校事件只读，本地个人日程照常编辑。URL 用 Windows 加密保护，list 与日志不显示令牌；HTTP 401 显示权限或启用问题。ICS 无需先经过 Outlook 才能读取。

采用 Explorer 图标宿主中的独立有界区域，保留区域外的图标操作。日历区域不要覆盖图标；它不是管理桌面图标的 Fences 替代品。挂接失败会进入诊断窗口并明确提示。

本机已验证挂接句柄成功；完整 Win+D、锁屏、睡眠、显示器切换、Explorer 重启和 Windows 10 检查仍需按 `tests/WINDOWS-CHECKLIST.md` 验收。安装包尚未代码签名。长期试用、真实联网 AI 和外部同步不能视为完成。

计划、进展、架构分别维护在 `docs/PLAN.md`、`docs/PROGRESS.md`、`docs/ARCHITECTURE.md`；发布变更维护在 `CHANGELOG.md`。

## 行程地图与路线

右侧列表内嵌本机打包的Leaflet地图，点击安排/地图标记同步选择。没有地点的日程不会显示空地图。地点在编辑窗口的“地点与地图”中点选或填写坐标。步行/骑行/驾车路线在同一编辑折叠区计算，再随日程保存；主列表不增加地图工具栏。地图数据不自动推断备注中的地址。

所有接口仍可编程：`add`、`batch add`的事件以及`update`参数接受`location`和`route`。地点格式为`{"name":"地点名","latitude":22.28,"longitude":114.13}`。组内修改使用父ID、itemId和父expectedVersion。修改地点而未显式提供新路线，会清除旧路线。

```text
maps route {"mode":"foot","waypoints":[{"name":"起点","latitude":22.28,"longitude":114.13},{"name":"终点","latitude":22.281,"longitude":114.131}]}
```

此命令只返回路线，不修改日程。将返回的route对象通过update保存，或在编辑窗口计算后保存。支持foot/bike/car道路规划；tram/metro/bus/ferry/cable通过手动route记录，不能用汽车路网冒充轨道或轮渡。route包含mode、waypoints、可选geometry（[纬度,经度]数组）、distanceMeters、durationSeconds、source（osrm或manual）。没有geometry时地图只画虚线示意，悬停注明不是道路路线。耗时不包含排队、候车和爬山休息，不是实时交通预测。

底图由OSM按需提供，原生服务标识User-Agent、缓存至少7天，不预下载地图；缓存与路线放在用户数据maps目录，日程中的地点/路线进入SQLite和备份。未缓存底图断网时可能为空，但保存的标记、折线仍显示。路线通过FOSSGIS的foot/bike/car独立OSRM路网，单进程限流每秒最多一次并缓存。计算只发送坐标；不发送标题和备注。不提供公共Nominatim地址搜索/自动补全。首次加载地图和计算新路线需要联网。

服务可通过`settings set`的mapTileUrl（HTTPS z/x/y模板）和mapRoutingUrl（HTTPS、支持routed-{mode}的OSRM服务）更换，不依赖重新打包。公共服务适用于当前单用户验证；扩大分发前应配置自己的提供方及对应署名。

参考：[OSM瓦片政策](https://operations.osmfoundation.org/policies/tiles/)、[FOSSGIS路线服务](https://routing.openstreetmap.de/about.html)。



