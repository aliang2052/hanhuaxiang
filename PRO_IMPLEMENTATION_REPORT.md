# ChatGPT Pro P0 修正版实施报告

- 代码基线：`aliang2052/hanhuaxiang`，提交 `ac76d30`
- 修正版版本：`2.2.0-p0-fix2`
- 实施日期：2026-08-01
- 参考输入：本对话最初上传的互动装置视频
- 旧正式包：SHA-256 `c457c5148d31aeb7cab30478ed6f30df50b5f41a02ef1b7579454b403a05a371`
- 旧包状态：**废弃，不应继续验收或部署**

## 1. 本轮针对 Codex 驳回项完成的修复

### 1.1 横屏视觉构图重做

旧 P0 包虽然已经全屏，但视觉仍像 21 个大空框的浅色展板，与参考视频中的密集画像石建筑墙差距明显。本轮重新建立了独立于 9×7 触发网格的视觉构图：

- 横屏 63 个密集、非均匀建筑画格；
- 5 个中央仪式舞台画格；
- 左右两条连续纹样边框；
- 上下连续云气、神兽和几何纹样带；
- 8 条主要横梁 / 栏杆层；
- 中央纵向建鼓、编钟、阶道和多层台基；
- 画格人物大小和组合形式不再统一；
- 中央建鼓双人组使用大尺寸核心视觉；
- 待机灰影和激活黑像都提高了密度和对比度；
- 竖屏继续保留独立适配。

新增可量化结构接口：

```js
window.__HAN_TEST_API__.getState().sceneStructure
```

返回并由单元 / E2E 断言：

```text
panelCount = 63
centralStagePresent = true
centralStagePanelCount = 5
leftBorderPresent = true
rightBorderPresent = true
horizontalBeamCount = 8
```

最终横屏截图：

```text
docs/screenshots/e2e-auto-1920x1200.png
docs/screenshots/e2e-all-awake.png
```

视觉仍不是参考作品逐像素复制；详见风险披露。

### 1.2 素材多样性扩展

旧包的 36 个运行时 PNG 实际只来自 8 个基础人物。修正版现在包含：

```text
8  张独立高分辨率人物源
24 个从项目自有完整壁画不同区域提取的人物 / 器物 / 群像源
32 个不同基础轮廓 / 场景源合计
60 个不同运行时 PNG
63 个视觉节点，其中只重复使用 3 个复杂群像
```

60 个运行时素材构成为：

```text
32 单体源
12 双人组合
8  三人组合
8  大型群像
```

24 个壁画派生源来自不同坐标区域，不是把原来的 8 张人物图做镜像、缩放后重新计数。它们共享同一张项目自有完整壁画作为上游来源，因此报告中没有把它们描述成 24 次独立 AI 绘制。

来源和派生关系分别记录在：

```text
assets/source-highres/mural-crops/manifest.json
assets/sprites/manifest.json
ASSET_NOTES.md
```

没有宣称“63 位独立绘制人物”。

### 1.3 实体摄像头持续断线重连

`CameraController` 已改成可取消、带上限退避但持续运行的重连循环：

- `NotReadableError`、`AbortError`、视频等待超时等临时错误继续重试；
- 退避时间达到上限后保持上限，不会只执行一次；
- `NotAllowedError`、`SecurityError`、`OverconstrainedError` 等永久错误停止自动重试；
- 成功恢复后连续失败计数归零；
- 单独记录总失败次数和成功恢复次数。

新增单元测试实际覆盖：

```text
初始成功
→ 视频轨道断线
→ 第一次重连 NotReadableError
→ 第二次重连 AbortError
→ 第三次重连成功
```

### 1.4 异步竞争与资源清理

摄像头请求现在具有 generation token 和取消语义：

- 快速 `hardware → simulated → hardware` 会启动第二条全新的硬件请求；
- 第一条旧请求即使迟到返回，也只能停止自身 tracks；
- 旧请求不能覆盖新来源的 `video.srcObject`；
- `getUserMedia()` 后等待视频超时会停止所有 tracks；
- `video.play()` 失败会停止所有 tracks；
- 手动停止、来源切换和恢复都会清理 stream、track 监听器和 `srcObject`；
- 同一 generation 的并行 `start()` 仍会合并成一次 `getUserMedia()`。

覆盖方式：

- Node 单元测试：generation race、超时清理、播放失败清理、请求去重；
- 行为级浏览器测试：`camera_race_e2e_test.py` 实际执行“实体 → 模拟 → 实体”，并验证旧 MediaStream track 已结束、新 stream 为当前 `srcObject`。

### 1.5 摄像头状态口径修正

修正了旧报告把不同层状态混在一起的问题。

`CameraController` 只负责传输层：

```text
idle
requesting
live
disconnected
reconnecting
error
```

`InputController` 在此基础上提供前景分割管线状态：

```text
capturing-background
ready
```

本报告不再声称 `CameraController` 自身包含 `capturing-background` 或 `ready`。

### 1.6 非破坏、跨平台素材验证

旧验证器只比较 rebuild A 与 rebuild B，而且直接重写工作树，因此不能证明 shipped outputs 与重建等价，也会破坏 MANIFEST。

新验证器：

1. 在两个临时输出目录进行完整重建；
2. 不改写交付树；
3. 比较 shipped outputs、rebuild A、rebuild B；
4. 校验工作树文件哈希、Git 状态和 MANIFEST 前后不变；
5. 最后再次执行 `manifest:verify`。

跨平台一致性合同：

- PNG：解码后的精确 RGBA 像素哈希；
- JPEG：128×72 块平均后的 5-bit RGB 语义哈希；
- WAV / JSON：字节 SHA-256；
- 同一平台 rebuild A / B：全部生成文件字节一致。

实际验证结果：

```text
生成输出：98
语义不一致：0
同平台重建字节不一致：0
WAV / JSON shipped 字节不一致：0
工作树变化：0
MANIFEST 变化：0
```

因此本报告只声明：

> PNG 像素级跨平台可复现；JPEG 语义像素级跨平台可复现；同平台生成输出字节级可复现。

不再声明 macOS 与 Linux 的 PNG/JPEG 压缩文件字节必然相同。

### 1.7 可配置 soak 测试

新增：

```text
tests/e2e/soak_test.py
npm run test:soak
```

60 分钟命令：

```bash
SOAK_SECONDS=3600 \
SOAK_SAMPLE_SECONDS=5 \
SOAK_RESULT=/tmp/hanhuaxiang-soak-60m.json \
PLAYWRIGHT_CHROMIUM_PATH=/path/to/chrome \
npm run test:soak
```

本轮只真实执行了 15 秒短跑，没有把 60 分钟写成已通过。

15 秒短跑结果：

```text
样本：15
63 节点始终绘制：是
63 节点始终激活：是
Console / Page error：0
外部网络请求：0
中位 FPS：30.97
平均 FPS：29.40
尾部平均 FPS：26.32
最低 FPS：16.67
JS heap 首尾变化：-92,352 bytes
```

## 2. 当前架构

```text
src/core/          数学、配置、3×3 Homography
src/input/         实体/模拟摄像头、generation、前景分割
src/trigger/       63 区覆盖、滞回和防抖
src/calibration/   标定界面、预设、导入导出
src/scene/         全屏视口、63 画格构图、人物和装饰渲染
src/audio/         九条同步循环音轨
src/ui/            操作界面
```

关键实现：

- 63 个触发格仍为 9×7 规范摄像头平面；
- 63 个视觉画格是独立的画像石建筑构图；
- Camera Mask 通过真实 3×3 Homography 投影到触发平面；
- 全屏舞台使用 100% CSS 视口；
- 内部 Canvas 默认约 120 万像素上限，以维持 63 节点动画性能；
- 所有资源本地加载，无 CDN、分析脚本或云端摄像头处理。

## 3. 实际执行的测试

### 3.1 JavaScript / Node

命令：

```bash
npm test
```

结果：

```text
JavaScript 语法检查：36 files passed
Node 单元测试：22 passed, 0 failed
Server 测试：2 passed, 0 failed
```

其中新增摄像头单元测试 6 项，覆盖持续重连、权限永久拒绝、generation race、视频超时、播放失败和并行请求去重。

### 3.2 行为级 E2E

四个阶段在独立浏览器 / 服务器环境中实际执行：

```bash
PLAYWRIGHT_CHROMIUM_PATH=/usr/bin/chromium \
E2E_ARTIFACT_DIR=/tmp/hanhuaxiang-e2e \
python3 tests/e2e/e2e_test.py

python3 tests/e2e/camera_race_e2e_test.py
python3 tests/e2e/camera_e2e_test.py
python3 tests/e2e/reconnect_e2e_test.py
```

结果：

```text
主行为与视觉结构：35 checks passed
实体来源异步竞争：10 checks passed
模拟摄像头与背景采集：10 checks passed
模拟断线恢复：8 checks passed
总计：63 behavioral checks passed
```

主压力段的一次记录：

```text
63 / 63 节点持续激活
平均 FPS：51.24
中位 FPS：52.26
最低 FPS：46.00
低于 12 FPS 样本：0
外部请求：0
Console / Page error：0
```

实际浏览器路径由环境变量或自动查找决定，不再在测试源码中硬编码 Linux Chromium。

### 3.3 素材重建与 MANIFEST

命令：

```bash
ASSET_VERIFY_RESULT=/tmp/han-assets.json npm run assets:verify
npm run manifest:verify
```

结果见第 1.6 节和：

```text
docs/test-results/asset-rebuild-results.json
```

### 3.4 短时 soak

命令：

```bash
SOAK_SECONDS=15 \
SOAK_SAMPLE_SECONDS=1 \
SOAK_RESULT=/tmp/han-soak-fix2.json \
PLAYWRIGHT_CHROMIUM_PATH=/usr/bin/chromium \
python3 tests/e2e/soak_test.py
```

结果见：

```text
docs/test-results/soak-short-results.json
```


### 3.5 空目录 staging 冷启动

在不含 `.git`、`node_modules` 和 Python 缓存的独立目录中实际执行：

```bash
npm install
npm run clean:legacy:check
npm run manifest:verify
npm test
ASSET_VERIFY_TMPDIR=/dev/shm npm run test:asset-preservation
PLAYWRIGHT_CHROMIUM_PATH=/usr/bin/chromium python3 tests/e2e/e2e_test.py
PLAYWRIGHT_CHROMIUM_PATH=/usr/bin/chromium python3 tests/e2e/camera_race_e2e_test.py
PLAYWRIGHT_CHROMIUM_PATH=/usr/bin/chromium python3 tests/e2e/camera_e2e_test.py
PLAYWRIGHT_CHROMIUM_PATH=/usr/bin/chromium python3 tests/e2e/reconnect_e2e_test.py
PORT=44117 HOST=127.0.0.1 ./start.sh
curl http://127.0.0.1:44117/health
SOAK_SECONDS=10 PLAYWRIGHT_CHROMIUM_PATH=/usr/bin/chromium npm run test:soak
```

实际结果：

```text
npm install：通过，0 vulnerabilities
Legacy：20 个废弃路径不存在
Manifest：189 files / 62,903,224 bytes，通过
Syntax：36 files passed
Unit：22 passed
Server：2 passed
Asset preservation：98 outputs，通过，工作树与 MANIFEST 不变
E2E：35 + 10 + 10 + 8 = 63 checks passed
start.sh / health：通过
10 秒 clean soak：通过
```

测试环境：

```text
Node v22.16.0
npm 10.9.2
Python 3.13.5
Playwright 1.57.0
Pillow 12.2.0
NumPy 2.3.5
Chromium /usr/bin/chromium
```

## 4. 基线遗留文件清理

以下基线文件已删除，不保留兼容壳：

```text
src/app.js
tests/smoke_test.py
config/cells.json
assets/mural-base.jpg
assets/sprites/qin.png
assets/sprites/flute.png
assets/sprites/pipa.png
assets/sprites/bells.png
assets/sprites/erhu.png
assets/sprites/drum.png
assets/sprites/dancer.png
assets/sprites/attendant.png
docs/DELIVERY_REPORT.md
docs/preview-all.png
docs/preview-auto.png
docs/preview-calibration.png
docs/preview-mobile.png
docs/preview-pointer.png
docs/smoke-test-results.json
docs/sprite-contact-sheet.jpg
```

检查命令：

```bash
npm run clean:legacy:check
```

实际结果：20 个废弃路径全部不存在。

## 5. 仍未完成、不能替代的软件外验收

以下项目继续如实披露：

### 5.1 没有实体 USB 摄像头验收

自动化使用：

- 模拟摄像头；
- 浏览器注入的 MediaStream；
- 权限拒绝注入；
- track 断线注入。

没有验证特定品牌摄像头驱动、真实拔插、硬件权限弹窗、曝光和白平衡。

### 5.2 没有真实楼梯与投影现场

没有验证：

- 摄像头和投影仪的现场安装角度；
- 真实楼梯或走廊的四角 Homography；
- 投影光直接照入摄像头；
- 真实多人密集交叉和长距离遮挡；
- 音响空间混音。

### 5.3 Pro 交付阶段未完成长稳；Codex 已完成 60 分钟独立验收

Pro 交付时真实执行的是 15 秒 soak 和 12 秒高负载压力段，没有把它们描述成 60 分钟结果。随后 Codex 于 2026-08-01 在 macOS / Google Chrome 上独立执行 3600 秒高负载长稳：实际总时长 3626.942 秒、704 组采样、平均 FPS 58.936、P10 57.873、JS Heap 净增 1,929,771 bytes、后半段斜率 5,240.612 bytes / minute，9 / 9 音频持续就绪，运行时/控制台/页面错误与外部请求均为 0，8 项判定全部通过。完整证据见 `docs/CODEX_ACCEPTANCE_REPORT.md`。

该结果仍不能替代正式展览目标机器上的 4–8 小时连续运行。

### 5.4 视觉不是一比一复刻

当前构图显著增加了参考视频中的密集分格、左右纹样、中央鼓台和大群像特征，但仍然：

- 不是原作者画面的逐像素复制；
- 没有复制参考视频中的具体人物、纹样或音乐文件；
- 不是考古学意义上的汉代画像石复原；
- 32 个基础源中，24 个来自同一张项目自有壁画的不同区域；
- 60 个运行时 PNG 中包含组合派生素材；
- 63 个节点不等于 63 位独立绘制人物。

### 5.5 4K 内部渲染取舍

3840×2160 浏览器窗口会完整占满屏幕，但内部 Canvas 默认约 120 万像素，不是原生 4K backing store。该取舍用于把 63 节点压力段维持在可用帧率。若目标机器具备高性能独立 GPU，可通过 `ViewportManager` 参数提高上限后重新做长稳测试。

## 6. 结论

本修正版完成了 Codex 指出的六项软件阻断：

- 横屏画像石建筑墙重构；
- 基础人物 / 群像轮廓显著扩展；
- 实体摄像头持续重连；
- generation 竞争保护和失败清理；
- macOS / Linux 语义一致、非破坏素材验证；
- 报告状态口径和可配置 soak 测试。

软件自动化结论不能替代实体硬件与现场验收。最终 ZIP、binary patch、MANIFEST 和冷启动报告的 SHA-256 以本轮单独交付文件为准。
