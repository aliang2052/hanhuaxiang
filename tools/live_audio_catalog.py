#!/usr/bin/env python3
"""Curated one-cell/one-voice catalog built from VCSL CC0 live recordings."""
from __future__ import annotations


def _voice(slug: str, label: str, role: str, source_dir: str, gain: float, reverb: float) -> dict[str, object]:
    return {
        "slug": slug,
        "label": label,
        "role": role,
        "sourceDir": source_dir,
        "gain": gain,
        "reverbSend": reverb,
    }


# The role counts deliberately match the 63 visual animation slots:
# pluck 13, sustain 6, wind 7, strike 14, clapper 2, drum 6, movement 15.
# Each entry points at a different recorded instrument/articulation directory.
LIVE_VOICES = [
    # Plucked strings and keyed strings (13)
    _voice("dan-tranh", "筝·越南十六弦", "pluck", "Zithers/Dan Tranh/Normal", .090, .10),
    _voice("dan-tranh-tremolo", "筝·轮指", "pluck", "Zithers/Dan Tranh/Tremolo", .082, .12),
    _voice("dan-tranh-gliss", "筝·刮奏", "pluck", "Zithers/Dan Tranh/Gliss", .078, .14),
    _voice("psaltery-pluck", "拨弦诗琴", "pluck", "Zithers/Psaltery, Bowed and Plucked/Pluck", .086, .11),
    _voice("concert-harp", "音乐会竖琴", "pluck", "Composite Chordophones/Concert Harp", .082, .12),
    _voice("folk-harp", "民间竖琴", "pluck", "Composite Chordophones/Folk Harp", .084, .10),
    _voice("strumstick", "三弦拨奏", "pluck", "Composite Chordophones/Strumstick/Finger", .086, .08),
    _voice("kalimba-kenya", "肯尼亚拇指琴", "pluck", "Plucked Idiophones/Kalimba, Kenya", .080, .09),
    _voice("kalimba-tanzania", "坦桑尼亚拇指琴", "pluck", "Plucked Idiophones/Kalimba, Tanzania", .080, .09),
    _voice("mbira-mavembe", "马文贝姆比拉", "pluck", "Plucked Idiophones/Mbira Mavembe (Gandanga), Zimbabwe, Low G", .082, .09),
    _voice("mbira-nyamaropa", "尼亚马罗帕姆比拉", "pluck", "Plucked Idiophones/Mbira dzaVadzimu Nyamaropa, Zimbabwe, Low B", .082, .09),
    _voice("nyunga-nyunga", "纽恩加纽恩加", "pluck", "Plucked Idiophones/Nyunga Nyunga, Mozambique, Low F", .080, .09),
    _voice("english-harpsichord", "英式羽管键琴", "pluck", "Zithers/Harpsichord, English/Sustains/Normal", .074, .08),

    # Sustained / bowed colours (6)
    _voice("psaltery-bow", "弓奏诗琴", "sustain", "Zithers/Psaltery, Bowed and Plucked/LongBow", .080, .12),
    _voice("wine-glass-fast", "水晶杯快摩", "sustain", "Friction Idiophones/Wine Glasses/Sustains/Fast", .070, .16),
    _voice("wine-glass-slow", "水晶杯慢摩", "sustain", "Friction Idiophones/Wine Glasses/Sustains/Slow", .070, .17),
    _voice("saxello", "萨克斯洛", "sustain", "Reed Aerophones/Saxello/Non-Vibrato", .072, .10),
    _voice("tenor-sax", "次中音萨克斯", "sustain", "Reed Aerophones/Tenor Saxophone/Non-Vibrato", .070, .09),
    _voice("chromatic-harmonica", "半音阶口琴", "sustain", "Free Aerophones/Harmonica-Hohner-Super64/Sustains/Normal", .068, .09),

    # Air and reed voices (7)
    _voice("alto-recorder", "中音木笛", "wind", "Edge-blown Aerophones/Baroque Alto Recorder/Sustain", .074, .11),
    _voice("bass-recorder", "低音木笛", "wind", "Edge-blown Aerophones/Baroque Bass Recorder/Sustain", .076, .11),
    _voice("soprano-recorder", "高音木笛", "wind", "Edge-blown Aerophones/Baroque Soprano Recorder/Sustain", .070, .12),
    _voice("tenor-recorder", "次中音木笛", "wind", "Edge-blown Aerophones/Baroque Tenor Recorder/Sustain", .074, .11),
    _voice("small-ocarina", "小陶笛", "wind", "Edge-blown Aerophones/Ocarina, Small/Sustain", .070, .13),
    _voice("ocarina", "陶笛", "wind", "Edge-blown Aerophones/Ocarina, Typical/Sustains/Sus", .072, .13),
    _voice("didgeridoo", "迪吉里杜管", "wind", "Lip Aerophones/Didgeridoo", .072, .08),

    # Bells, stones and tuned percussion (14)
    _voice("balafon", "传统巴拉风木琴", "strike", "Struck Idiophones/Balafon/Traditional Mallet", .080, .10),
    _voice("glockenspiel", "钢片琴", "strike", "Struck Idiophones/Glockenspiel", .066, .16),
    _voice("marimba", "马林巴", "strike", "Struck Idiophones/Marimba", .078, .11),
    _voice("vibraphone", "颤音琴", "strike", "Struck Idiophones/Vibraphone/Hard Mallets", .068, .16),
    _voice("xylophone", "木琴", "strike", "Struck Idiophones/Xylophone/Medium Mallets", .074, .11),
    _voice("slit-drum", "木舌鼓", "strike", "Struck Idiophones/Slit Drum", .082, .10),
    _voice("hand-chimes", "手持音条", "strike", "Struck Idiophones/Hand Chimes", .064, .16),
    _voice("nepalese-bells", "尼泊尔手铃", "strike", "Struck Idiophones/Hand Bells, Nepalese", .064, .17),
    _voice("gong", "铜锣", "strike", "Struck Idiophones/Gong 1", .066, .18),
    _voice("tubular-bells", "管钟", "strike", "Struck Idiophones/Tubular Bells 1", .066, .17),
    _voice("agogo-bells", "阿戈戈铃", "strike", "Struck Idiophones/Agogo Bells", .068, .11),
    _voice("cowbells", "牛铃", "strike", "Struck Idiophones/Cowbells", .066, .10),
    _voice("anvil", "铁砧", "strike", "Struck Idiophones/Anvil", .060, .13),
    _voice("brake-drum", "制动鼓金属片", "strike", "Struck Idiophones/Brake Drum", .062, .14),

    # Wood articulation (2)
    _voice("claves", "响棒", "clapper", "Struck Idiophones/Claves", .064, .07),
    _voice("woodblock", "木鱼", "clapper", "Struck Idiophones/Woodblock", .064, .08),

    # Large ceremonial percussion (6)
    _voice("frame-drum", "框鼓", "drum", "Struck Membranophones/Frame Drum", .082, .08),
    _voice("darbuka", "达布卡鼓", "drum", "Struck Membranophones/Darbuka", .078, .07),
    _voice("timpani", "定音鼓", "drum", "Struck Membranophones/Timpani 1/Hit", .078, .10),
    _voice("bass-drum", "大鼓", "drum", "Struck Membranophones/Bass Drum 1", .082, .10),
    _voice("clash-cymbals", "对钹", "drum", "Struck Idiophones/Clash Cymbals 1", .060, .18),
    _voice("suspended-cymbal", "悬钹", "drum", "Struck Idiophones/Suspended Cymbal 1", .058, .18),

    # Dance, procession and body rhythm (15)
    _voice("bongos", "邦戈鼓", "movement", "Struck Membranophones/Bongos", .068, .06),
    _voice("conga", "康加鼓", "movement", "Struck Membranophones/Conga", .068, .06),
    _voice("rope-snare", "绳索军鼓", "movement", "Struck Membranophones/Snare Drum, Rope Tension/Low", .060, .07),
    _voice("cajon", "卡宏鼓", "movement", "Struck Idiophones/Cajon", .070, .06),
    _voice("tambourine-one", "铃鼓一", "movement", "Struck Idiophones/Tambourine 1", .058, .09),
    _voice("tambourine-two", "铃鼓二", "movement", "Struck Idiophones/Tambourine 2", .058, .09),
    _voice("cabasa", "卡巴萨", "movement", "Struck Idiophones/Cabasa", .052, .06),
    _voice("large-shaker", "大沙锤", "movement", "Struck Idiophones/Shaker, Large", .052, .06),
    _voice("small-shaker", "小沙锤", "movement", "Struck Idiophones/Shaker, Small", .050, .06),
    _voice("sleigh-bells", "串铃", "movement", "Struck Idiophones/Sleigh Bells", .052, .10),
    _voice("ratchet", "棘轮响器", "movement", "Struck Idiophones/Ratchet", .054, .06),
    _voice("guiro", "刮瓜", "movement", "Struck Idiophones/Guiro", .056, .06),
    _voice("ocean-drum", "海浪鼓", "movement", "Other Membranophones/Ocean Drum", .058, .12),
    _voice("bell-tree", "铃树", "movement", "Struck Idiophones/Bell Tree/Stroke", .052, .14),
    _voice("finger-cymbals", "指钹", "movement", "Struck Idiophones/Finger Cymbals", .050, .14),
]


ANIMATION_AUDIO_ROLE = {
    "pluck": "pluck",
    "harp": "pluck",
    "bow": "sustain",
    "flute": "wind",
    "panpipe": "wind",
    "reed": "wind",
    "horn": "wind",
    "strike": "strike",
    "banquet": "strike",
    "clapper": "clapper",
    "drum": "drum",
    "gong": "drum",
    "cymbal": "drum",
    "dance": "movement",
    "procession": "movement",
    "serve": "movement",
    "acrobat": "movement",
}


assert len(LIVE_VOICES) == 63
assert len({voice["slug"] for voice in LIVE_VOICES}) == 63
