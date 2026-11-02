# 图片生成渠道：复用 Lemon image 能力

## 范围与选择

黑板报内容、五阶段、语义分层、真实厘米、网站编辑与打印继续由 felt-board-design 负责。Lemon 只替换图片生成/图片编辑执行层，不替换整个黑板报技能，不进入视频分镜、三种角色限制、表情、配音、字幕、80%黑遮罩、剪映或飞书收尾。

本工作流支持复用独立安装的 `lemon-card-cut` image 入口，默认 `image_provider=lemon_api`。用户明确指定内置生图时，改为 `builtin_imagegen` 并使用内置 imagegen 技能；不在 API 失败时静默切换。风格与生成渠道独立，换渠道不改 style_id，不因选 Lemon 就强制小黑/小柠檬角色。

- 新图：`<LEMON_ROOT>/02-images/api/generate.js`。
- 一张参考图编辑：`<LEMON_ROOT>/02-images/api/edit.js`。该入口目前只接受一张 reference；多参考不能悄悄丢弃，需要先制作/选择一张批准的综合风格参考或另行扩展入口。
- 公共路由：`shared.js`；读取 Lemon 自己的 `.env`，环境变量优先。不得复制或输出密钥，不修改 Lemon 文件。
- 本技能桥接：`scripts/generate_asset.py`，保存完整提示词、版本化源图、路由摘要、透明度及源DPI检查、后续审图状态。

## 无计费自检

```bash
python3 <本技能>/scripts/generate_asset.py preflight --lemon-root <LEMON_ROOT> --node <NODE_BIN>
```

只检查文件、Node、Python/Pillow与图像渠道配置；只输出配置是否存在，不输出密钥/地址，不请求远程API。不使用要求配音依赖的总自检来判断图片功能是否可用。配置通过不代表渠道在线、额度可用、模型参数兼容或画面已验收。

默认查找 `~/.cursor/skills/lemon-card-cut`。其他安装位置设置 `FELT_BOARD_LEMON_ROOT` 或传 `--lemon-root`；可设 `FELT_BOARD_NODE`。分发技能包不附带 Lemon 的 `.env`，也不依赖本机密钥能自动迁移。

## 先保存单件任务书

示例见 [image-request.json](../examples/image-request.json)。`asset_id` 稳定，`style_id` 取自风格库；`width_cm/height_cm` 为计划预留框，排版保持等比，不依赖模型绘制尺标。准确正文不进图片提示词。种类为 character、scene、blank_backing、decoration。

有参考时在任务书写 `reference`，路径相对于本项目根目录或绝对路径；执行前实际查看参考。可选 `mask`，必须配合 reference。只有需要模型具体像素尺寸时写 `size`，不能假定所有渠道都支持任意宽高。

```bash
# 只编译提示词、输出执行计划；不出图、不计费
python3 <本技能>/scripts/generate_asset.py generate \
  --request <项目>/requests/M01-CHAR01.json --project-dir <项目> --dry-run

# 在已授权的制作任务中实际生成
python3 <本技能>/scripts/generate_asset.py generate \
  --request <项目>/requests/M01-CHAR01.json --project-dir <项目>
```

改造技能或规划风格时不自动发送付费请求。完整制作任务已授权时，在约定范围内执行，不反复要求相同权限；生成前说明实际渠道会收到提示词，编辑还会收到参考图。

## 路由、重试与复用

1. 完全复用 Lemon 配置的渠道顺序1→2→3及每渠道模型绑定。每渠道一次、首个有效图片即停；编号模式不额外指定 `--model` 绕过绑定。
2. 默认每渠道180秒超时，由 Lemon 的 `OPENAI_IMAGE_TIMEOUT_MS` 控制。桥接不再加一层网络重试。失败保留 failed 状态，不能以提示词、占位框或内置生成图冒充成功。
3. 跨渠道超时不等于前一服务没有计费，不能保证切换不产生多次费用。不要无上限并发或重试；整套任务建议从1—2件并发开始，按服务限制调整。
4. 相同任务、风格、参考内容哈希存在成功产物时复用，不再次请求。需要重画用 `--force` 创建新版本，不覆盖已生成源文件。改变模型配置后如需重画，也应显式新版本，不把旧缓存宣称为新模型结果。
5. `.asset.json` 保存真实渠道、模型、源像素和文件哈希；不保存密钥。成功输出为 `generation_status=succeeded`、`qa_status=needs_visual_review`，不自动当作视觉通过。

## 独立素材验收

Lemon 的图片签名检查只证明返回了图片字节，不能证明透明、完整、高清或分层。

桥接会拒绝非PNG、没有alpha或明显不满足透明外部的结果，记录有效轮廓像素和计划厘米下的源DPI。低于门槛给出警示，不能标为正式打印通过。此检查只看文件与透明度，不证明手、脚、道具、中文或画风正确；Codex仍须逐件看图、在浅/深背景上检查轮廓，并与批准模块重组对比。

去透明留边不等于裁切整板区域；人物需要分开编辑时从任务书建立独立asset_id。正文和标题保持原生文字。API生成、API成功、网站导入成功都不能替代这一步。

## 生成后的交接

从单件 `.asset.json` 汇总到项目素材清单，使用相同asset_id关联：源文件→实例→编辑层→裁切单元→打印页。真实图片审核通过后再导入编辑器；缺图显式 unresolved，不静默改成色块。

当前桥接是 Codex/CLI 可执行入口，网站尚未自动调用这个桥接。网站一键排队、状态同步与局部重生成属于下一阶段工程，不因技能文件更新就宣称已上线。
