# 汉画像·百戏乐舞（P0 修正版）

基于仓库基线 `ac76d30` 完成的离线全屏互动装置网页。浏览器摄像头或模拟摄像头把人体前景映射到 9×7、共 63 个触发区域；触发状态驱动画面中的汉画像石人物、群像、墨色反馈和同步音轨。

本版本号：`2.2.0-p0-fix2`。

## 1. 运行

要求：Node.js 18 或更高版本。运行作品本身不需要 Python，也不需要互联网。

```bash
npm install
npm start
```

浏览器打开：

```text
http://127.0.0.1:4173
```

实体摄像头必须从安装电脑本机的 `localhost` / `127.0.0.1` 地址打开；普通局域网 `http://192.168.x.x` 不属于浏览器安全上下文，只适合远程查看或触控，不能保证 `getUserMedia()` 可用。若必须在另一台设备调用摄像头，应部署 HTTPS。

也可以直接使用：

- macOS：双击 `start.command`
- Windows：双击 `start.bat`
- Linux：执行 `./start.sh`

健康检查：

```bash
curl http://127.0.0.1:4173/health
```

作品舞台始终使用浏览器完整 CSS 视口，不存在固定 16:9 播放框。为了保证 63 节点实时动画，内部 Canvas backing store 默认限制在约 120 万像素；4K 和超宽屏仍为完整全屏 CSS 输出，但不是原生 4K 像素缓冲。

## 2. 现场使用

进入作品后，右下角“控”打开操作面板。

### 自动演示

选择“自动演示”，无需摄像头即可观察局部人物依次苏醒。

### 鼠标 / 多点触摸

选择“鼠标 / 触摸”。鼠标、触摸点及其邻近身体半径会同时覆盖多个触发格。

### 真人摄像头

1. 模式选择“摄像头”。
2. 来源选择“实体摄像头”。
3. 点击“开启摄像头”。
4. 保持摄像头画面无人，点击“采集空场”。
5. 空场进度完成后，人物进入画面即可触发。
6. 打开“摄像头标定”，拖动四角，使触发平面对应真实楼梯、走廊或表演区域。
7. 保存标定预设，最后进入浏览器全屏。

“采集空场”可直接从自动模式发起：程序会先切换摄像头模式并启动当前摄像头来源，然后采集背景，不再要求用户预先手动满足隐藏的模式前置条件。

### 模拟摄像头

来源选择“模拟摄像头”，可测试：

- 单人和双人前景；
- 静止人物保留；
- 整体光照突变；
- 视频断线与恢复；
- Mask、连通区域、每格覆盖率和处理耗时。

模拟输入只用于软件验收，不能代替实体 USB 摄像头和现场投影验收。

## 3. 视觉结构

横屏场景与 9×7 触发平面已经解耦，不再把规则触发网格直接当作视觉构图。当前横屏结构包含：

- 63 个密集、非均匀画像石建筑画格；
- 左右连续纹样边框；
- 上下连续云气、神兽和几何纹样带；
- 8 条主要横梁 / 栏杆层；
- 5 个中央仪式舞台画格；
- 中央纵向建鼓、编钟、阶道和多层仪式空间；
- 大小不同的独奏、双人、三人及大型群像；
- 灰色待机像、墨黑激活像与局部矿物色晕染。

竖屏使用独立构图，不是把横屏场景压缩成一条窄画面。

结构指标可从测试接口 `window.__HAN_TEST_API__.getState().sceneStructure` 读取，E2E 会断言画格数量、中央舞台、左右边框和横梁均存在。

## 4. 素材数量与事实口径

本项目当前包含：

- 8 张独立高分辨率人物源图；
- 从项目自有完整画像石壁画中提取的 24 个不同人物、器物或群像轮廓；
- 合计 32 个不同基础轮廓 / 场景源；
- 60 个运行时透明 PNG：32 个单体源、12 个双人组合、8 个三人组合、8 个大型群像；
- 63 个视觉节点，使用 60 个不同运行时 PNG，其中 3 个复杂群像被再次使用。

因此，本项目**不是 63 位分别独立绘制的人物**。详细来源、派生关系与限制见 [`ASSET_NOTES.md`](ASSET_NOTES.md)。

参考视频仅用于研究空间构图和交互机制；交付包没有从参考视频中抠取、复制或重发原作者画面像素和音乐。

## 5. 摄像头状态与恢复

`CameraController` 的传输层状态为：

```text
idle → requesting → live
                 ↘ disconnected → reconnecting → live
                 ↘ error
```

`InputController` 在传输层之上增加背景分割管线状态：

```text
capturing-background
ready
```

断线恢复使用可取消的持续重连循环：临时 `NotReadableError`、`AbortError`、视频等待超时等会继续指数退避重试，延迟有上限但循环不会只尝试一次；永久权限拒绝、浏览器安全限制和不可满足约束会停止自动重试并提示人工处理。成功恢复后连续失败计数归零。

每次启动会带 generation token。快速执行“实体 → 模拟 → 实体”时，旧 `getUserMedia()` 即使稍后才返回，也只会停止自己的 tracks，不能覆盖新来源。视频超时、`play()` 失败、来源切换和手动停止都会停止已取得的 tracks 并清空 `video.srcObject`。

## 6. Homography 标定

标定使用真正的 3×3 projective homography，而不是四角双线性插值。系统维护：

- 摄像头平面 → 9×7 触发平面的单应矩阵；
- 触发平面 → 摄像头画面的逆矩阵；
- 四角重投影误差；
- 自交、极小面积、越界、非有限矩阵和奇异矩阵检查；
- 标定预设保存、导入和导出。

非法四边形会被拒绝，并保留上一次有效标定。

## 7. 素材重建

运行素材构建需要 Python 3、Pillow 和 NumPy：

```bash
python3 -m pip install -r requirements-dev.txt
npm run assets
```

只重建视觉：

```bash
npm run assets:visuals
```

非破坏验证：

```bash
ASSET_VERIFY_RESULT=/tmp/han-assets.json npm run assets:verify
npm run manifest:verify
```

验证器在临时目录完成两次完整重建，不会改写交付树：

- PNG：比较解码后的精确 RGBA 像素哈希；
- JPEG：比较块平均后的 5-bit RGB 语义哈希，以容忍跨平台 JPEG 编解码器的小幅舍入差异；
- WAV 和 JSON：继续要求字节级 SHA-256 一致；
- 同一平台的两次重建：所有生成文件必须字节级一致；
- 验证前后 Git 状态、项目文件和 MANIFEST 必须不变。

准确表述是：**PNG 像素级跨平台可复现，JPEG 语义像素级跨平台可复现，同平台生成文件字节级可复现**。不承诺不同平台的 PNG/JPEG 压缩字节天然相同。

## 8. 测试

基础测试：

```bash
npm test
```

行为级 E2E：

```bash
PLAYWRIGHT_CHROMIUM_PATH=/path/to/chrome npm run test:e2e
```

`PLAYWRIGHT_CHROMIUM_PATH` 可省略；测试会依次查找 Playwright 自带 Chromium 和系统 Chrome / Chromium，不再硬编码 Linux 路径。

非破坏素材验证：

```bash
ASSET_VERIFY_RESULT=/tmp/han-assets.json npm run test:asset-preservation
```

短时 CI soak：

```bash
SOAK_SECONDS=30 PLAYWRIGHT_CHROMIUM_PATH=/path/to/chrome npm run test:soak
```

60 分钟现场前 soak：

```bash
SOAK_SECONDS=3600 \
SOAK_SAMPLE_SECONDS=5 \
SOAK_RESULT=/tmp/hanhuaxiang-soak-60m.json \
PLAYWRIGHT_CHROMIUM_PATH=/path/to/chrome \
npm run test:soak
```

交付报告只记录真实执行过的短跑结果；没有把 60 分钟命令写成已完成的测试。

## 9. 工程目录

```text
src/core/          数学、Homography、配置 schema
src/input/         实体/模拟摄像头、前景分割、输入调度
src/trigger/       63 区映射、覆盖率、滞回防抖
src/calibration/   四角标定、预设和调试视图
src/scene/         全屏视口、建筑构图、人物与装饰渲染
src/audio/         九条同步循环音轨
src/ui/            操作面板
assets/source-highres/  原始壁画、8 个独立人物源和 24 个壁画派生源
assets/sprites/    60 个运行时人物 / 群像 PNG
config/            场景和运行参数
 tools/            构建、检查、Manifest、清理工具
 tests/            单元、服务器、E2E、素材和 soak 测试
```

## 10. 尚未替代的现场工作

软件自动化已经覆盖模拟摄像头、权限拒绝、持续重连、异步竞争、资源清理、Homography、响应式和压力段，但仍必须现场完成：

- 真实 USB 摄像头权限、驱动、拔插和恢复；
- 曝光、白平衡、投影光干扰与人物服装颜色测试；
- 楼梯 / 走廊四角标定；
- 真实多人遮挡和密集交叉；
- macOS 与 Windows 目标机启动脚本；
- Codex 已在 macOS / Chrome 完成 60 分钟独立长稳；正式展览仍需在目标机器做 4–8 小时连续运行；
- 视觉与音乐发布前的最终版权和艺术史审查。

完整实现与风险披露见 [`PRO_IMPLEMENTATION_REPORT.md`](PRO_IMPLEMENTATION_REPORT.md)，独立验收证据见 [`docs/CODEX_ACCEPTANCE_REPORT.md`](docs/CODEX_ACCEPTANCE_REPORT.md)。
