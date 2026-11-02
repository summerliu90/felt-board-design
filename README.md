# felt-board-design：黑板报设计与可编辑打印工作流

将主题策划、八种儿童风格、独立素材制作、浏览器图层编辑和 A3/A4 实际尺寸打印放在同一个仓库。

**这是可在本地运行的网站源码与 Codex Skill，不是已经部署的公共在线服务。** 当前通过 Codex 调用 Skill 组织设计，随后在网站中编辑与打印。网页尚未接通 Lemon 整套黑板报的一键生成与持久化任务队列。

## 包含什么

| 目录 | 内容 |
| --- | --- |
| `editor/` | 基于 DaVinci 修改的 Go 服务、React/TypeScript 网页、CLI、可选 Electron 桌面包装 |
| `skills/felt-board-design/` | 内容→布局→草稿→成品→独立素材与分层导入，含八种风格与 Lemon 图片桥接 |
| `skills/davinci/` | 让 Codex 调用编辑器 CLI 的操作技能 |
| `docs/` | 启动、使用、打印、图片渠道和功能边界说明 |

网站包含：原生文字与图形、多画板、图片图层、素材库、导入与换图、实际厘米尺寸、A3/A4 自动编排、允许旋转、手动调整、全选加入打印、批量移除与清空、超大素材拼接、实际尺寸 PDF、可编辑打印画板、工程包导入导出。网站页面已移除品牌 Logo；内部 CLI 名称和协议仍使用 `davinci`。

## 本地启动

需要 Go 1.26.1 或更高版本、Node.js 22.13 或更高版本，以及 pnpm 11（验证版本为 11.25.0）。制作素材还需要 Python 3 与 Pillow，使用 Lemon 生成图片则需独立的 Lemon image 入口和自己的渠道配置。

```bash
git clone https://github.com/summerliu90/felt-board-design.git
cd felt-board-design
./start.sh
```

首次运行安装前端依赖，构建网页、Node 渲染器及 Go 服务，再打开 `http://127.0.0.1:7789/`。端口占用时可能使用其他空闲端口，以终端输出为准。只构建：`./start.sh build`；开发：`./start.sh dev`。macOS 原生抠图工具为可选项，Swift/SDK 不兼容时会跳过；可设 `DAVINCI_SKIP_MACOS_CUTOUT=1` 跳过编译，或另外配置 rembg。

从源码运行的数据默认保存在 `editor/data/`，已从 Git 排除。现有桌面版的工程不会自动出现在新的源码服务中；请先从原服务导出可编辑工程包，再导入新服务，保留原数据备份。

## 安装两个 Codex Skill

先安装本分支 CLI：

```bash
./start.sh install
```

按输出将 Go 的 bin 目录加入 PATH，确认 `davinci --help` 可用。若已有其他版本的 `davinci`，用 `command -v davinci` 核对实际运行路径。

将以下两个目录复制到 Codex 的 skills 目录（默认 `~/.codex/skills/`）：

- `skills/felt-board-design`
- `skills/davinci`

已有同名 Skill 时先备份再更新，不要把旧配置直接覆盖掉。重新打开会话后使用。无需运行编辑器的 `skill` 命令；该命令只安装原有 davinci 操作技能。

```text
使用 felt-board-design，为小学一年级设计“安全伴我行”主题黑板报，
宽240厘米、高120厘米，彩纸剪贴风。
先做内容规划，确认后制作独立素材，导入本地网站，准备A3打印。
```

继续已有作品时附编辑页面链接，说明要修改的对象和范围。设计由 Skill 组织，日常拖动、改字和打印可直接在网站操作。

## 八种支持风格

毛毡拼贴、彩纸剪贴、温暖水粉绘本、蜡笔油画棒、清爽粉笔、简洁扁平科普、水彩自然观察、童趣国风剪纸。完整特点、适用主题和单件提示词见[风格库](skills/felt-board-design/references/style-catalog.md)。每个项目保存 style-lock，局部更新继承原风格。

## 生图配置与功能边界

本仓库包含 Lemon image **适配器**，不包含独立的 lemon-card-cut、它的凭证、配音或视频工作流。通过 `FELT_BOARD_LEMON_ROOT` 指向自己的 Lemon 安装；配置方式及无计费自检见[图片接入](docs/image-generation.md)。没有 Lemon 时仍可编辑、导入现有图片和打印；也可明确要求 Codex 使用其可用的内置图片生成能力。

整图切块不等于语义分层。原生文字可以改字，独立图片可以移动和替换，但单张故事插画内部不自动拆分。自动编排尝试提高纸张利用率，不保证全局最优，也不会提高低清源图的真实分辨率。

## 使用与开发文档

- [工作流、编辑与打印](docs/workflow.md)
- [Lemon 图片接入与迁移](docs/image-generation.md)
- [已实现功能与后续优化](docs/features.md)
- [上游 CLI 命令](editor/docs/COMMANDS.md) · [API](editor/docs/API.md) · [架构](editor/docs/ARCHITECTURE.md)
- [网站与 Skill 协作建议](skills/felt-board-design/references/website-integration.md)

## 验证

```bash
cd editor/web
pnpm install --frozen-lockfile
pnpm test
pnpm run build
cd ..
go test ./...
cd ..
python3 -m venv .venv
. .venv/bin/activate
python -m pip install Pillow
python -m unittest discover -s skills/felt-board-design/tests -v
```

桥接测试使用模拟图片渠道，不发送真实付费请求。构建先生成网页，再生成 Node 渲染器和 CanvasKit WASM，最后编译 Go；请保留这个顺序。

## 来源与感谢

编辑器基于 [ChrisZou/davinci](https://github.com/ChrisZou/davinci)，保留原项目 Apache-2.0 许可证、原始说明与来源。本仓库增加黑板报设计工作流、真实尺寸打印与自动编排、工程包交接、打印批量操作和网站无 Logo 界面。详见 [NOTICE](NOTICE)。

感谢 DaVinci 提供图层编辑、CLI/API 与工程基础，让主题设计能够继续编辑并落地为可裁剪的实体展示。上游安装包可能不包含本仓库的增强功能，请从本仓库构建。
