#!/usr/bin/env python3
"""Olimplist — модуль сбора данных.

Обходит официальные сайты олимпиад, проверяет доступность источника и
извлекает даты этапов; при неудаче сохраняет последние хорошие данные.
Результат проходит валидацию схемы и записывается атомарно.
Запускается по расписанию GitHub Actions каждые 12 часов.
"""
import json
import re
import socket
import sys
import time
from datetime import date, datetime
from pathlib import Path
from urllib import robotparser
from urllib.parse import urlparse

import requests
from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data" / "olimpiads.json"
UA = "Olimplist/1.0 (school individual project; contact via repository issues)"
TIMEOUT = 20
PAUSE = 1.5
RETRIES = 2
SEASON_START = date(2026, 9, 1)
SEASON_END = date(2027, 6, 30)

MONTHS = {
    "января": 1, "февраля": 2, "марта": 3, "апреля": 4, "мая": 5, "июня": 6,
    "июля": 7, "августа": 8, "сентября": 9, "октября": 10, "ноября": 11, "декабря": 12,
}
_M = "|".join(MONTHS)
RANGE_RE = re.compile(
    rf"(?:с\s+)?(\d{{1,2}})\s+({_M})\s*(\d{{4}})?\s*(?:—|–|-|по)\s*(\d{{1,2}})\s+({_M})\s*(\d{{4}})?",
    re.IGNORECASE,
)
SLUG_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
ISO_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")

socket.setdefaulttimeout(TIMEOUT)
_robots = {}


def clean(s, limit=160):
    s = re.sub(r"<[^>]*>", " ", str(s))
    s = re.sub(r"[\x00-\x1f\x7f]", " ", s)
    return re.sub(r"\s+", " ", s).strip()[:limit]


def robots_ok(url):
    p = urlparse(url)
    base = f"{p.scheme}://{p.netloc}"
    if base not in _robots:
        rp = robotparser.RobotFileParser()
        rp.set_url(base + "/robots.txt")
        try:
            rp.read()
        except Exception:
            rp = None
        _robots[base] = rp
    rp = _robots[base]
    return True if rp is None else rp.can_fetch(UA, url)


def fetch(url):
    if not robots_ok(url):
        return None
    for attempt in range(RETRIES + 1):
        try:
            r = requests.get(url, headers={"User-Agent": UA}, timeout=TIMEOUT)
            if r.status_code == 200:
                return r.text
            return None
        except requests.RequestException:
            if attempt < RETRIES:
                time.sleep(2 * (attempt + 1))
    return None


def infer_year(month, given, first_year=None):
    if given:
        return int(given)
    if first_year is not None:
        return first_year if month >= 9 else first_year + 1
    return 2026 if month >= 9 else 2027


def extract_ranges(html):
    text = BeautifulSoup(html, "html.parser").get_text(" ", strip=True)
    out = []
    for m in RANGE_RE.finditer(text):
        d1, m1, y1, d2, m2, y2 = m.groups()
        mo1, mo2 = MONTHS[m1.lower()], MONTHS[m2.lower()]
        try:
            ya = infer_year(mo1, y1)
            yb = infer_year(mo2, y2, ya)
            a, b = date(ya, mo1, int(d1)), date(yb, mo2, int(d2))
        except ValueError:
            continue
        if a <= b and SEASON_START <= a and b <= SEASON_END:
            out.append((a, b))
    uniq = sorted(set(out))
    return uniq


def name_token(name):
    words = re.sub(r"[^а-яёa-z0-9 ]", " ", name.lower()).split()
    for w in words:
        if len(w) >= 4:
            return w
    return words[0] if words else ""


def refresh(item):
    item["sourceOk"] = False
    item["datesVerified"] = False
    item["checkedAt"] = datetime.now().strftime("%Y-%m-%dT%H:%M:%S")
    html = fetch(item["url"])
    if html is None:
        return "fallback"
    text = BeautifulSoup(html, "html.parser").get_text(" ", strip=True).lower()
    token = name_token(item["name"])
    if token and token not in text:
        return "fallback"
    item["sourceOk"] = True
    ranges = extract_ranges(html)
    stages = item["stages"]
    if len(ranges) >= 2 and len(stages) >= 2:
        (a1, b1), (a2, b2) = ranges[0], ranges[1]
        if b1 < a2:
            stages[0]["start"], stages[0]["end"] = a1.isoformat(), b1.isoformat()
            stages[1]["start"], stages[1]["end"] = a2.isoformat(), b2.isoformat()
            item["datesVerified"] = True
            return "verified"
    return "ok"


def validate(doc):
    if not isinstance(doc, dict) or not isinstance(doc.get("items"), list) or not doc["items"]:
        raise ValueError("пустой или повреждённый каталог")
    meta = doc.get("meta")
    if not isinstance(meta, dict) or not meta.get("updatedAt"):
        raise ValueError("нет meta.updatedAt")
    ids = set()
    for it in doc["items"]:
        if not SLUG_RE.match(it.get("id", "")) or it["id"] in ids:
            raise ValueError(f"некорректный id: {it.get('id')}")
        ids.add(it["id"])
        if not clean(it.get("name", "")) or not clean(it.get("organizer", "")):
            raise ValueError(f"пустое имя/организатор: {it['id']}")
        if it.get("level") not in (1, 2, 3):
            raise ValueError(f"уровень вне I–III: {it['id']}")
        if not str(it.get("url", "")).startswith("https://"):
            raise ValueError(f"ссылка не https: {it['id']}")
        g = it.get("grades")
        if not isinstance(g, list) or not g or not all(isinstance(x, int) and 5 <= x <= 11 for x in g):
            raise ValueError(f"классы вне 5–11: {it['id']}")
        s = it.get("subjects")
        if not isinstance(s, list) or not s or not all(isinstance(x, str) and x.strip() for x in s):
            raise ValueError(f"пустые предметы: {it['id']}")
        st = it.get("stages")
        if not isinstance(st, list) or not st:
            raise ValueError(f"нет этапов: {it['id']}")
        for stage in st:
            a, b = stage.get("start", ""), stage.get("end", "")
            if not ISO_RE.match(a) or not ISO_RE.match(b):
                raise ValueError(f"даты не ISO: {it['id']}")
            da, db = date.fromisoformat(a), date.fromisoformat(b)
            if da > db or not (SEASON_START <= da and db <= SEASON_END):
                raise ValueError(f"даты вне сезона: {it['id']} / {stage.get('name')}")


def main():
    if not DATA.exists():
        print("::error::data/olimpiads.json отсутствует — нечего обновлять")
        sys.exit(1)
    doc = json.loads(DATA.read_text(encoding="utf-8"))
    stats = {"verified": 0, "ok": 0, "fallback": 0}
    for it in doc["items"]:
        it["name"] = clean(it["name"], 120)
        it["organizer"] = clean(it["organizer"], 120)
        it["subjects"] = [clean(s, 40) for s in it["subjects"]]
        result = refresh(it)
        stats[result] += 1
        print(f"[{result}] {it['id']}")
        time.sleep(PAUSE)
    meta = doc["meta"]
    meta["updatedAt"] = datetime.now().strftime("%Y-%m-%dT%H:%M:%S")
    meta["cycleHours"] = 12
    meta["verified"] = stats["verified"]
    meta["okCount"] = stats["ok"] + stats["verified"]
    meta["fallbackCount"] = stats["fallback"]
    meta["source"] = "rsosh.ru и сайты олимпиад"
    try:
        validate(doc)
    except ValueError as e:
        print(f"::error::валидация не пройдена: {e} — файл не записан")
        sys.exit(1)
    tmp = DATA.with_suffix(".tmp")
    tmp.write_text(json.dumps(doc, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(DATA)
    print(f"готово: проверено дат {stats['verified']}, источник жив {stats['ok'] + stats['verified']}, "
          f"резерв {stats['fallback']} из {len(doc['items'])}")


if __name__ == "__main__":
    main()
