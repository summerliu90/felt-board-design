# 图片生成接入

完整业务规则仍由 felt-board-design 维护，Lemon 仅执行单件图片生成和参考图编辑。本仓库不分发独立的 lemon-card-cut，也不带任何账号、额度或 API 密钥。

## 依赖

- Python 3 与 Pillow（建议在虚拟环境内安装）。
- Node.js，`node` 位于 PATH，或指定 `FELT_BOARD_NODE`。
- 自己合法取得并配置的 Lemon 安装，其中包含 `02-images/api/generate.js`、`edit.js`、`shared.js` 及其正常运行所需文件。

Lemon 默认查找 `~/.cursor/skills/lemon-card-cut`，也可以设置：

```bash
export FELT_BOARD_LEMON_ROOT="/path/to/lemon-card-cut"
# 如 Node 不在 PATH，另设 FELT_BOARD_NODE=/path/to/node
python3 skills/felt-board-design/scripts/generate_asset.py preflight
```

preflight 只检查本地文件与配置存在性，不发送远程图片请求，不证明服务在线或额度可用。凭证只放在 Lemon 自己的私有配置中，不能提交到 Git 或前端代码。

## 单件任务

参考 `skills/felt-board-design/examples/image-request.json` 准备一个素材任务。按风格锁定规则保存准确主题与主体描述。正式生成前先 dry-run：

```bash
mkdir -p projects/demo/requests
cp skills/felt-board-design/examples/image-request.json projects/demo/requests/M01-CHAR01.json
python3 skills/felt-board-design/scripts/generate_asset.py generate \
  --request projects/demo/requests/M01-CHAR01.json --project-dir projects/demo --dry-run
```

确认需求和付费生成范围后，去掉 `--dry-run` 执行。输出保存为版本化素材、提示词与 `.asset.json`。相同输入哈希命中成功文件时复用，`--force` 明确生成新版本。当前参考图编辑入口接受一张 reference，不能静默丢掉多张参考。

生成成功仍需人工看图，检查透明边缘、人物完整度、风格和实际打印清晰度；桥接不会把 API 成功直接标为视觉通过。

## 内置图片生成

没有 Lemon 时，可以在 Codex 中明确要求使用可用的内置 imagegen。桥接不会在 Lemon 失败时悄悄切换渠道。网站编辑与打印不依赖图片 API；可以导入自己已有的独立透明 PNG。

## 网页状态

Lemon 桥接目前由 Codex / CLI 调用，未连接网页一键任务队列。后端 Studio 的独立配置入口也不等于已经实现这条黑板报完整流程。后续方案见 Skill 的 `references/website-integration.md`。
