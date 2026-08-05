# 素材来源与派生说明

## 1. 数量

当前精简运行版的事实统计：

| 类别 | 数量 | 说明 |
|---|---:|---|
| 运行时人物构图 | 47 | 63 个节点当前实际引用的透明 PNG |
| 运行时动作表 | 47 | 与人物构图一一对应的九帧动作表 |
| 场景节点 | 63 | 46 个单人节点、4 个双人节点、10 个三人节点、3 个中央大型群像节点 |
| 离线声部 | 63 | 36 段试听音色加 27 段 VCSL 补充音色 |

不能把它描述为“63 位独立绘制人物”；当前运行版使用 47 套构图映射到 63 个节点。以下章节保留设计来源记录，其中提到的高清母版路径已从精简运行版移除。

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

V3 Live 使用 Versilian Community Sample Library（VCSL）的真实乐器录音。VCSL 由 Versilian Studios LLC 与贡献者建设，并以 CC0 1.0 发布，可修改、商用和重新分发。原始路径、哈希与许可信息保存在 `licenses/vcsl-manifest.json`，上游说明保存在 `licenses/VCSL-README.md`。

构建脚本只对真实录音进行确定性节奏编排、单声道舞台化、峰值保护和 Opus 编码，不添加合成振荡器或伪造的乐器噪声。它们是真实演奏采样，但仍不应宣传为“真实出土汉代乐器录音”：部分音色来自相近的世界乐器，另有少量现代萨克斯、口琴和西洋打击乐。运行时不发起网络请求。

## 7. 发布前审查

正式公开展览或商业发布前仍应完成：

- 生成服务授权条款确认；
- 是否使用真实文物图像、拓片或受限馆藏数字化资料的复查；
- 音乐、字体、馆名、题签和展陈文案的授权确认；
- 避免把生成式“画像石风格”作品宣传为真实汉代文物复原。
