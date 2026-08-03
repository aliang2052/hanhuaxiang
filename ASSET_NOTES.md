# 素材来源与派生说明

## 1. 数量

当前交付的事实统计：

| 类别 | 数量 | 说明 |
|---|---:|---|
| 完整画像石壁画源 | 1 | `assets/source-highres/base-mural.png` |
| 当前干净背景源 | 1 | `assets/source-highres/base-stone-clean-v2.png`，仅保留连续石壁肌理，不包含人物、格线或建筑结构 |
| 第一批独立高分辨率人物源 | 8 | 琴、笛、琵琶、钟磬、弦乐、鼓、舞者、侍者 |
| 第二批独立高分辨率人物 / 群像源 | 24 | 位于 `assets/source-highres/independent-v2/`，由三张九宫格母版分别设计并切分去背 |
| 独立基础轮廓 / 场景源合计 | 32 | 8 + 24；运行时不再使用壁画裁切人物 |
| 运行时透明 PNG | 60 | 32 单体、12 双人、8 三人、8 大型群像 |
| 场景节点 | 63 | V3 实际使用 47 个不同文件：46 个单人节点、4 个双人节点、10 个三人节点、3 个中央大型群像节点 |
| 离线声部 | 63 | 一格一声、无重复 audioGroup，16 秒 Opus 循环 |
| 实录源样本 | 246 | 取自 63 个不同 VCSL 乐器 / 奏法目录，约 14MB |

不能把它描述为“63 位独立绘制人物”；准确说法是 32 个独立设计的基础人物 / 群像源，派生为 60 个运行时素材并映射到 63 个节点。

## 2. 独立高分辨率人物源

以下 8 张图片是本项目在本次创作流程中生成并纳入交付的高分辨率源：

```text
assets/source-highres/qin.png
assets/source-highres/flute.png
assets/source-highres/pipa.png
assets/source-highres/bells.png
assets/source-highres/erhu.png
assets/source-highres/drum.png
assets/source-highres/dancer.png
assets/source-highres/attendant.png
```

它们用于提供较干净的独奏人物。发布和商用前，项目方仍应根据所使用生成服务的条款完成授权确认；本报告不替代法律意见。

## 3. 第二批 24 个独立人物 / 群像源

第二批角色使用三张 3×3 生成母版分别设计，再沿角色之间的纯绿色空隙切分并去除色键背景。最终透明原图位于：

```text
assets/source-highres/independent-v2/
```

九宫格母版保存在：

```text
assets/source-highres/independent-v2/sheets/
```

这 24 张包含不同的轮廓和角色类型，例如：

- 抚琴台、竖吹乐师、琵琶乐师；
- 编钟架、击钟者、弦乐和排箫；
- 建鼓双人组和鼓手；
- 长袖舞、绸带舞、杂技；
- 奉盘、进爵、侍立、号角；
- 宴饮桌、宴饮双人和大型宴饮群像。

它们不是从 `base-mural.png` 中裁切，也不是把第一批 8 张人物做镜像、缩放或简单重排。构建程序直接读取这 24 张透明原图；旧的 `assets/source-highres/mural-crops/` 仅作为历史备份，不再参与构建或运行。

24 张新原图总览位于 `docs/screenshots/independent-24-v2-contact-sheet.jpg`。

## 4. 60 个运行时素材

构建脚本生成：

- 32 个基础源的透明单体版本；
- 12 个双人组合；
- 8 个三人组合；
- 8 个大型群像。

派生关系记录在：

```text
assets/sprites/manifest.json
```

组合素材可能发生局部镜像、层叠和位置调整；“32 个独立基础源”统计不把这些运行时镜像和拼组重复计为新的独立轮廓。

## 5. 背景与参考视频

背景运行文件：

```text
assets/background/stone-texture-clean-v2.jpg
```

其可复现源文件：

```text
assets/source-highres/base-stone-clean-v2.png
```

该背景只保留低对比度的暖灰石壁肌理，不包含人物、乐器、宴席、编号、格线、边框或建筑结构。63 个分格、梁柱、边框和中央舞台全部由程序绘制。原始 `base-mural.png` 仅作为历史参考和版本回退保留，不再用于重建任何运行人物。

交付物没有从用户上传的参考视频中抠取人物、纹样、建筑或音乐像素。参考视频只用于研究以下设计原则：

- 密集画像石建筑分格；
- 上下和左右连续纹样；
- 中央纵向鼓台 / 仪式舞台；
- 多层梁柱和栏杆；
- 人体跨格触发多个古代人物。

当前视觉是原创近似实现，不是原作品逐像素重建，也不是考古复原图。

## 6. V3 Live 音频来源

V3 Live 使用 Versilian Community Sample Library（VCSL）的真实乐器录音。VCSL 由 Versilian Studios LLC 与贡献者建设，并以 CC0 1.0 发布，可修改、商用和重新分发。项目精选了 63 个不同乐器 / 奏法目录中的 246 个 OGG 样本；完整原始路径、哈希与许可信息记录在 `assets/audio-source/vcsl/manifest.json`，上游说明保存在 `assets/audio-source/vcsl/VCSL-README.md`。

构建脚本只对真实录音进行确定性节奏编排、单声道舞台化、峰值保护和 Opus 编码，不添加合成振荡器或伪造的乐器噪声。它们是真实演奏采样，但仍不应宣传为“真实出土汉代乐器录音”：部分音色来自相近的世界乐器，另有少量现代萨克斯、口琴和西洋打击乐。运行时不发起网络请求。

## 7. 重建与跨平台一致性

```bash
python3 -m pip install -r requirements-dev.txt
npm run assets
```

`tools/verify_asset_rebuild.py` 在两个临时输出目录重建全部生成文件，不触碰交付树，并将 shipped outputs 与 rebuild A / B 比较。

一致性合同：

- PNG：解码后 RGBA 像素完全一致；
- JPEG：块平均、5-bit 量化后的 RGB 语义哈希一致；
- OGG：解码为单声道 48 kHz PCM 后，语义 SHA-256 一致（不受 Ogg 流序列号影响）；
- JSON：字节 SHA-256 一致；
- 同一平台的 rebuild A / B：PNG、JPEG、JSON 等确定性输出字节一致；
- 验证后 MANIFEST、Git 状态和工作树保持不变。

因此不能再写“跨平台 PNG/JPEG 文件字节必然完全一致”。正确表述是像素 / 语义可复现；同平台字节可复现。

## 8. 发布前审查

正式公开展览或商业发布前仍应完成：

- 生成服务授权条款确认；
- 是否使用真实文物图像、拓片或受限馆藏数字化资料的复查；
- 音乐、字体、馆名、题签和展陈文案的授权确认；
- 避免把生成式“画像石风格”作品宣传为真实汉代文物复原。
