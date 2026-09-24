#!/usr/bin/env python3
"""병원 출장이 잦은 기관의 좌표를 카카오 로컬 API로 한 번만 받아 data/destinations.json 으로 굳힌다.

굳힌 뒤에는 앱이 이 JSON만 읽으므로, 페이지를 공유받은 사람도 같은 결과를 본다.
좌표는 카카오 검색 결과(사실)이고, 역→기관 접근시간은 별도 필드(accessOverride)에 사람이
확인한 값만 넣는다. 비어 있으면 앱이 거리 기반 추정값을 쓰고 화면에 '추정'이라고 밝힌다.
"""
import json, re, subprocess, urllib.parse
from pathlib import Path

APP = Path(__file__).resolve().parent.parent
KEY = re.search(r"'([^']+)'", (APP / "src" / "config.js").read_text()).group(1)
OUT = APP / "data" / "destinations.json"

# (등재명, 카카오 검색어, 별칭들) — 별칭은 공문에서 흔히 쓰는 표기
TARGETS = [
    ("삼성서울병원", "삼성서울병원", ["삼성서울병원", "SMC", "일원동 삼성서울병원"]),
    ("서울지방국세청", "서울지방국세청", ["서울지방국세청", "서울국세청"]),
    ("국세청", "국세청 세종", ["국세청", "세종 국세청"]),
    ("국민건강보험공단", "국민건강보험공단 원주 본부", ["국민건강보험공단", "건보공단", "건강보험공단"]),
    ("건강보험심사평가원", "건강보험심사평가원 원주", ["건강보험심사평가원", "심평원", "HIRA"]),
    ("보건복지부", "보건복지부", ["보건복지부", "복지부"]),
    ("기획재정부", "기획재정부", ["기획재정부", "기재부"]),
    ("질병관리청", "질병관리청", ["질병관리청", "질병청"]),
    ("한국보건산업진흥원", "한국보건산업진흥원", ["한국보건산업진흥원", "보산진"]),
    ("한국보건복지인재원", "한국보건복지인재원", ["한국보건복지인재원", "보건복지인재원"]),
    ("대한병원협회", "대한병원협회", ["대한병원협회", "병협"]),
    ("국민연금공단", "국민연금공단 전주 본부", ["국민연금공단", "연금공단"]),
    ("감사원", "감사원", ["감사원"]),
    ("한국조세재정연구원", "한국조세재정연구원", ["한국조세재정연구원", "조세연"]),
    ("한국공인회계사회", "한국공인회계사회", ["한국공인회계사회", "한공회"]),
    ("대한상공회의소", "대한상공회의소", ["대한상공회의소", "상의"]),
    ("국립중앙의료원", "국립중앙의료원", ["국립중앙의료원", "NMC"]),
    ("서울대학교병원", "서울대학교병원 종로", ["서울대학교병원", "서울대병원"]),
    ("성균관대학교 자연과학캠퍼스", "성균관대학교 자연과학캠퍼스", ["성균관대학교 자연과학캠퍼스", "성대 수원캠퍼스"]),
    ("삼성창원병원", "삼성창원병원", ["삼성창원병원"]),
]


def search(q):
    url = "https://dapi.kakao.com/v2/local/search/keyword.json?query=" + urllib.parse.quote(q) + "&size=5"
    raw = subprocess.run(["curl", "-s", "-H", f"Authorization: KakaoAK {KEY}", url],
                         capture_output=True, text=True, timeout=20).stdout
    return json.loads(raw).get("documents", [])


def main():
    prev = {}
    if OUT.exists():
        prev = {d["name"]: d for d in json.loads(OUT.read_text(encoding="utf-8"))["destinations"]}

    rows = []
    for name, query, aliases in TARGETS:
        docs = search(query)
        if not docs:
            print(f"!! 검색 실패: {name}")
            continue
        d = docs[0]
        row = {
            "name": name,
            "aliases": aliases,
            "lat": round(float(d["y"]), 6),
            "lon": round(float(d["x"]), 6),
            "matched": d["place_name"],
            "addr": d.get("road_address_name") or d.get("address_name"),
            # 역→기관 대중교통 소요시간(분). 사람이 실제로 확인한 값만 넣는다.
            "accessOverride": prev.get(name, {}).get("accessOverride", {}),
        }
        rows.append(row)
        print(f"{name:22s} {row['matched']:24s} {row['lat']},{row['lon']}  {row['addr']}")

    OUT.write_text(json.dumps({
        "note": "카카오 로컬 검색으로 1회 수집해 고정한 출장 빈발 기관 좌표. "
                "accessOverride는 역명→분(실제 확인값)이며, 비어 있으면 앱이 거리 기반 추정을 쓴다.",
        "count": len(rows),
        "destinations": rows,
    }, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"\n→ {OUT} ({len(rows)}곳)")


if __name__ == "__main__":
    main()
