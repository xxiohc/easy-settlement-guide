// 공문 AI 판독 — Claude가 PDF·이미지 원본을 직접 읽고 항목마다 근거 문장과 함께 값을 돌려준다.
// 화면(src/app.js)은 이 결과를 규칙 판독(parseDocMeta)과 대조해, 금액에 영향을 주는 항목은
// 둘이 같을 때만 자동으로 채운다. 키(ANTHROPIC_API_KEY)는 서버 환경변수에만 둔다.
const sdk = require('@anthropic-ai/sdk')
const Anthropic = sdk.default || sdk

const MODEL = 'claude-opus-5'
// Vercel 함수 요청 본문 한도(4.5MB) 안에서 base64 로 부풀어도 들어가는 원본 크기
const MAX_BYTES = 3 * 1024 * 1024
const MEDIA_TYPES = new Set(['application/pdf', 'image/png', 'image/jpeg', 'image/webp'])

const field = (type, description) => ({
  type: 'object',
  properties: {
    value: { type: [type, 'null'], description },
    quote: { type: ['string', 'null'], description: '값의 근거가 된 공문 속 문장을 글자 그대로. 값이 null 이면 null' },
  },
  required: ['value', 'quote'],
  additionalProperties: false,
})

const SCHEMA = {
  type: 'object',
  properties: {
    docKind: {
      type: 'string',
      enum: ['notice', 'trip-form', 'receipt', 'other'],
      description: 'notice=교육·행사·출장 안내 공문, trip-form=결재된 출장신청서, receipt=영수증·매출전표·세금계산서, other=그 밖',
    },
    title: field('string', '교육·행사명(공문 제목에서 발신 명의 제외)'),
    startDate: field('string', '교육 첫날 YYYY-MM-DD'),
    endDate: field('string', '교육 마지막 날 YYYY-MM-DD'),
    startTime: field('string', '첫날 교육(또는 등록) 시작시각 HH:MM, 24시간제'),
    venue: field('string', '교육 장소(건물·기관명, 주소가 함께 적혀 있으면 괄호로)'),
    registrationFee: field('integer', '1인 등록비(원). 회원·사전납입 기준, 수강료·식비가 나뉘어 있으면 합계'),
    isOnline: field('boolean', '온라인(비대면) 교육이면 true'),
    multiSession: field('boolean', '1차·2차처럼 같은 교육이 여러 날짜·장소로 나뉘어 열리면 true'),
  },
  required: ['docKind', 'title', 'startDate', 'endDate', 'startTime', 'venue', 'registrationFee', 'isOnline', 'multiSession'],
  additionalProperties: false,
}

const SYSTEM = `당신은 병원 경영지원팀의 교육·출장 정산 도우미입니다. 첨부된 문서에서 정산에 필요한 값을 뽑습니다.
틀린 값은 정산 금액을 틀리게 만들므로, 문서에 분명히 적힌 것만 채우고 조금이라도 불확실하면 null 로 둡니다.
- 교육일이 아닌 날짜는 쓰지 않습니다: 시행일자·문서 발송일, 신청·접수·사전등록·납부·입금·취소 기간, "○○ 기준" 날짜.
- 연도가 적혀 있지 않은 날짜는 연도를 추측하지 말고 null 로 둡니다.
- 1차·2차처럼 차수가 나뉘면 1차의 날짜·장소를 쓰고 multiSession 을 true 로 합니다.
- 시작시각은 첫날 교육(등록 포함)이 시작하는 시각입니다. 문서에 없으면 null 입니다. 사전등록 마감시각 같은 다른 시각을 쓰지 않습니다.
- 등록비는 회원·사전납입 기준 1인 금액입니다. 금액이 없으면 null 입니다.
- quote 에는 값의 근거가 된 문서 속 문장을 고치지 말고 그대로 옮깁니다.`

async function extractWithClaude({ data, mediaType }, client) {
  const source = { type: 'base64', media_type: mediaType, data }
  const block = mediaType === 'application/pdf' ? { type: 'document', source } : { type: 'image', source }
  const response = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system: SYSTEM,
    output_config: { format: { type: 'json_schema', schema: SCHEMA } },
    messages: [{ role: 'user', content: [block, { type: 'text', text: '이 문서에서 값을 뽑아 주세요.' }] }],
  })
  if (response.stop_reason === 'refusal') throw new Error('AI가 이 문서의 판독을 거절했습니다')
  if (response.stop_reason === 'max_tokens') throw new Error('AI 응답이 길이 한도에서 끊겼습니다')
  const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('')
  return { model: response.model, fields: JSON.parse(text) }
}

function readBody(req) {
  if (req.body && typeof req.body === 'object') return Promise.resolve(req.body)
  return new Promise((resolve, reject) => {
    let raw = ''
    req.on('data', c => { raw += c })
    req.on('end', () => { try { resolve(JSON.parse(raw || '{}')) } catch (e) { reject(e) } })
    req.on('error', reject)
  })
}

module.exports = async function handler(req, res) {
  res.setHeader('content-type', 'application/json; charset=utf-8')
  const send = (status, body) => { res.statusCode = status; res.end(JSON.stringify(body)) }
  if (req.method !== 'POST') return send(405, { ok: false, error: 'POST 만 받습니다' })
  if (!process.env.ANTHROPIC_API_KEY) return send(503, { ok: false, error: 'AI 판독 키가 설정되지 않았습니다' })

  let body
  try { body = await readBody(req) } catch { return send(400, { ok: false, error: '요청 본문을 읽지 못했습니다' }) }
  const { data, mediaType } = body || {}
  if (!MEDIA_TYPES.has(mediaType) || typeof data !== 'string') return send(400, { ok: false, error: 'PDF·PNG·JPG 파일만 판독합니다' })
  if (data.length * 3 / 4 > MAX_BYTES) return send(413, { ok: false, error: '파일이 커서 AI 판독을 건너뜁니다' })

  try {
    const out = await extractWithClaude({ data, mediaType }, new Anthropic())
    send(200, { ok: true, ...out })
  } catch (e) {
    send(502, { ok: false, error: e.message })
  }
}

module.exports.extractWithClaude = extractWithClaude
module.exports.SCHEMA = SCHEMA
