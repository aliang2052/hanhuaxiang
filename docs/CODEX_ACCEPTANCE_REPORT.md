# Codex 独立验收报告

验收日期：2026-08-01（Asia/Shanghai）

验收对象：`2.2.0-p0-fix2`，仓库基线 `ac76d30`

## 1. 输入交付物

- 完整 ZIP：`hanhuaxiang_P0_fix2_ac76d30_full.zip`
- ZIP SHA-256：`53f663895083afc5e48b7980e396a441628d74ec2fcd80b1cae5aebbfe4c5be3`
- Binary patch：`hanhuaxiang_P0_fix2_ac76d30.patch`
- Patch SHA-256：`d4ba353b0e60ab992e9f59a7d4f905024fd31b4d60e3d171b541fcb6b06ff99c`

ZIP 完整性与路径安全检查通过。Patch 的哈希与外部工程师声明一致，但不能直接应用到真实 `ac76d30`：它错误地把基线已有的 `.gitignore` 和 `docs/CHATGPT_PRO_TASK.md` 标成新文件。Codex 排除这两项后应用其余二进制变更，再将两处文件与完整 ZIP 对齐；最终仓库候选树与 ZIP 逐字节一致（仅审查目录的 Python 缓存除外）。ChatGPT Pro 已在后续审计答复中承认该补丁基线声明不准确。

## 2. 独立测试结果

- `npm install`：通过，0 vulnerabilities。
- JavaScript 语法：36 files passed。
- Node 单元测试：22 passed。
- Server 测试：2 passed。
- Legacy cleanup：20 个废弃路径均不存在。
- 资产验证：98 个生成输出；交付像素/语义与两次干净重建一致，同平台两次重建字节一致。
- 非破坏证明：资产验证后项目文件、Git 状态、`MANIFEST.json` 与 `MANIFEST.sha256` 不变，随后 `manifest:verify` 通过。
- 浏览器 E2E：35 + 10 + 10 + 8 = 63 项行为检查全部通过。
- E2E 外部请求、console error、page error：均为 0。

## 3. 60 分钟独立长稳

Codex 使用 macOS、Google Chrome、1920×1200 视口，在全 63 节点持续激活、9 组音频持续运行的高负载状态下执行了独立长稳测试。

- 请求时长：3600 秒；实际总时长：3626.942 秒。
- 采样：704 组，间隔约 5 秒。
- 63 节点持续激活：通过。
- 音频持续就绪：9 / 9，通过。
- 平均 FPS：58.936。
- FPS 中位数：59.868。
- FPS P10：57.873。
- 最低单次采样 FPS：9.620；属于孤立采样，P10 与整体平均未出现崩塌。
- JS Heap：3,574,842 → 5,504,613 bytes，净增 1,929,771 bytes。
- 后半段 Heap 斜率：5,240.612 bytes / minute，未出现持续泄漏趋势。
- runtime errors、console errors、page errors、external requests：全部为 0。

长稳脚本的 8 项判定全部为 `true`：health、全节点持续激活、无运行时错误、无控制台/页面错误、无外部请求、音频持续就绪、FPS 稳定、Heap 稳定。

## 4. 视觉结论

Fix2 相比被退回的首版已实质重构：横屏包含 63 个密集非均匀画格、左右纹样边框、上下装饰带、8 条主要横梁和 5 个中央舞台画格；中央建鼓与大型群像明显增强。当前效果已达到本轮 P0 的“接近参考作品的画像石建筑墙与局部唤醒机制”门槛，但不是参考视频的一比一复制，也不是考古复原。

## 5. 最终边界

本轮软件验收合格，但自动化不能替代以下现场工作：

- 特定 USB 摄像头、驱动、权限弹窗和真实拔插；
- 真实楼梯 / 走廊、投影仪与四角 Homography；
- 投影光、曝光、白平衡、服装颜色与多人密集遮挡；
- Windows 目标机冷启动；
- 正式展览机器 4–8 小时连续运行；
- 视觉、音乐、生成素材许可与艺术史终审。

实体摄像头应从安装电脑的 `localhost` / `127.0.0.1` 打开；普通局域网 HTTP 地址不属于浏览器摄像头安全上下文。
