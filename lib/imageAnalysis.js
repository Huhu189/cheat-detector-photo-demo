// Image crop generation and pixel-level visual hint extraction.
import { CUSTOM_CROP_FRACTIONS, CUSTOM_CROP_SIZE, MAX_CUSTOM_CROPS } from './constants.js'
import { clampScore, marker, ratioScore } from './calibration.js'

let visualHintCanvas = null

function getInputSize(input) {
  if (!input) return null
  if (typeof ImageData !== 'undefined' && input instanceof ImageData) {
    return { width: input.width, height: input.height, imageData: true }
  }
  const width = input.videoWidth || input.naturalWidth || input.width
  const height = input.videoHeight || input.naturalHeight || input.height
  if (!width || !height) return null
  return { width, height, imageData: false }
}

function makeCropBoxes(width, height, maxCrops = MAX_CUSTOM_CROPS) {
  const limit = Math.max(1, Math.min(MAX_CUSTOM_CROPS, Number(maxCrops) || MAX_CUSTOM_CROPS))
  const boxes = [{ name: 'full', sx: 0, sy: 0, sw: width, sh: height, full: true }]
  const seen = new Set(['full'])

  for (const fraction of CUSTOM_CROP_FRACTIONS) {
    const side = Math.max(32, Math.round(Math.min(width, height) * fraction))
    // Crop kecil: sudut dulu, baru tengah/tepi. Dengan limit 21 untuk HP
    // entry, empat crop kecil pertama tetap jatuh di keempat sudut.
    const activeCenters = fraction > 0.5 ? [0.25, 0.4, 0.6, 0.75] : [0.25, 0.75, 0.5]
    const activeRows = fraction > 0.5 ? [0.25, 0.4, 0.6, 0.75] : [0.25, 0.75, 0.5]

    for (const cy of activeRows) {
      for (const cx of activeCenters) {
        const sx = Math.max(0, Math.min(width - side, Math.round(width * cx - side / 2)))
        const sy = Math.max(0, Math.min(height - side, Math.round(height * cy - side / 2)))
        const key = `${sx}:${sy}:${side}`
        if (seen.has(key)) continue
        seen.add(key)
        boxes.push({ name: `crop_${fraction}_${cx}_${cy}`, sx, sy, sw: side, sh: side, full: false })
        if (boxes.length >= limit) return boxes
      }
    }
  }

  return boxes
}

function imageDataToCanvas(input, sizeInfo) {
  const source = document.createElement('canvas')
  source.width = sizeInfo.width
  source.height = sizeInfo.height
  source.getContext('2d')?.putImageData(input, 0, 0)
  return source
}

function cropToCanvas(input, box, sizeInfo, imageDataSource = null) {
  if (box.full) return input

  const canvas = document.createElement('canvas')
  canvas.width = CUSTOM_CROP_SIZE
  canvas.height = CUSTOM_CROP_SIZE
  const ctx = canvas.getContext('2d')
  if (!ctx) return input

  if (sizeInfo.imageData) {
    const source = imageDataSource || imageDataToCanvas(input, sizeInfo)
    ctx.drawImage(source, box.sx, box.sy, box.sw, box.sh, 0, 0, CUSTOM_CROP_SIZE, CUSTOM_CROP_SIZE)
  } else {
    ctx.drawImage(input, box.sx, box.sy, box.sw, box.sh, 0, 0, CUSTOM_CROP_SIZE, CUSTOM_CROP_SIZE)
  }

  return canvas
}

export function getVisualHints(input, calibration = null) {
  const canvas = visualHintCanvas || document.createElement('canvas')
  visualHintCanvas = canvas
  canvas.width = 64
  canvas.height = 64
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return {}

  try {
    ctx.drawImage(input, 0, 0, 64, 64)
  } catch {
    return {}
  }

  const pixels = ctx.getImageData(0, 0, 64, 64).data
  let dark = 0
  let bright = 0
  let ink = 0
  let saturated = 0
  let coolScreen = 0
  let skin = 0
  let darkNeutral = 0
  let borderDark = 0
  let centerBright = 0
  let minX = 64
  let minY = 64
  let maxX = -1
  let maxY = -1

  for (let y = 0; y < 64; y += 1) {
    for (let x = 0; x < 64; x += 1) {
      const i = (y * 64 + x) * 4
      const r = pixels[i]
      const g = pixels[i + 1]
      const b = pixels[i + 2]
      const luma = r * 0.299 + g * 0.587 + b * 0.114
      const maxChannel = Math.max(r, g, b)
      const minChannel = Math.min(r, g, b)
      const saturation = maxChannel - minChannel
      if (luma < 80) {
        dark += 1
        minX = Math.min(minX, x)
        minY = Math.min(minY, y)
        maxX = Math.max(maxX, x)
        maxY = Math.max(maxY, y)
      }
      if (luma > 220) bright += 1
      if (luma > 45 && luma < 150) ink += 1
      if (saturation > 55) saturated += 1
      if (b > r + 25 && b > g + 5 && luma > 55 && luma < 190) coolScreen += 1
      if (r > 90 && g > 45 && b > 25 && r > g * 1.05 && r > b * 1.18 && saturation > 18) skin += 1
      if (luma > 45 && luma < 165 && saturation < 48) darkNeutral += 1
      if ((x < 8 || x > 55 || y < 8 || y > 55) && luma < 95) borderDark += 1
      if (x >= 16 && x <= 47 && y >= 12 && y <= 51 && luma > 210) centerBright += 1
    }
  }

  const total = 64 * 64
  const darkRatio = dark / total
  const brightRatio = bright / total
  const inkRatio = ink / total
  const saturatedRatio = saturated / total
  const coolScreenRatio = coolScreen / total
  const skinRatio = skin / total
  const darkNeutralRatio = darkNeutral / total
  const borderDarkRatio = borderDark / (64 * 64 - 48 * 48)
  const centerBrightRatio = centerBright / (32 * 40)
  const darkWidth = Math.max(0, maxX - minX + 1)
  const darkHeight = Math.max(0, maxY - minY + 1)
  const aspect = darkHeight > 0 ? darkWidth / darkHeight : 0
  const centerX = darkWidth > 0 ? (minX + maxX) / 2 / 64 : 0
  const centered = centerX > 0.28 && centerX < 0.72

  const skinProfile = marker(calibration, 'skinPenalty')
  const tallProfile = marker(calibration, 'tallElectronic')
  const brightPhoneProfile = marker(calibration, 'brightFramedPhone')
  const whitePhoneProfile = marker(calibration, 'whiteScreenPhone')
  const wideProfile = marker(calibration, 'wideShape')
  const coolProfile = marker(calibration, 'coolScreen')
  const paperProfile = marker(calibration, 'paperSurface')
  const bookProfile = marker(calibration, 'bookSurface')
  const handwritingProfile = marker(calibration, 'handwritingSurface')
  const finalProfile = marker(calibration, 'finalGate')
  const phoneProfile = marker(calibration, 'phoneObject')
  const fullDarkScreenProfile = marker(calibration, 'fullDarkScreenEvidence')

  const wideDarkShape = darkRatio > paperProfile[2] && darkWidth > paperProfile[3] && darkHeight > paperProfile[4] && aspect > paperProfile[5]
  const skinPenalty = skinRatio > skinProfile[0] && darkRatio < skinProfile[1] ? skinProfile[2] : 1
  const tallElectronicScore = Math.min(
    ratioScore(darkRatio, tallProfile[0], tallProfile[1]),
    ratioScore(darkHeight, tallProfile[2], tallProfile[3]),
    ratioScore(tallProfile[4] - darkWidth, 0, tallProfile[5]),
    ratioScore(tallProfile[6] - aspect, 0, tallProfile[7]),
    centered ? 1 : 0.45,
  )
  const brightFramedPhoneScore = Math.min(
    ratioScore(centerBrightRatio, brightPhoneProfile[0], brightPhoneProfile[1]),
    ratioScore(borderDarkRatio, brightPhoneProfile[2], brightPhoneProfile[3]),
    ratioScore(brightPhoneProfile[4] - darkRatio, 0, brightPhoneProfile[5]),
    ratioScore(brightPhoneProfile[6] - aspect, 0, brightPhoneProfile[7]),
  )
  const whiteScreenPhoneScore = Math.min(
    ratioScore(centerBrightRatio, whitePhoneProfile[0], whitePhoneProfile[1]),
    ratioScore(borderDarkRatio, whitePhoneProfile[2], whitePhoneProfile[3]),
    ratioScore(skinRatio, whitePhoneProfile[4], whitePhoneProfile[5]),
    ratioScore(whitePhoneProfile[6] - darkRatio, 0, whitePhoneProfile[7]),
  )
  const wideShapeScore = Math.min(
    ratioScore(darkRatio, wideProfile[0], wideProfile[1]),
    ratioScore(darkWidth, wideProfile[2], wideProfile[3]),
    ratioScore(darkHeight, wideProfile[4], wideProfile[5]),
    ratioScore(aspect, wideProfile[6], wideProfile[7]),
  )
  const coolScreenScore = Math.min(
    ratioScore(coolScreenRatio, coolProfile[0], coolProfile[1]),
    ratioScore(saturatedRatio, coolProfile[2], coolProfile[3]),
    ratioScore(darkWidth, coolProfile[4], coolProfile[5]),
    ratioScore(darkHeight, coolProfile[6], coolProfile[7]),
  )
  const darkPhoneBodyScore = Math.min(
    ratioScore(darkRatio, phoneProfile[1], phoneProfile[2]),
    ratioScore(darkNeutralRatio, phoneProfile[3], phoneProfile[4]),
    ratioScore(phoneProfile[5] - darkNeutralRatio, 0, phoneProfile[6]),
    ratioScore(phoneProfile[7] - skinRatio, 0, 0.08),
  )
  const fullDarkScreenScore = Math.min(
    ratioScore(darkRatio, fullDarkScreenProfile[1], fullDarkScreenProfile[2]),
    ratioScore(darkNeutralRatio, fullDarkScreenProfile[3], fullDarkScreenProfile[4]),
    ratioScore(fullDarkScreenProfile[5] - skinRatio, 0, fullDarkScreenProfile[6]),
  )
  const hp = Math.max(tallElectronicScore, brightFramedPhoneScore, whiteScreenPhoneScore) * skinPenalty
  const phoneObjectScore = Math.max(tallElectronicScore, brightFramedPhoneScore, whiteScreenPhoneScore, darkPhoneBodyScore) * skinPenalty
  const layar = hp >= finalProfile[7] ? 0 : Math.max(wideShapeScore, coolScreenScore) * skinPenalty
  const lowSaturationMirrorScore = Math.min(
    ratioScore(0.09 - saturatedRatio, 0, 0.07),
    ratioScore(brightRatio, 0.035, 0.085),
    ratioScore(0.2 - brightRatio, 0, 0.1),
    ratioScore(darkNeutralRatio, 0.24, 0.38),
    ratioScore(0.46 - phoneObjectScore, 0, 0.2),
  )
  const coolChromeReflectionScore = Math.min(
    ratioScore(coolScreenScore, 0.9, 1),
    ratioScore(saturatedRatio, 0.24, 0.42),
    ratioScore(inkRatio, 0.58, 0.78),
    ratioScore(0.12 - phoneObjectScore, 0, 0.1),
    ratioScore(0.14 - fullDarkScreenScore, 0, 0.1),
  )
  const mirrorReflectionScore = Math.max(lowSaturationMirrorScore, coolChromeReflectionScore)
  const paperSurface = brightRatio > paperProfile[0] && darkRatio < paperProfile[1]
  const bookScore = paperSurface && hp < paperProfile[6] && layar < paperProfile[7] && !wideDarkShape
    ? Math.min(ratioScore(brightRatio, bookProfile[0], bookProfile[1]), ratioScore(inkRatio, bookProfile[2], bookProfile[3]))
    : 0
  const handwritingScore = paperSurface && hp < paperProfile[6] && layar < paperProfile[7] && !wideDarkShape
    ? Math.min(ratioScore(brightRatio, handwritingProfile[0], handwritingProfile[1]), ratioScore(inkRatio, handwritingProfile[2], handwritingProfile[3]))
    : 0

  return {
    hp: clampScore(hp),
    buku: clampScore(bookScore),
    layar: clampScore(layar),
    tulisan_tangan: clampScore(handwritingScore),
    _coolScreen: clampScore(coolScreenScore),
    _phoneObject: clampScore(phoneObjectScore),
    _fullDarkScreen: clampScore(fullDarkScreenScore),
    _darkRatio: clampScore(darkRatio),
    _skinRatio: clampScore(skinRatio),
    _inkRatio: clampScore(inkRatio),
    _darkNeutralRatio: clampScore(darkNeutralRatio),
    _saturatedRatio: clampScore(saturatedRatio),
    _brightRatio: clampScore(brightRatio),
    _mirrorReflection: clampScore(mirrorReflectionScore),
  }
}

export function buildCustomClassifierInputs(input, maxCrops = MAX_CUSTOM_CROPS) {
  const sizeInfo = getInputSize(input)
  if (!sizeInfo || sizeInfo.width < 64 || sizeInfo.height < 64) {
    return [{ source: input, crop: 'full' }]
  }

  const imageDataSource = sizeInfo.imageData ? imageDataToCanvas(input, sizeInfo) : null
  return makeCropBoxes(sizeInfo.width, sizeInfo.height, maxCrops).map(box => ({
    source: cropToCanvas(input, box, sizeInfo, imageDataSource),
    crop: box.name,
  }))
}
