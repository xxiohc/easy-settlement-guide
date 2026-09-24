const fs = require('fs')
const R = require('../src/route.js')

R.KtxRoute.timetable = JSON.parse(fs.readFileSync('data/ktx_timetable.json', 'utf8'))
R.KtxRoute.stations  = JSON.parse(fs.readFileSync('data/ktx_stations.json', 'utf8')).stations
R.KtxRoute.fares = Object.fromEntries(
  JSON.parse(fs.readFileSync('data/ktx_fares_masan.json', 'utf8')).fares.map(f => [f.station, f]))
R.KtxRoute.ready = true

const show = p => {
  if (!p.ok) return console.log('  실패:', p.reason, p.candidates || p.originKm || '')
  const b = p.best
  console.log(`  도착역 ${b.station} (직선 ${b.stationKm}km, 접근 ${b.access}분) 환승 ${b.transfers}회`)
  b.legs.forEach(l => console.log(`   · ${l.no} ${l.type} ${l.from} ${R.fmtTime(l.dep)} → ${l.to} ${R.fmtTime(l.arr)} [${l.note}]`))
  console.log(`   총 ${R.fmtDur(b.totalMin)}, 여유 ${b.slack}분, 편도 ${b.fare && b.fare.oneWay}원 (${b.fare && b.fare.grade})`)
  if (p.ret) console.log(`   귀가: ${p.ret.leg ? `${p.ret.leg.no} ${b.station} ${R.fmtTime(p.ret.leg.dep)} → 마산 ${R.fmtTime(p.ret.leg.arr)}` : '당일 편 없음'}`)
  p.alternatives.forEach(a => console.log(`   대안: ${a.station} ${a.legs[0].no} 마산 ${R.fmtTime(a.dep)} → ${R.fmtTime(a.arr)} 환승${a.transfers} 여유${a.slack}분`))
}

const cases = [
  ['서울지방국세청 14:00 (목)', 37.574103, 126.979968, 14*60, 3, 17*60],
  ['서울지방국세청 09:30 (목)', 37.574103, 126.979968, 9*60+30, 3, null],
  ['국세청(세종) 14:00 (목)', 36.504119, 127.264172, 14*60, 3, null],
  ['부산시청 14:00 (목)', 35.179554, 129.075642, 14*60, 3, null],
  ['대한간호협회(서울 중구) 13:00 (토)', 37.5657, 126.9769, 13*60, 5, null],
  ['삼성서울병원 14:00 (목)', 37.488387, 127.085305, 14*60, 3, null],
  ['창원시청 14:00 (목)', 35.227637, 128.681877, 14*60, 3, null],
]
for (const [label, lat, lon, start, dow, end] of cases) {
  console.log('■', label)
  show(R.planTrip({ lat, lon, startMin: start, dow, isMS: false, endMin: end }))
}
