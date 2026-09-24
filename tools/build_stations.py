#!/usr/bin/env python3
"""시간표에 나오는 역의 좌표를 카카오 로컬 API로 한 번만 받아 data/ktx_stations.json 으로 굳힌다.

굳힌 뒤에는 앱이 이 JSON만 읽으므로 실행 환경·API 키와 무관하게 같은 결과가 나온다.
"""
import json, re, subprocess, time, urllib.parse
from pathlib import Path

APP = Path(__file__).resolve().parent.parent
KEY = re.search(r"'([^']+)'", (APP / "src" / "config.js").read_text()).group(1)
TT = json.loads((APP / "data" / "ktx_timetable.json").read_text(encoding="utf-8"))
OUT = APP / "data" / "ktx_stations.json"

QUERY_FIX = {
    "김천구미": "김천구미역", "진부(오대산)": "진부역 강원", "판교(경기)": "판교역 경기 성남",
    "경주": "경주역 경상북도 경주시", "센텀": "센텀역 부산", "부전": "부전역 부산진구",
    "물금": "물금역 양산", "서울": "서울역 중구", "대전": "대전역 동구",
    "공주": "공주역 충청남도", "남창": "남창역 울산", "영덕": "영덕역 경상북도",
    "울진": "울진역 경상북도", "살미": "살미역 충주", "연풍": "연풍역 괴산",
    "수안보온천": "수안보온천역", "앙성온천": "앙성온천역", "감곡장호원": "감곡장호원역",
    "가남": "가남역 여주", "부발": "부발역 이천", "상봉": "상봉역 중랑구",
    "덕소": "덕소역 남양주", "양평": "양평역 경기", "광명": "광명역 광명시",
}


def search(q):
    url = "https://dapi.kakao.com/v2/local/search/keyword.json?query=" + urllib.parse.quote(q) + "&size=10"
    raw = subprocess.run(["curl", "-s", "-H", f"Authorization: KakaoAK {KEY}", url],
                         capture_output=True, text=True, timeout=20).stdout
    return json.loads(raw).get("documents", [])


def pick(name):
    q = QUERY_FIX.get(name, name + "역")
    for doc in search(q):
        cat = doc.get("category_name", "")
        if "기차역" in cat or "KTX" in cat or "고속철도" in cat:
            return doc
    for doc in search(q):
        if "지하철" not in doc.get("category_name", ""):
            return doc
    return None


def main():
    result = {}
    for name in TT["stations"]:
        doc = pick(name)
        if not doc:
            print("  !! 좌표 없음:", name)
            continue
        result[name] = {
            "lat": round(float(doc["y"]), 6),
            "lon": round(float(doc["x"]), 6),
            "matched": doc["place_name"],
            "addr": doc.get("road_address_name") or doc.get("address_name", ""),
        }
        time.sleep(0.05)
    OUT.write_text(json.dumps({
        "note": "카카오 로컬 검색으로 1회 수집해 고정한 KTX 정차역 좌표",
        "count": len(result),
        "stations": result,
    }, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"역 {len(result)}개 좌표 저장 → {OUT}")


main()
