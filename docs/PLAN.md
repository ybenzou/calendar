# Electron 桌面日历统一实施计划

## 目标与约束

项目独立位于 FE/calendar。Electron + TypeScript + React + CSS 主题，electron-vite 构建，SQLite/better-sqlite3，Commander/Zod，C++ Windows 桥接，Vitest/Playwright，pnpm/electron-builder/NSIS。

所有产品能力提供命令或业务接口。UI、CLI 和 AI 使用同一核心；独立用户数据目录和受限本地管道。先验证桌面壳，再扩展同步。首版以单次事件为主，不提供复杂重复规则或多设备协作。

## 八阶段与验收

| 阶段 | 工作 | 验收 |
|---|---|---|
| 1 布局与边界 | 第二屏月历＋选中日程列表＋独立编辑窗口；环境检测；主题体系 | 布局、功能与命令映射明确 |
| 2 桌面壳 | C++ 挂接、脱离、状态；run/status/window/view；诊断降级 | Windows 实机遮挡、Win+D、输入、图标与恢复检查通过 |
| 3 数据与 CLI | CRUD、时区、全天事件、版本、事务、幂等、撤销、迁移、备份 | 无界面断网读写；重启不丢失；备份恢复 |
| 4 本地日历 | 导航、表单、拖动、设置；统一命令与变更广播 | UI/CLI 双向一致，首个完整本地里程碑 |
| 5 AI | 可替换模型；中文查询与单条写操作；预览/apply/cancel；加密凭据 | 取消不写入；重复 apply 不重复；冲突与明确时间可查 |
| 6 连接层 | Provider 接口、外部映射；Google/Outlook 后续独立适配 | 新适配不改变 UI 与 AI 日程命令 |
| 7 日常运行 | 托盘、开机启动、位置、每天备份、7天日志、安装包 | 安装版断网运行、升级保留数据、至少7天试用 |
| 8 外部日历 | 根据真实需求选择提供商；只读导入→双向→重复与冲突 | 不重复、不丢事件、离线恢复后继续同步 |

## 可编程接口

生命周期 run/quit/status；事件 add/list/get/update/delete/move/undo；视图 view；窗口 window；设置 settings；日历 calendars；备份 backup；AI ai。

结构为 `{command,args,requestId?,dryRun?}`。结果为 `{ok:true,data}` 或 `{ok:false,error:{code,message}}`。UI 通过受控 preload，脚本通过 CLI 或构建后的 Node 客户端连接同一服务。删除非空日历和恢复备份均要求明确参数。

## 视觉方向与项目管理

用户后续确定：顶栏为日历标志、月份、日期切换与统一命令栏，取消Local First宣传字样和低频功能按钮。低频功能通过斜杠命令打开；自然语言先预览，明确代码命令直接执行统一接口。月历填满第二屏可用区域，重点提高文字可读性并避免纵向溢出。

默认采用瑞士网格排版、暖白底色与低饱和绿色；提供温暖现代、孟菲斯主题。主题仅控制视觉变量，不复制业务界面。

源码按 core/main/preload/renderer/cli/shared 集中组织，native/resources/tests/docs 各自归档。out、release、测试与运行数据不提交。每次有实际开发结果时更新 PROGRESS，架构调整更新 ARCHITECTURE，范围调整更新本计划，发布更新 CHANGELOG。

## 后续边界

活动组增补：顶部命令栏支持batch add一次提交最多100项相关事件，月历按活动组折叠为一条，点击右侧以可折叠日期时间线展开。整组写入/撤销原子化，支持子项编辑、删除和整体改期；只有开始时间时记录为时间点。相同key的相同批次重复提交不创建副本。用户要求只交付命令，不代执行其六个个人事件；所有批量测试使用隔离的合成数据。

2026-10-12 用户补充：移除个人姓名，增加日历几何Logo；默认铺满第二屏可用区域并保留任务栏；默认HKT（Asia/Hong_Kong）。学校通过ICS Subscription URL作为只读连接接入，提供 subscriptions list/add/update/refresh/remove 和对应界面，每30分钟刷新，成功缓存离线保留；URL由系统加密保存，不写入文档和日志。订阅重复事件可以展开显示，但本地重复规则编辑仍不属于首版。

完整实机验证失败时优先修正桥接，不将普通窗口算作成功。naiwa 重构不属于本项目首版；真实账号授权、重复规则、同步冲突、自动更新服务器和签名发布均为后续阶段。

用户新增：右侧活动树内嵌OSM地图，与地点/路线双向联动。主界面简洁，不增加地图工具栏、长说明或规划按钮；配置放入编辑窗口。个人行程命令只提供，不代执行。
