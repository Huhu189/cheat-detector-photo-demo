import { FilesetResolver, ImageClassifier } from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs'
import { parseCustomCalibration } from './lib/calibration.js'
import { detectCalibrated } from './lib/pipeline.js'

const MODEL_URL = './cheat-detector.tflite?v=2'
const CALIBRATION_URL = './cheat-detector-calibration.bin?v=2'
const WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm'
const LABELS = ['hp', 'buku', 'layar', 'tulisan_tangan', 'tidak_dikenali']
const LABEL_ID = {
  hp: 'HP',
  buku: 'Buku',
  layar: 'Layar',
  tulisan_tangan: 'Tulisan tangan',
  tidak_dikenali: 'Tidak dikenali',
}

const fileInput = document.getElementById('fileInput')
const dropzone = document.getElementById('dropzone')
const previewWrap = document.getElementById('previewWrap')
const preview = document.getElementById('preview')
const clearButton = document.getElementById('clearButton')
const analyzeButton = document.getElementById('analyzeButton')
const statusEl = document.getElementById('status')
const errorEl = document.getElementById('error')
const resultEl = document.getElementById('result')
const calResultEl = document.getElementById('calResult')
const topLabelEl = document.getElementById('topLabel')
const topScoreEl = document.getElementById('topScore')
const calLabelEl = document.getElementById('calLabel')
const calScoreEl = document.getElementById('calScore')
const calMetaEl = document.getElementById('calMeta')
const calNoteEl = document.getElementById('calNote')
const barsEl = document.getElementById('bars')
const latencyEl = document.getElementById('latency')
const modelStateEl = document.getElementById('modelState')

let selectedFile = null
let resourcesPromise = null
let previewUrl = null
let busy = false
let calibrationBytes = 0
let prototypeCount = 0

window.__demo = {
  ready: false,
  calibrationBytes: 0,
  prototypes: 0,
  crops: 0,
  last: null,
}

function setStatus(text) {
  statusEl.textContent = text
}

function showError(message) {
  errorEl.hidden = false
  errorEl.textContent = message
}

function clearError() {
  errorEl.hidden = true
  errorEl.textContent = ''
}

function formatLabel(name) {
  return LABEL_ID[name] || name
}

async function getResources() {
  if (!resourcesPromise) {
    modelStateEl.textContent = 'Memuat model + kalibrasi…'
    resourcesPromise = (async () => {
      const vision = await FilesetResolver.forVisionTasks(WASM_URL)
      const calibrationResponse = await fetch(CALIBRATION_URL, { cache: 'no-cache' })
      if (!calibrationResponse.ok) {
        throw new Error(`Kalibrasi gagal dimuat (${calibrationResponse.status}).`)
      }
      const calibrationBuffer = await calibrationResponse.arrayBuffer()
      const calibration = parseCustomCalibration(calibrationBuffer)
      calibrationBytes = calibrationBuffer.byteLength
      prototypeCount = calibration._prototypes?.length || 0

      const classifier = await ImageClassifier.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: MODEL_URL,
          delegate: 'CPU',
        },
        runningMode: 'IMAGE',
        maxResults: 5,
        scoreThreshold: 0.01,
      })

      window.__demo.ready = true
      window.__demo.calibrationBytes = calibrationBytes
      window.__demo.prototypes = prototypeCount
      modelStateEl.textContent = `Model + kalibrasi siap · ${prototypeCount.toLocaleString('id-ID')} prototipe`
      return { classifier, calibration }
    })().catch(error => {
      resourcesPromise = null
      modelStateEl.textContent = 'Model/kalibrasi gagal dimuat'
      throw error
    })
  }
  return resourcesPromise
}

function loadFile(file) {
  if (!file || !file.type.startsWith('image/')) {
    showError('File harus berupa gambar (JPG, PNG, atau WebP).')
    return
  }

  clearError()
  selectedFile = file
  if (previewUrl) URL.revokeObjectURL(previewUrl)
  previewUrl = URL.createObjectURL(file)
  preview.src = previewUrl
  previewWrap.hidden = false
  dropzone.hidden = true
  analyzeButton.disabled = false
  resultEl.hidden = true
  calResultEl.hidden = true
  setStatus('Foto siap dianalisis.')
}

function resetFile() {
  selectedFile = null
  if (previewUrl) URL.revokeObjectURL(previewUrl)
  previewUrl = null
  preview.removeAttribute('src')
  previewWrap.hidden = true
  dropzone.hidden = false
  analyzeButton.disabled = true
  resultEl.hidden = true
  calResultEl.hidden = true
  clearError()
  setStatus('Menunggu foto…')
  fileInput.value = ''
}

function drawInput(image) {
  const canvas = document.createElement('canvas')
  canvas.width = 128
  canvas.height = 128
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D tidak tersedia di browser ini.')
  ctx.drawImage(image, 0, 0, 128, 128)
  return canvas
}

function sortedCategories(categories) {
  return LABELS.map((label, index) => {
    const found = categories.find(item => Number(item.index) === index)
    return { label, score: Number(found?.score || 0) }
  }).sort((a, b) => b.score - a.score)
}

function renderResult(best, rawSorted, elapsedMs, crops) {
  const topRaw = rawSorted[0]
  const decision = best
    ? { label: best.label, score: best.score, rawScore: best.rawScore, crop: best.crop }
    : { label: 'tidak_dikenali', score: null, rawScore: 0, crop: 'gate' }

  topLabelEl.textContent = formatLabel(topRaw.label)
  topScoreEl.textContent = `${(topRaw.score * 100).toFixed(1)}%`
  latencyEl.textContent = `Full-frame · ${Math.round(elapsedMs)} ms total`

  calLabelEl.textContent = formatLabel(decision.label)
  calScoreEl.textContent = decision.score === null
    ? '—'
    : `${(decision.score * 100).toFixed(1)}%`
  calMetaEl.textContent = best
    ? `Menang di ${best.crop} · ${crops} crop · skor kalibrasi ${(best.score * 100).toFixed(1)}%`
    : `Tidak ada objek lolos gate · ${crops} crop`
  calNoteEl.textContent = best
    ? `Bin memilih ${formatLabel(decision.label)}; ini hasil gate, bukan jaminan benar.`
    : 'Semua kandidat ditolak gate; hasil bin dianggap tidak dikenali.'

  const topRow = document.createElement('div')
  topRow.className = 'bar-caption'
  topRow.textContent = `Distribusi skor mentah full-frame: ${formatLabel(topRaw.label)} ${(topRaw.score * 100).toFixed(1)}%`

  barsEl.replaceChildren(topRow, ...rawSorted.map(item => {
    const row = document.createElement('div')
    row.className = `bar-row${item.label === topRaw.label ? ' top' : ''}`

    const name = document.createElement('span')
    name.className = 'bar-name'
    name.textContent = formatLabel(item.label)

    const track = document.createElement('div')
    track.className = 'bar-track'
    const fill = document.createElement('div')
    fill.className = 'bar-fill'
    fill.style.width = `${Math.max(1, item.score * 100)}%`
    track.appendChild(fill)

    const score = document.createElement('span')
    score.className = 'bar-score'
    score.textContent = `${(item.score * 100).toFixed(1)}%`

    row.append(name, track, score)
    return row
  }))

  window.__demo.last = {
    rawLabel: topRaw.label,
    rawScore: topRaw.score,
    calLabel: decision.label,
    calScore: decision.score,
    crop: decision.crop,
    crops,
  }
  resultEl.hidden = false
  calResultEl.hidden = false
}

async function analyze() {
  if (!selectedFile || busy) return

  busy = true
  analyzeButton.disabled = true
  clearError()
  setStatus('Memuat model + kalibrasi…')

  try {
    const { classifier, calibration } = await getResources()
    const image = await new Promise((resolve, reject) => {
      const element = new Image()
      element.onload = () => resolve(element)
      element.onerror = () => reject(new Error('Gambar gagal dibaca.'))
      element.src = previewUrl
    })

    setStatus('Menjalankan crop ensemble + kalibrasi…')
    await new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)))

    const started = performance.now()
    const calibrated = detectCalibrated(image, classifier, calibration)
    const best = calibrated.found?.[0] || null

    const rawInput = drawInput(image)
    const rawResult = await classifier.classify(rawInput)
    const rawCategories = rawResult?.classifications?.[0]?.categories || []
    if (!rawCategories.length) throw new Error('Model tidak mengembalikan prediksi.')
    const elapsed = performance.now() - started

    const crops = calibrated.crops || 0
    window.__demo.crops = crops
    renderResult(best, sortedCategories(rawCategories), elapsed, crops)
    setStatus(best
      ? 'Selesai. Hasil mentah dan hasil dengan bin ditampilkan terpisah.'
      : 'Selesai. Bin menolak semua kandidat; hasil kalibrasi dianggap aman.')
  } catch (error) {
    console.error(error)
    showError(`Gagal menganalisis foto: ${error?.message || error}`)
    setStatus('Gagal.')
  } finally {
    busy = false
    analyzeButton.disabled = !selectedFile
  }
}

dropzone.addEventListener('click', () => fileInput.click())
dropzone.addEventListener('keydown', event => {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault()
    fileInput.click()
  }
})
dropzone.tabIndex = 0
dropzone.setAttribute('role', 'button')
dropzone.setAttribute('aria-label', 'Pilih foto untuk dianalisis')

fileInput.addEventListener('change', event => {
  loadFile(event.target.files?.[0])
})

for (const eventName of ['dragenter', 'dragover']) {
  dropzone.addEventListener(eventName, event => {
    event.preventDefault()
    dropzone.classList.add('dragging')
  })
}

for (const eventName of ['dragleave', 'drop']) {
  dropzone.addEventListener(eventName, event => {
    event.preventDefault()
    dropzone.classList.remove('dragging')
  })
}

dropzone.addEventListener('drop', event => {
  loadFile(event.dataTransfer?.files?.[0])
})

clearButton.addEventListener('click', resetFile)
analyzeButton.addEventListener('click', analyze)
