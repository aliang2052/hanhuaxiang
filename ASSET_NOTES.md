# 素材来源与派生说明

## 1. 数量

当前交付的事实统计：

| 类别 | 数量 | 说明 |
|---|---:|---|
| 完整画像石壁画源 | 1 | `assets/source-highres/base-mural.png` |
| 独立高分辨率人物源 | 8 | 琴、笛、琵琶、钟磬、弦乐、鼓、舞者、侍者 |
| 壁画中提取的不同基础轮廓 / 群像源 | 24 | 来自完整壁画中不同坐标区域，不是对 8 张人物源做镜像 |
| 不同基础轮廓 / 场景源合计 | 32 | 8 + 24 |
| 运行时透明 PNG | 60 | 32 单体、12 双人、8 三人、8 大型群像 |
| 场景节点 | 63 | V3 实际使用 47 个不同文件：46 个单人节点、4 个双人节点、10 个三人节点、3 个中央大型群像节点 |
| 离线声部 | 63 | 一格一声、无重复 audioGroup，16 秒 Opus 循环 |
| 实录源样本 | 246 | 取自 63 个不同 VCSL 乐器 / 奏法目录，约 14MB |

不能把它描述为“63 位独立绘制人物”。

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

## 3. 24 个不同壁画派生源

`tools/build_assets.py` 从项目自有的 `base-mural.png` 中按 24 个不同坐标区域提取人物、器物或群像，并进行确定性的背景透明化和裁切。输出位于：

```text
assets/source-highres/mural-crops/
```

这些区域包含不同的轮廓和角色类型，例如：

- 抚琴台、竖吹乐师、琵琶乐师；
- 编钟架、击钟者、弦乐和排箫；
- 建鼓双人组和鼓手；
- 长袖舞、绸带舞、杂技；
- 奉盘、进爵、侍立、号角；
- 宴饮桌、宴饮双人和大型宴饮群像。

它们不是把同一批 8 张人物图片做镜像、缩放或简单排列后冒充新的基础源；但它们确实共享同一张项目自有完整壁画作为上游来源，这一点必须保留在说明中。

每个裁切区域及其来源矩形记录在：

```text
assets/source-highres/mural-crops/manifest.json
```

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

组合素材可能发生局部镜像、层叠和位置调整；“32 个基础源”统计不把这些镜像和拼组重复计为新的独立轮廓。

## 5. 背景与参考视频

背景运行文件：

```text
assets/background/mural-texture.jpg
```

其可复现源文件：

```text
assets/source-highres/base-mural.png
```

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
