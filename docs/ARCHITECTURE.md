# 架构与重要决策

## 进程和接口

Electron 服务持有 SQLite。Windows 管道按用户和数据目录哈希命名；启动时 C++ 模块将其 DACL 限制到当前用户并拒绝网络身份，服务完成限制后才处理请求，不监听 TCP 端口。

CLI 只做参数解析、启动服务和管道调用。安装版 C++ console launcher 设置 ELECTRON_RUN_AS_NODE，借用打包的 Electron 运行 CLI，保留 stdin/stdout/stderr 与退出码。启动后台服务时移除该环境变量。Commander 显式解析 argv，防止 Electron packaged 模式误识别脚本路径。

React→sandbox preload→Electron IPC→统一 execute；CLI/Node client→named pipe→统一 execute。数据变更向全部应用窗口广播刷新。UI 在未启动时不能执行 view/window；数据命令能启动无窗口服务；关闭 UI 保留服务，quit 退出全部。

## 数据模型

活动组使用一条events父记录，items内保存有独立UUID的子日程；父版本用于整组和子项的并发检查，整组作为单一操作快照保存/撤销。父日期范围由存活子项计算，月历及日期查询只在实际包含子项的日期显示。时间点保存相同start/end并明确pointInTime，不用虚构时长。普通事件仍要求end>start。

batch.add接受title、timezone、calendarId、notes、可选key和events数组（1至100项）。全量校验后事务写入；key保存规范参数签名，重复提交返回现有活动组，内容变化拒绝。子项使用update/delete/move的itemId参数，expectedVersion指父版本。view groupId控制右侧展开，也可通过CLI调用。AI批量提案仍需预览确认。

SQLite 的 events/calendars/settings 保存有版本的 JSON 实体；events 时间和删除字段有表达式索引。operations 保存前后快照以支持版本安全撤销；requests 保存幂等结果；ai_previews 保存确认状态。所有正常业务写操作通过事务执行。

事件本地 UUID 永不等同外部 ID。定时事件统一保存 UTC ISO 时间和 IANA 时区；全天保存日期，end exclusive。移动保留当地钟表时间和实际时长，夏令时缺失时刻拒绝自动迁移。外部映射表与 connector 接口独立于事件核心。

备份使用 VACUUM INTO 一致快照，恢复校验完整性和 schema 版本，并先建立安全备份。当前 schema=1；新版本迁移必须先备份，拒绝未来版本的数据库。

## Windows 桌面桥接

原生代码独立编译为 desktop-bridge.exe。找到含 SHELLDLL_DefView 的 Explorer 宿主，将月历作为其独立有界子窗口放在图标视图上方；被动壁纸层会被图标视图吞掉点击，不适合本项目。区域外图标保留，区域内不要摆放桌面图标。

Electron 原生窗口句柄通过字符串传递，避免64位精度损失。窗口操作必须异步执行：同步等待 helper 会导致 SetParent/SetWindowPos 与 Electron 窗口线程互相等待。桥接不成功时进入明确的普通窗口诊断模式。

周期检查挂接状态，resume 重挂，屏幕变化约束位置。Explorer 完全重启与混合 DPI 的窗口存活仍需实机确认，不能只凭 parent 句柄正确即宣称兼容。

## AI 与凭据

AIService 使用 JSON-mode Chat Completions adapter，目前允许 list/add/update/move/delete 单条提案。写提案通过业务 dry-run 验证，编辑绑定事件版本；apply 使用预览 ID 幂等，cancel 后不可提交，预览一小时过期。模型不能触达数据库。

safeStorage 使用 Windows 系统加密保存密钥，不保存明文；密钥只能通过受控命令写入，无读取 API。日志只记录错误码。模型上下文包含近期至多300条日程与备注，README 和界面均提示此数据流。

## 构建与交付

## 第二屏、品牌与学校订阅

主界面顶部只显示标志、月份、日期导航与统一命令栏。shared/commands集中定义CLI参数，浏览器使用同一命令表解析受限文本或JSON参数，不执行任意代码。中文输入先生成AI预览；低频设置通过/外观、/订阅、/备份和/AI设置打开独立输入窗口。

桌面挂接会继承Explorer系统DPI，不能反复使用Electron DIP setBounds。C++使用per-monitor-v2线程上下文获取物理workArea定位，status报告boundsPixels与targetPixels；本机实测第二屏1920×1032一致。命令栏点击时允许键盘焦点，输入结束恢复不抢焦点行为。

HKU每次导出重新生成UID，针对该来源使用标题/开始/结束/全天标记SHA-256指纹。其他来源仍使用UID/实例键。未改变的时段保持本地ID，地点/备注原位更新；标题或时段变化表现为旧实例删除、新实例增加。

界面、托盘与安装包使用同一日历几何标志；源SVG位于resources，构建脚本生成PNG和多尺寸ICO。产品名为Desktop Calendar，不含个人姓名。旧开发数据首次启动复制迁移到新的DesktopCalendar目录，不删除旧目录。

默认选择第二个显示器（主屏优先排序），也可保存稳定displayId；当前第二屏为DELL E2423H、1920×1080、100%缩放，主屏DELL P2421D为125%。默认窗口使用目标workArea，保留任务栏；show后重新约束一次以适应混合DPI。用户可通过settings或独立设置窗口更改显示器和填充方式。

subscriptions表保存加密URL和刷新状态，公开接口不返回URL。node-ical解析ICS并展开前一年至后两年的重复事件，支持EXDATE与RECURRENCE-ID；本地ID由核心生成，UID/实例时间仅作为外部映射键。导入事务按映射更新、软删除，保持稳定本地ID与只读标记。

每30分钟及启动后刷新，支持ETag/Last-Modified；网络/401/HTML登录页/解析错误保留成功缓存。最大10MB、展开最多一万条，单次网络超时20秒。地址限HTTPS或本机HTTP，webcal转换HTTPS；当前不支持需要登录Cookie的订阅。取消订阅需confirm参数，订阅事件不能通过UI/CLI/AI改写。设置、订阅、AI输入在独立普通窗口中进行，以获得键盘焦点。

所有依赖锁定版本。SQLite 原生依赖按 Electron ABI 重建，测试使用同一 Electron Node。开发/正式用户目录隔离；out/release 忽略。安装包自带运行环境，用户级可选 PATH；不删除用户数据，不包含外部账号授权和自动更新服务。

## 行程地理数据

事件JSON新增可空location与route字段，不变更本地ID或SQLite版本。统一Zod校验坐标范围、最多16路点及20000折线点，CRUD/幂等/版本/撤销/备份共享现有事务。Leaflet/CSS随renderer打包，外部脚本不可执行。Renderer CSP只新增calendar-map图片源；主进程注册calendar-map://tiles/z/x/y.png协议，验证范围、缓存与下载，renderer没有任意网络代理。外链仅允许OSM版权/纠错及FOSSGIS介绍三条精确URL。

MapService提供maps.route，返回经校验并转换GeoJSON经纬顺序的路线。默认foot/bike/car分别调用FOSSGIS相应路网。网络失败明确报错，绝不自动替换为直线。公交/轨道/轮渡手动数据由routeSchema持久化；未提供geometry时虚线只表示路点关系。地图双向选择仅修改renderer状态，无隐式数据库写入；路线规划结果须通过现有update保存。标题固定，地图直接嵌入右栏滚动列表。
