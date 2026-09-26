#!/usr/bin/env python3
"""마산역 기준 KTX 운임표 생성기.

입력 : data/source/KTX 운임표 (202609기준).xls  (KORAIL 배포본)
출력 : data/ktx_fares_masan.json                 (표에 있는 전 구간)

경로 선정 규칙 (이 순서로 고정)
  1) 운임표에 직통 구간이 있으면 무조건 직통 운임을 쓴다.
     (구간을 쪼개면 합계가 싸지는 경우가 있으나 실제로 살 수 없는 표다)
  2) 직통이 없으면 환승 횟수가 가장 적은 경로.
  3) 환승 횟수가 같으면 운임 합계가 가장 싼 경로.
환승 운임은 구간 운임 단순 합계이며 환승할인은 반영하지 않는다.
"""
import json, heapq, re, sys
from pathlib import Path
import xlrd

APP    = Path(__file__).resolve().parent.parent
SRC    = next(p for p in (APP / 'data' / 'source').iterdir() if p.suffix == '.xls')
ORIGIN = '마산'


def parse():
    """(역A,역B) -> 일반실 운임 / 특실 계. 같은 구간이 여러 시트에 있으면 최고운임."""
    wb = xlrd.open_workbook(str(SRC))
    normal, first = {}, {}
    for sh in wb.sheets():
        hdr = col = None
        for r in range(min(12, sh.nrows)):
            vals = [str(sh.cell_value(r, c)).replace(' ', '') for c in range(sh.ncols)]
            if '구간' in vals:
                hdr, col = r, vals.index('구간')
                break
        if hdr is None:
            print(f'  ! 머리글 없음: {sh.name}', file=sys.stderr)
            continue
        # 특실 '계' 열 — '우등실'만 있는 시트는 특실 없음으로 둔다
        first_col = None
        for r in range(hdr, min(hdr + 4, sh.nrows)):
            vals = [str(sh.cell_value(r, c)).replace(' ', '') for c in range(sh.ncols)]
            if '특실' in vals and r + 1 < sh.nrows:
                sub = [str(sh.cell_value(r + 1, c)).replace(' ', '') for c in range(sh.ncols)]
                for c in range(vals.index('특실'), sh.ncols):
                    if sub[c] == '계':
                        first_col = c
                        break
                break
        for r in range(hdr + 1, sh.nrows):
            a = str(sh.cell_value(r, col)).strip()
            b = str(sh.cell_value(r, col + 1)).strip()
            if not a or not b:
                continue
            fare = None
            for c in range(col + 2, sh.ncols):
                v = sh.cell_value(r, c)
                if isinstance(v, float) and v > 0:
                    fare = int(v)
                    break
            if fare is None:
                continue
            k = tuple(sorted((a, b)))
            normal[k] = max(normal.get(k, 0), fare)
            if first_col is not None:
                v = sh.cell_value(r, first_col)
                if isinstance(v, float) and v > 0:
                    first[k] = max(first.get(k, 0), int(v))
    return normal, first


def routes(normal):
    adj = {}
    for (a, b), f in normal.items():
        adj.setdefault(a, []).append((b, f))
        adj.setdefault(b, []).append((a, f))
    best = {ORIGIN: (0, 0)}          # 역 -> (구간수, 운임합) 사전순 최소
    prev, pq = {}, [(0, 0, ORIGIN)]
    while pq:
        legs, cost, u = heapq.heappop(pq)
        if (legs, cost) > best.get(u, (99, 10 ** 9)):
            continue
        for v, w in adj.get(u, []):
            cand = (legs + 1, cost + w)
            if cand < best.get(v, (99, 10 ** 9)):
                best[v], prev[v] = cand, u
                heapq.heappush(pq, (*cand, v))
    out = []
    for st, (legs, cost) in best.items():
        if st == ORIGIN:
            continue
        direct = normal.get(tuple(sorted((ORIGIN, st))))
        if direct is not None:                      # 규칙 1 — 직통 우선
            path, cost = [ORIGIN, st], direct
        else:
            path = [st]
            while path[-1] != ORIGIN:
                path.append(prev[path[-1]])
            path.reverse()
        out.append({'station': st, 'direct': direct, 'oneWay': cost,
                    'transfers': len(path) - 2, 'path': path})
    out.sort(key=lambda x: (x['oneWay'], x['station']))
    return out


def first_class(path, first):
    """특실 편도(운임+요금 계). 한 구간이라도 특실 표가 없으면 None."""
    total = 0
    for a, b in zip(path, path[1:]):
        v = first.get(tuple(sorted((a, b))))
        if v is None:
            return None
        total += v
    return total


def build():
    normal, first = parse()
    rs = routes(normal)
    for r in rs:
        r['oneWayFirst']    = first_class(r['path'], first)
        r['roundTrip']      = r['oneWay'] * 2
        r['roundTripFirst'] = r['oneWayFirst'] * 2 if r['oneWayFirst'] else None
    doc = {
        'origin': ORIGIN,
        'basis': f'{SRC.name} — 구간 중복 시 최고운임 적용',
        'rule': '직통 우선 → 직통 없으면 환승 최소 → 같으면 최저운임. 환승할인 미반영.',
        'classes': {'normal': '일반실 운임',
                    'first': '특실 운임+요금 계 (표에 특실이 없는 구간은 null)'},
        'updatedAt': '2026-09-24',
        'pairCount': len(normal),
        'stationCount': len(rs),
        'fares': rs,
    }
    (APP / 'data' / 'ktx_fares_masan.json').write_text(
        json.dumps(doc, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(f'ktx_fares_masan.json — 구간 {len(normal)}개 / 역 {len(rs)}개')
    return doc



# ── 3. 앱이 쓰는 fareTable 생성 ─────────────────────────────────────────────
# 앱은 공문에서 뽑은 '지역'(REGION_MAP 출력값)으로 운임을 찾는다. 지역 → 역 대응만
# 여기서 고정하고 금액은 전부 운임표에서 가져온다. 버스·제주 행은 운임표 대상이
# 아니므로(여비규정 판단) 손대지 않고 그대로 둔다. 순서 = 키워드 우선순위이므로
# '해운대'가 '대구'에 걸리지 않도록 부산 행이 대구 행보다 앞에 있어야 한다.
REGION_TO_STATION = [
    (['서울'],         '서울역',    '서울'),
    (['수서'],         '수서역',    '수서'),
    (['수원'],         '수원역',    '수원'),
    (['천안', '아산'], '천안아산역', '천안아산'),
    (['오송'],         '오송역',    '오송'),
    (['대전'],         '대전역',    '대전'),
    (['부산', '해운대'], '부산',    None),   # 시외버스
    (['대구'],         '동대구역',  '동대구'),
    (['울산'],         '울산',      None),   # 시외버스
    (['경주'],         '경주역',    '경주'),
    (['전주'],         '전주',      None),   # 시외버스
    (['제주'],         '제주',      None),   # 항공
]
KEEP = {                       # 운임표 대상이 아닌 행 — 기존 값 유지
    '부산': {'bus': 19600},
    '울산': {'bus': 29000},
    '전주': {'bus': 46000},
    '제주': {'jeju': True},
}


def fare_table(doc):
    m = {f['station']: f for f in doc['fares']}
    rows = []
    for kws, label, station in REGION_TO_STATION:
        row = {'keywords': kws, 'label': label}
        if station is None:
            row.update(KEEP[label])
        else:
            f = m[station]
            row['station']      = station
            row['ktxNormal']    = f['roundTrip']
            if f['roundTripFirst']:
                row['ktxFirst'] = f['roundTripFirst']
            row['oneWayNormal'] = f['oneWay']
            if f['oneWayFirst']:
                row['oneWayFirst'] = f['oneWayFirst']
            row['transfers']    = f['transfers']
            row['path']         = f['path']
        rows.append(row)
    return rows


def js_literal(rows):
    out = []
    for r in rows:
        parts = [f"keywords: [{', '.join(repr(k).replace(chr(39), chr(39)) for k in r['keywords'])}]",
                 f"label: '{r['label']}'"]
        for k in ('station', 'ktxNormal', 'ktxFirst', 'oneWayNormal', 'oneWayFirst',
                  'transfers', 'bus'):
            if k in r:
                parts.append(f"{k}: {r[k] if not isinstance(r[k], str) else repr(r[k])}")
        if 'path' in r:
            parts.append('path: [' + ', '.join(f"'{s}'" for s in r['path']) + ']')
        if r.get('jeju'):
            parts.append('jeju: true')
        out.append('  { ' + ', '.join(parts).replace('"', "'") + ' },')
    return '\n'.join(out)


def patch_js(path, rows, open_mark, close_mark):
    src = Path(path).read_text(encoding='utf-8')
    body = js_literal(rows)
    new = re.sub(re.escape(open_mark) + r'.*?' + re.escape(close_mark),
                 open_mark + '\n' + body + '\n' + close_mark, src, flags=re.S)
    if open_mark not in src or close_mark not in src:
        raise SystemExit(f'!! 마커를 못 찾았다: {path}')
    if new == src:
        print(f'{path} — 변경 없음 (이미 최신)')
        return
    Path(path).write_text(new, encoding='utf-8')
    print(f'{path} — fareTable {len(rows)}행 갱신')


def write_rates(rows):
    p = APP / 'data' / 'rates.json'
    d = json.loads(p.read_text(encoding='utf-8'))
    d['fareTable'] = rows
    d['fareBasis'] = SRC.name
    d['updatedAt'] = '2026-09-24'
    p.write_text(json.dumps(d, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(f'data/rates.json — fareTable {len(rows)}행 갱신')


if __name__ == '__main__':
    doc = build()
    rows = fare_table(doc)
    write_rates(rows)
    patch_js('src/app.js',   rows, '// <fare-table:auto>', '// </fare-table:auto>')
    patch_js('src/admin.js', rows, '// <fare-table:auto>', '// </fare-table:auto>')
