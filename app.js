import { FilesetResolver, ImageClassifier } from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs'

const MODEL_URL = './cheat-detector.tflite?v=1'
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
const topLabelEl = document.getElementById('topLabel')
const topScoreEl = document.getElementById('topScore')
const barsEl = document.getElementById('bars')
const latencyEl = document.getElementById('latency')
const modelStateEl = document.getElementById('modelState')

let selectedFile = null
let classifierPromise = null
let previewUrl = null
let busy = false

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

async function getClassifier() {
  if (!classifierPromise) {
    modelStateEl.textContent = 'Memuat model…'
    classifierPromise = (async () => {
      const vision = await FilesetResolver.forVisionTasks(WASM_URL)
      const classifier = await ImageClassifier.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: MODEL_URL,
          delegate: 'CPU',
        },
        runningMode: 'IMAGE',
        maxResults: 5,
        scoreThreshold: 0.01,
      })
      modelStateEl.textContent = 'Model siap'
      return classifier
    })().catch(error => {
      classifierPromise = null
      modelStateEl.textContent = 'Model gagal dimuat'
      throw error
    })
  }
  return classifierPromise
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

function renderResult(categories, elapsedMs) {
  const sorted = LABELS.map((label, index) => {
    const found = categories.find(item => Number(item.index) === index)
    return { label, score: Number(found?.score || 0) }
  }).sort((a, b) => b.score - a.score)

  const top = sorted[0]
  topLabelEl.textContent = formatLabel(top.label)
  topScoreEl.textContent = `${(top.score * 100).toFixed(1)}%`
  latencyEl.textContent = `Inferensi ${Math.round(elapsedMs)} ms`

  barsEl.replaceChildren(...sorted.map((item, index) => {
    const row = document.createElement('div')
    row.className = `bar-row${index === 0 ? ' top' : ''}`

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

  resultEl.hidden = false
}

async function analyze() {
  if (!selectedFile || busy) return

  busy = true
  analyzeButton.disabled = true
  clearError()
  setStatus('Memuat model dan menganalisis…')

  try {
    const classifier = await getClassifier()
    const image = await new Promise((resolve, reject) => {
      const element = new Image()
      element.onload = () => resolve(element)
      element.onerror = () => reject(new Error('Gambar gagal dibaca.'))
      element.src = previewUrl
    })

    const input = drawInput(image)
    const started = performance.now()
    const result = await classifier.classify(input)
    const elapsed = performance.now() - started

    const categories = result?.classifications?.[0]?.categories || []
    if (!categories.length) throw new Error('Model tidak mengembalikan prediksi.')
    renderResult(categories, elapsed)
    setStatus('Selesai. Ini prediksi model mentah, bukan keputusan final.')
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
