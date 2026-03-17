from __future__ import annotations

DAY_ORDER = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]
DAY_ABBR = {
    "mon": "Mon",
    "tue": "Tue",
    "wed": "Wed",
    "thu": "Thu",
    "fri": "Fri",
    "sat": "Sat",
    "sun": "Sun",
}
DAY_ALIASES = {
    "mon": "mon",
    "monday": "mon",
    "tue": "tue",
    "tues": "tue",
    "tuesday": "tue",
    "wed": "wed",
    "wednesday": "wed",
    "thu": "thu",
    "thur": "thu",
    "thurs": "thu",
    "thursday": "thu",
    "fri": "fri",
    "friday": "fri",
    "sat": "sat",
    "saturday": "sat",
    "sun": "sun",
    "sunday": "sun",
}
SPECIAL_DAY_ALIASES = {
    "public holiday": "publicHoliday",
    "day before public holiday": "dayBeforePublicHoliday",
    "day after public holiday": "dayAfterPublicHoliday",
}

JP_TO_EN = {
    "そば": "Soba",
    "カフェ": "Cafe",
    "洋食": "Western Food",
    "フレンチ": "French",
    "創作料理・イノベーティブ": "Creative Cuisine/Innovative",
    "イタリアン": "Italian",
    "ピザ": "Pizza",
    "日本料理": "Japanese",
    "天ぷら": "Tempura",
    "寿司": "Sushi",
    "ラーメン": "Ramen",
    "焼き鳥": "Yakitori",
    "焼肉": "Yakiniku",
    "居酒屋": "Izakaya",
    "食堂": "Shokudo",
    "すき焼き・しゃぶしゃぶ": "Sukiyaki, Shabushabu",
    "スペイン料理": "Spanish",
    "カレー": "Curry",
    "アジア・エスニック": "Asian Ethnic",
    "うなぎ": "Unagi",
    "餃子": "Gyoza",
    "中華料理": "Chinese",
    "中国料理": "Chinese",
    "お好み焼き": "Okonomiyaki",
    "ステーキ・鉄板焼き": "Steak, Teppanyaki",
    "とんかつ": "Tonkatsu",
    "ハンバーガー": "Hamburger",
    "うどん": "Udon",
    "和菓子・甘味処": "Wagashi",
    "スイーツ": "Sweets",
    "アイス・ジェラート": "Ice Cream & Gelato",
    "バー": "Bar",
    "パン": "Bakery",
    "立ち飲み": "Standing Bar",
    "鳥料理": "Chicken",
    "喫茶店": "Coffee Shop",
}

CATEGORY_LABEL_ALIASES = {
    "Chinese": "Chinese",
    "\u4e2d\u56fd\u6599\u7406": "Chinese",
    "Coffee Shop": "Coffee Shop",
    "\u55ab\u8336\u5e97": "Coffee Shop",
    "Chicken": "Toriyori",
    "\u9ce5\u6599\u7406": "Toriyori",
}


def normalize_category_label(name_en: str | None, name_jp: str | None = None, *, fallback: str = "Unknown"):
    for raw_value in (name_en, name_jp):
        label = (raw_value or "").strip()
        if not label:
            continue
        if label in CATEGORY_LABEL_ALIASES:
            return CATEGORY_LABEL_ALIASES[label]
        translated = JP_TO_EN.get(label)
        if translated:
            return CATEGORY_LABEL_ALIASES.get(translated, translated)
        return label
    return fallback


POPULAR_HUBS = [
    {"id": "shinjuku", "label": "Shinjuku", "nameJp": "新宿", "lat": 35.6900, "lng": 139.7000},
    {"id": "shibuya", "label": "Shibuya", "nameJp": "渋谷", "lat": 35.6595, "lng": 139.7005},
    {"id": "ginza", "label": "Ginza", "nameJp": "銀座", "lat": 35.6717, "lng": 139.7650},
    {"id": "hibiya", "label": "Hibiya", "nameJp": "日比谷", "lat": 35.6749, "lng": 139.7605},
    {"id": "asakusa", "label": "Asakusa", "nameJp": "浅草", "lat": 35.7110, "lng": 139.7985},
]

GENERIC_HOURS_NOTICE = "Hours and closed days may change, so please check with the restaurant before visiting."

CLOSURE_KEYWORDS = {
    "permanentlyClosed": ("permanently closed", "closed permanently", "permanent closure", "閉店", "閉業"),
    "temporarilyClosed": ("temporarily closed", "temporary closure", "休業", "臨時休業"),
}
