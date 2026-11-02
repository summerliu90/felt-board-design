# Skill 与网站协作优化方案

## 当前状态

Skill负责策划、风格、素材设计与质量要求；图片由工具生成；网站负责原生图层编辑、素材管理、工程包和A3/A4排版。当前存在手工跨应用衔接，网站导入最近图片仅加入一个图层，不会拆层；生成方式下拉框不等于已经具备整套无人值守生产。

本轮已实现：8种风格库与完整单件提示词、风格锁定规范、可调用Lemon image的桥接脚本和无计费自检。未在本轮实现：网站直接发起Lemon任务、持久化异步队列、进度回传与自动同步。这些是优化建议，不当作已上线功能。

## 推荐职责

| 层 | 责任 |
|---|---|
| felt-board-design | 内容、布局、风格、素材语义拆分、准确文字、验收 |
| 单一任务服务 | 持久化任务、渠道配置、队列/重试、版本、素材回传 |
| Lemon image适配层 | 复用generate/edit入口及1→2→3渠道路由 |
| 无Logo编辑网站 | 选择主题/风格、展示进度与审核、原生编辑、导出打印 |

把AI与生图服务放在可替换的执行层，不把密钥放前端，也不把业务规则写死在单个模型里。

## 第一阶段：先减少手工搬文件

- 用一份项目manifest作为事实来源，保留project_id、board_id、asset_id、instance_id、cut_unit_id。
- 保存统一 style-lock、完整任务书、源文件、像素/DPI、审核状态和错误。复用已合格资产，不依赖“最近一张图片”或聊天上下文猜素材。
- 网页导入同一份描述和真实图片；命令与工程快照使用已验证schema，不能把完整Layer字段盲传到add/update命令。
- 图片生成入口可以换成Lemon，但完整规划、原生文字及A3方案不变。更换机器时显式重设Lemon路径与凭证，不假装共享包自带密钥。

## 第二阶段：网站直接发任务

建议增加“主题/对象/尺寸/风格→内容规划→确认→制作”入口。网站提交结构化任务，后端调用同一个Lemon适配器；当前网站另有API设置，后续应归一配置，避免两套模型/密钥和失败策略各自运行。

建议资产状态：planned → queued → generating → generated_needs_review → approved → imported；错误为 failed，可只重试失败项。任务、生成结果和恢复点写持久存储；关闭页面或聊天不应丢任务。此能力需后端实现，Skill文本本身不能提供后台常驻执行。

后端按project_id映射受控目录，不接受浏览器任意脚本或任意绝对路径；前端不接触密钥。保存provider、真实channel/model、尝试次数、源像素和错误类别。并发受限，不套多层重试。

## 第三阶段：保留用户编辑的局部更新

- 图层ID与asset_id建立稳定映射，重生成仅替换对应源素材；用户拖动的位置、文字修改、旋转和层级保持。
- 使用revision或目标签名：用户在生成期间修改目标时，提示冲突、预览差异或新建候选层，不盲目覆盖。
- 固定同一项目style-lock；局部换风格显式记录例外。风格改版只重做受影响素材，不恢复旧文案。
- 素材尺寸变化时标记相关A3页需要重排，不能沿用失效打印坐标。
- 从同一快照导出整板、素材、可编辑A3和PDF，保留编辑对象/裁切单元/纸页映射。

## 建议的最小交接字段

```json
{"schema_version":1,"project_id":"...","style_id":"paper_cut","source_revision":12,"asset":{"asset_id":"M01-CHAR01","kind":"character","request_file":"requests/M01-CHAR01.json","status":"generated_needs_review","source_file":"assets/M01-CHAR01/version.png","pixel_size":[1536,2048],"box_cm":[16,23],"sha256":"...","provider":"lemon_api","channel":1,"model":"实际返回值","visual_review_passed":false},"instances":[{"instance_id":"M01-CHAR01-01","asset_id":"M01-CHAR01","layer_id":"...","x_cm":5,"y_cm":20,"width_cm":16,"height_cm":23,"rotation":0}],"print":{"paper":"A3","scale":1,"pages_file":"print-plan.json"}}
```

这是一份后续服务接口建议，不是当前网站已支持的完整导入schema。当前可执行接口仍是桥接request与已验证的编辑器命令/工程包。

## 验收指标

不再手动寻找生成文件；失败能定位到素材；恢复任务不重复计费生成已成功项；局部重生成不覆盖用户排版；工程包能恢复；打印保持真实尺寸。技术字段通过后仍要看实际图，不能用脚本代替视觉验收。
