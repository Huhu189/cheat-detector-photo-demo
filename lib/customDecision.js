import { getClassHead, marker, normalizeLabel } from './calibration.js'

// ---------------------------------------------------------------------------
// Keputusan akhir detektor objek (HP / buku / layar / tulisan tangan).
//
// Perilaku dasar file ini tetap sama dengan versi sebelumnya (dibuktikan lewat
// uji kesetaraan acak lama-vs-baru saat refactor; regresi spesifiknya ada di
// npm_test/customDecision.rules.test.js). Yang berubah:
//   - ~13 blok `if` veto menjadi tabel REJECTION_RULES (tiap aturan bernama);
//   - indeks ajaib finalProfile[n] menjadi nama (finalGate());
//   - logika "buku vs tulisan_tangan per head" yang ditulis 2x jadi 1 fungsi;
//   - veto baru paper_dark_ink_heavy untuk menekan false positive buku/tulisan.
//
// Semua aturan di REJECTION_RULES adalah veto murni: satu saja cocok = tolak.
// Jadi URUTAN aturan tidak berpengaruh pada hasil.
// ---------------------------------------------------------------------------

const num = value => Number(value || 0)

// Operator kondisi. Hanya hint/prototype yang dinormalisasi seperti kode lama
// (Number(x || 0)); rawScore/visualScore dibiarkan apa adanya agar `undefined`
// tidak berubah menjadi 0 dan memicu veto yang sebelumnya tidak pernah terjadi.
const OPS = {
  is:     (v, x) => v === x,
  truthy: v => Boolean(v),
  falsy:  v => !v,
  gt:     (v, x) => v > x,
  gte:    (v, x) => v >= x,
  lt:     (v, x) => v < x,
  lte:    (v, x) => v <= x,
}

function operand(item, field) {
  if (field.startsWith('hint') || field.startsWith('prototype')) return num(item[field])
  return item[field]
}

// conds: [[field, op, nilai?], ...] - semua harus terpenuhi agar aturan cocok.
function rule(id, why, conds) {
  return { id, why, conds }
}

function matches(item, { conds }) {
  for (const [field, op, value] of conds) {
    if (!OPS[op](operand(item, field), value)) return false
  }
  return true
}

const ELEKTRONIK = ['classHead', 'is', 'elektronik']
const BUKU_CATATAN = ['classHead', 'is', 'buku_catatan']

export const REJECTION_RULES = [
  rule('hard_negative_prototype',
    'Mirip contoh negatif keras di kalibrasi dan tidak ada rescue yang membatalkan.', [
      ['brightTextRescue', 'falsy'],
      ['textScreenshotRescue', 'falsy'],
      ['largeLaptopScreenRescue', 'falsy'],
      ['paperBookRescue', 'falsy'],
      ['prototypeHardNegative', 'gte', 0.96],
    ]),
  // Catatan: syarat relasional (hardNegative >= labelScore + 0.0005) tidak bisa
  // dinyatakan sebagai kondisi tunggal; ditangani di isHardNegativeVeto().

  rule('layar_weak_prototype',
    'Layar yang hanya diangkat prototype, skor mentah rendah, tanpa petunjuk layar/HP.', [
      ELEKTRONIK, ['label', 'is', 'layar'], ['prototypeBoosted', 'truthy'],
      ['largeLaptopScreenRescue', 'falsy'], ['rawScore', 'lt', 0.75],
      ['hintCoolScreen', 'lt', 0.12], ['hintPhoneObject', 'lt', 0.2], ['hintFullDarkScreen', 'lt', 0.2],
    ]),

  rule('electronics_mirror_reflection',
    'Pantulan cermin/kaca terbaca sebagai elektronik.', [
      ELEKTRONIK, ['hintMirrorReflection', 'gte', 0.8], ['hintPhoneObject', 'lt', 0.48],
      ['hintFullDarkScreen', 'lt', 0.42], ['rawScore', 'gte', 0.62], ['rawScore', 'lt', 0.86],
    ]),

  rule('layar_skin_bright_blob',
    'Raw "layar" lemah, area kulit + terang sedang (kemungkinan wajah/tangan).', [
      ELEKTRONIK, ['rawLabel', 'is', 'layar'], ['rawScore', 'lt', 0.72],
      ['hintCoolScreen', 'lte', 0], ['hintFullDarkScreen', 'lte', 0],
      ['hintSkinRatio', 'gt', 0.34], ['hintBrightRatio', 'gt', 0.34], ['hintBrightRatio', 'lt', 0.56],
      ['hintPhoneObject', 'lt', 0.5],
    ]),

  rule('hp_raw_skin_bright_blob',
    'Raw "hp" sangat lemah, ada kulit, terang sedang, tidak jenuh.', [
      ELEKTRONIK, ['rawLabel', 'is', 'hp'], ['rawScore', 'lt', 0.45],
      ['hintCoolScreen', 'lte', 0], ['hintFullDarkScreen', 'lte', 0],
      ['hintSkinRatio', 'gt', 0.18], ['hintBrightRatio', 'gt', 0.5], ['hintBrightRatio', 'lt', 0.66],
      ['hintSaturatedRatio', 'lt', 0.18],
    ]),

  rule('hp_overexposed_no_evidence',
    'HP lemah di frame hampir putih, tanpa kulit/layar/bentuk HP.', [
      ELEKTRONIK, ['label', 'is', 'hp'], ['rawScore', 'lt', 0.55],
      ['hintPhoneObject', 'lte', 0], ['hintSkinRatio', 'lte', 0], ['hintCoolScreen', 'lte', 0],
      ['hintBrightRatio', 'gt', 0.9], ['hintSaturatedRatio', 'lt', 0.02],
    ]),

  rule('hp_weak_prototype_skin',
    'HP yang hanya diangkat prototype, skor rendah, banyak kulit.', [
      ELEKTRONIK, ['label', 'is', 'hp'], ['prototypeBoosted', 'truthy'], ['rawScore', 'lt', 0.62],
      ['hintPhoneObject', 'lt', 0.2], ['hintSkinRatio', 'gt', 0.38],
    ]),

  rule('handwriting_bright_low_ink',
    'Tulisan tangan hanya diangkat prototype di area terang dengan sedikit tinta.', [
      BUKU_CATATAN, ['rawLabel', 'is', 'tulisan_tangan'], ['prototypeBoosted', 'truthy'],
      ['brightTextRescue', 'falsy'], ['textScreenshotRescue', 'falsy'],
      ['rawScore', 'lt', 0.78], ['hintBrightRatio', 'gt', 0.35], ['hintInkRatio', 'lt', 0.12],
    ]),

  rule('book_proto_skin_midband',
    'Buku dari prototype, kulit sedang, tanpa HP/layar.', [
      BUKU_CATATAN, ['rawLabel', 'is', 'buku'], ['prototypeBoosted', 'truthy'],
      ['hintPhoneObject', 'lte', 0], ['hintCoolScreen', 'lte', 0],
      ['hintSkinRatio', 'gt', 0.25], ['hintSkinRatio', 'lt', 0.65],
      ['hintBrightRatio', 'gt', 0.1], ['hintInkRatio', 'lt', 0.45],
    ]),

  rule('notes_proto_saturated_skin',
    'Buku/catatan dari prototype, kulit + jenuh tinggi (kemungkinan tangan/kain).', [
      BUKU_CATATAN, ['prototypeBoosted', 'truthy'],
      ['hintPhoneObject', 'lte', 0], ['hintCoolScreen', 'lte', 0],
      ['hintSkinRatio', 'gt', 0.35], ['hintSkinRatio', 'lt', 0.65],
      ['hintSaturatedRatio', 'gt', 0.82],
      ['hintBrightRatio', 'gt', 0.12], ['hintBrightRatio', 'lt', 0.35], ['hintInkRatio', 'lt', 0.35],
    ]),

  rule('notes_proto_dark_inky_skin',
    'Buku/catatan dari prototype, gelap, tinta banyak, ada kulit.', [
      BUKU_CATATAN, ['prototypeBoosted', 'truthy'], ['rawScore', 'lt', 0.7],
      ['hintSkinRatio', 'gt', 0.12], ['hintInkRatio', 'gt', 0.55], ['hintBrightRatio', 'lt', 0.12],
    ]),

  rule('notes_no_proto_skin_midband',
    'Buku/catatan tanpa dukungan visual/prototype, kulit sedang, jenuh.', [
      BUKU_CATATAN, ['prototypeBoosted', 'falsy'], ['paperBookRescue', 'falsy'], ['visualScore', 'lte', 0],
      ['hintPhoneObject', 'lte', 0], ['hintCoolScreen', 'lte', 0],
      ['hintSkinRatio', 'gt', 0.25], ['hintSkinRatio', 'lt', 0.65],
      ['hintSaturatedRatio', 'gt', 0.3],
      ['hintBrightRatio', 'gt', 0.1], ['hintBrightRatio', 'lt', 0.3], ['hintInkRatio', 'lt', 0.45],
    ]),

  rule('notes_no_proto_dark_skin',
    'Buku/catatan tanpa dukungan visual/prototype, dominan kulit gelap.', [
      BUKU_CATATAN, ['prototypeBoosted', 'falsy'], ['visualScore', 'lte', 0],
      ['hintSkinRatio', 'gt', 0.65], ['hintSaturatedRatio', 'gt', 0.55], ['hintBrightRatio', 'lt', 0.05],
    ]),

  rule('paper_dark_ink_heavy',
    'Buku/catatan pada frame gelap dengan tinta dominan dan prototype hard-negative kuat.', [
      BUKU_CATATAN, ['prototypeHardNegative', 'gte', 0.8],
      ['hintInkRatio', 'gte', 0.35], ['hintBrightRatio', 'lte', 0.1],
    ]),
]

// Syarat relasional untuk aturan 'hard_negative_prototype' (dua nilai dibandingkan satu sama lain).
function isHardNegativeVeto(item) {
  const hardNegative = num(item.prototypeHardNegative)
  const labelScore = num(item.prototypeLabelScore)
  return hardNegative >= labelScore + 0.0005
}

// Cek satu aturan veto tertentu (dipakai useObjectDetector.js agar tidak menulis ulang aturannya).
export function isRejectedByRule(id, item) {
  const entry = REJECTION_RULES.find(candidate => candidate.id === id)
  if (!entry || !matches(item, entry)) return false
  if (entry.id === 'hard_negative_prototype' && !isHardNegativeVeto(item)) return false
  return true
}

// Mengembalikan id aturan veto pertama yang cocok, atau null. Berguna untuk
// logging (meta cheat log) supaya kelak bisa dicek aturan mana yang salah.
export function explainRejection(item) {
  for (const entry of REJECTION_RULES) {
    if (!matches(item, entry)) continue
    if (entry.id === 'hard_negative_prototype' && !isHardNegativeVeto(item)) continue
    return entry.id
  }
  return null
}

// Nama untuk indeks marker 'finalGate' (nilai aslinya dari file kalibrasi .bin).
// Indeks 4 juga dipakai di useObjectDetector.js, indeks 7 di imageAnalysis.js.
export function finalGate(calibration) {
  const p = marker(calibration, 'finalGate')
  return {
    electronicsScore: p[0],
    electronicsRaw: p[1],
    writingScore: p[2],
    writingRaw: p[3],
    cropVisualMin: p[4],
    cropRawMin: p[5],
    tieMargin: p[6],
  }
}

export function isTrustedCustomDetection(item, calibration = null) {
  const rawLabel = normalizeLabel(item.rawLabel)
  const label = normalizeLabel(item.label)
  const rule = item.rule || {}
  const sameClass = rawLabel === label
  const fromCrop = item.crop !== 'full'
  const gate = finalGate(calibration)
  const electronicsCropRawOnly = fromCrop && (label === 'hp' || label === 'layar') && item.visualScore < gate.cropVisualMin
  const strongRaw = item.rawScore >= (rule.rawOnlyThreshold ?? 1) && (!electronicsCropRawOnly || item.rawScore >= gate.cropRawMin)
  const visualSupported = item.visualScore >= (rule.minVisual ?? 0)
  const rawSupported = item.rawScore >= (sameClass ? (rule.trustedRaw ?? 0) : (rule.relabelRaw ?? 1))
  const cropSupported = !fromCrop || item.rawScore >= (rule.cropRaw ?? 0)

  return strongRaw || (visualSupported && rawSupported && cropSupported)
}

// Satu head (elektronik / buku_catatan) hanya boleh punya satu pemenang.
// Pengecualian: "buku" tidak boleh kalah dari "tulisan_tangan" dan sebaliknya
// "tulisan_tangan" tidak boleh menggantikan "buku" yang sudah ada.
function shouldReplaceHeadWinner(previous, item) {
  if (!previous) return true
  const isPaperHead = item.classHead === 'buku_catatan'
  const keepPaperObject = isPaperHead && item.label === 'buku' && previous.label === 'tulisan_tangan'
  const avoidReplacingPaperObject = isPaperHead && item.label === 'tulisan_tangan' && previous.label === 'buku'
  return keepPaperObject || (!avoidReplacingPaperObject && item.score > previous.score)
}

export function keepBestDetection(bestByReason, bestByHead, item) {
  bestByReason.set(item.reason, item)

  if (shouldReplaceHeadWinner(bestByHead.get(item.classHead), item)) {
    bestByHead.set(item.classHead, item)
  }
}

function shouldAcceptCustomDetection(item, calibration, gate) {
  if (explainRejection(item)) return false
  if (!isTrustedCustomDetection(item, calibration)) return false
  if (item.classHead === 'elektronik') {
    return item.score >= gate.electronicsScore || item.rawScore >= gate.electronicsRaw
  }
  if (item.classHead === 'buku_catatan' && item.label === 'tulisan_tangan') {
    return item.score >= gate.writingScore || item.rawScore >= gate.writingRaw
  }
  return true
}

export function acceptCustomDetections(bestByReason, calibration) {
  const gate = finalGate(calibration)
  const acceptedByHead = new Map()

  for (const item of bestByReason.values()) {
    if (!shouldAcceptCustomDetection(item, calibration, gate)) continue
    if (shouldReplaceHeadWinner(acceptedByHead.get(item.classHead), item)) {
      acceptedByHead.set(item.classHead, item)
    }
  }

  return [...acceptedByHead.values()]
}

export function selectCustomDetections(found, calibration) {
  if (found.length <= 1) {
    return { found, error: false }
  }

  const gate = finalGate(calibration)
  const sorted = [...found].sort((a, b) => b.score - a.score)
  const electronics = sorted.find(item => item.classHead === 'elektronik')
  const book = sorted.find(item => item.classHead === 'buku_catatan')
  const both = Boolean(book && electronics)

  // Buku kertas nyata / laptop besar: keduanya dipertahankan.
  if (both && (book.paperBookRescue || electronics.largeLaptopScreenRescue)) {
    return { found: [electronics, book].sort((a, b) => b.score - a.score), error: false }
  }
  // "layar" yang di-relabel jadi HP tapi buku lebih meyakinkan: pilih buku.
  if (
    both &&
    electronics.rawLabel === 'layar' &&
    electronics.label === 'hp' &&
    electronics.rawScore >= 0.8 &&
    electronics.visualScore < 0.75 &&
    book.score >= 0.82
  ) {
    return { found: [book], error: false }
  }
  // "layar" mentah lemah dan buku hampir pasti: pilih buku.
  if (
    both &&
    electronics.rawLabel === 'layar' &&
    electronics.rawScore < 0.8 &&
    electronics.visualScore < 0.96 &&
    book.score >= 0.98
  ) {
    return { found: [book], error: false }
  }
  // Elektronik menang kalau skornya tidak jauh di bawah yang tertinggi.
  if (electronics && electronics.score >= sorted[0].score - gate.tieMargin) {
    return { found: [electronics], error: false }
  }

  return { found: [sorted[0]], error: false }
}

export { getClassHead }
