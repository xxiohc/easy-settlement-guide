// 서울시 대중교통환승경로 중계(api/transit.js) 검증 — 실제 키 없이 응답 모양만 고정한다.
const test = require('node:test')
const assert = require('node:assert')
const api = require('../api/transit.js')

const seoulStation = { lat: 37.554069, lon: 126.970703 }
const hospital = { lat: 37.5684, lon: 126.9677 }
const P = { sx: seoulStation.lon, sy: seoulStation.lat, ex: hospital.lon, ey: hospital.lat }
const fakeFetch = body => async () => ({ text: async () => JSON.stringify(body) })

const ok = {
  msgHeader: { headerCd: '0', headerMsg: '정상적으로 처리되었습니다.' },
  msgBody: { itemList: [
    { distance: '4200', time: '22', pathList: { fname: '서울역', fx: '126.9723', fy: '37.5546', routeNm: '172', tname: '서울역사박물관', tx: '126.9690', ty: '37.5699' } },
    { distance: '3900', time: '12', pathList: [
      { fname: '서울역', fx: '126.9723', fy: '37.5546', routeNm: '1호선', tname: '시청', tx: '126.9772', ty: '37.5657' },
      { fname: '시청', fx: '126.9772', fy: '37.5657', routeNm: '2호선', tname: '충정로', tx: '126.9637', ty: '37.5597' },
    ] },
  ] },
}

test('가장 짧은 경로를 고르고 역·현장 도보를 더한다', async () => {
  const r = await api.lookup(P, 'KEY', fakeFetch(ok))
  assert.equal(r.rideMin, 12)
  assert.ok(r.walkMin >= 1)
  assert.equal(r.min, r.rideMin + r.walkMin)
  assert.equal(r.steps.filter(s => s.kind === '지하철').length, 2)
  assert.match(r.steps.map(s => s.text).join(' | '), /1호선 서울역 → 시청/)
})

test('pathList 가 하나뿐이어도(객체) 읽고 버스는 번호로 표시한다', () => {
  const r = api.summarize([ok.msgBody.itemList[0]], seoulStation, hospital)
  assert.match(r.steps.map(s => s.text).join(' '), /172번 버스/)
})

test('결과 없음(headerCd 4)은 null — 화면은 추정으로 남는다', async () => {
  assert.equal(await api.lookup(P, 'KEY', fakeFetch({ msgHeader: { headerCd: '4', headerMsg: '결과가 없습니다.' } })), null)
})

test('키 오류는 예외로 돌려준다', async () => {
  await assert.rejects(api.lookup(P, 'BAD', fakeFetch({ error: 'Unauthorized', message: '등록되지 않은 서비스키', status: 401 })), /서비스키/)
})

test('좌표가 없으면 400, 키가 없으면 503', async () => {
  const run = async (url, key) => {
    const saved = process.env.TAGO_SERVICE_KEY
    if (key) process.env.TAGO_SERVICE_KEY = key; else delete process.env.TAGO_SERVICE_KEY
    const res = { setHeader() {}, end(b) { this.body = JSON.parse(b) } }
    await api({ url }, res)
    if (saved) process.env.TAGO_SERVICE_KEY = saved; else delete process.env.TAGO_SERVICE_KEY
    return res
  }
  assert.equal((await run('/api/transit?sx=1', 'k')).statusCode, 400)
  assert.equal((await run('/api/transit?sx=1&sy=2&ex=3&ey=4')).statusCode, 503)
})
