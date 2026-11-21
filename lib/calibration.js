// Calibration parsing and score adjustment helpers for the custom object classifier.
import {
  CALIBRATION_MAGIC_V1,
  CALIBRATION_MAGIC_V2,
  CALIBRATION_MAGIC_V3,
  CALIBRATION_MAGIC_V4,
  CALIBRATION_MAX_BYTES,
  CALIBRATION_MARKER_RECORD_BYTES,
  CALIBRATION_MARKER_VALUES,
  CALIBRATION_PROTOTYPE_FEATURES,
  CALIBRATION_PROTOTYPE_RECORD_BYTES,
  CALIBRATION_RECORD_BYTES_V1,
  CALIBRATION_RECORD_BYTES_V2,
  CLASS_TO_HEAD,
  CLASS_TO_REASON,
  CONFIDENCE_THRESHOLDS,
  CUSTOM_LABELS,
  DEFAULT_CONFIDENCE,
  DEFAULT_MARKER_PROFILES,
  MARKER_PROFILE_KEYS,
} from './constants.js'

export function normalizeLabel(value) {
  return String(value || '').trim().toLowerCase()
}

export function getCustomReason(label) {
  return CLASS_TO_REASON[normalizeLabel(label)] || null
}

export function getClassHead(label) {
  return CLASS_TO_HEAD[normalizeLabel(label)] || normalizeLabel(label) || 'unknown'
}

function cloneMarkerProfiles() {
  return Object.fromEntries(
    Object.entries(DEFAULT_MARKER_PROFILES).map(([key, values]) => [key, [...values]])
  )
}

export function marker(calibration, key) {
  return calibration?._markerProfiles?.[key] || DEFAULT_MARKER_PROFILES[key]
}

export function getEffectiveCustomLabel(label, hints, rawScore = 0, calibration = null) {
  const normalized = normalizeLabel(label)
  const hpHint = Number(hints?.hp || 0)
  const bukuHint = Number(hints?.buku || 0)
  const tulisanHint = Number(hints?.tulisan_tangan || 0)
  const electronicRelabel = marker(calibration, 'relabelElectronic')
  const writingRelabel = marker(calibration, 'relabelWriting')

  if (hpHint >= electronicRelabel[0] && normalized === 'layar' && rawScore >= electronicRelabel[1]) {
    return 'hp'
  }
  if (hpHint >= electronicRelabel[2] && normalized === 'buku' && rawScore >= electronicRelabel[3]) {
    return 'hp'
  }
  if (hpHint >= electronicRelabel[4] && normalized === 'tidak_dikenali' && rawScore >= electronicRelabel[5]) {
    return 'hp'
  }
  if (bukuHint >= electronicRelabel[6] && normalized === 'layar' && rawScore < electronicRelabel[7]) {
    return 'buku'
  }
  if (tulisanHint >= writingRelabel[0] && normalized === 'tidak_dikenali' && rawScore >= writingRelabel[1] && rawScore <= writingRelabel[2]) {
    return 'tulisan_tangan'
  }
  return normalized
}

export function getDefaultCalibration() {
  const calibration = {
    hp:             { threshold: 0.72, scale: 1, bias: 0, minRaw: 0.28, visualBoost: 0.28, rawOnlyThreshold: 0.88, minVisual: 0.5, trustedRaw: 0.58, relabelRaw: 0.74, cropRaw: 0.62 },
    buku:           { threshold: 0.62, scale: 1, bias: 0, minRaw: 0.28, visualBoost: 0.16, rawOnlyThreshold: 0.83, minVisual: 0.45, trustedRaw: 0.5, relabelRaw: 0.72, cropRaw: 0.52 },
    layar:          { threshold: 0.7, scale: 1, bias: 0, minRaw: 0.34, visualBoost: 0.24, rawOnlyThreshold: 0.76, minVisual: 0.55, trustedRaw: 0.62, relabelRaw: 0.72, cropRaw: 0.6 },
    tulisan_tangan: { threshold: 0.58, scale: 1, bias: 0, minRaw: 0.22, visualBoost: 0.14, rawOnlyThreshold: 0.8, minVisual: 0.48, trustedRaw: 0.42, relabelRaw: 0.68, cropRaw: 0.48 },
    tidak_dikenali: { threshold: 1, scale: 1, bias: 0, minRaw: 1, visualBoost: 0, rawOnlyThreshold: 1, minVisual: 1, trustedRaw: 1, relabelRaw: 1, cropRaw: 1 },
  }
  calibration._markerProfiles = cloneMarkerProfiles()
  calibration._prototypes = []
  return calibration
}

export function parseCustomCalibration(buffer) {
  const view = new DataView(buffer)
  const magic = String.fromCharCode(...new Uint8Array(buffer, 0, CALIBRATION_MAGIC_V1.length))
  if (magic !== CALIBRATION_MAGIC_V1 && magic !== CALIBRATION_MAGIC_V2 && magic !== CALIBRATION_MAGIC_V3 && magic !== CALIBRATION_MAGIC_V4) {
    throw new Error('Invalid object calibration magic')
  }

  const version = view.getUint16(8, true)
  const count = view.getUint16(10, true)
  const isV2 = magic === CALIBRATION_MAGIC_V2
  const isV3 = magic === CALIBRATION_MAGIC_V3
  const isV4 = magic === CALIBRATION_MAGIC_V4
  const markerCount = (isV3 || isV4) ? view.getUint16(12, true) : 0
  const markerValueCount = (isV3 || isV4) ? view.getUint16(14, true) : 0
  const prototypeCount = isV4 ? view.getUint16(16, true) : 0
  const prototypeFeatureCount = isV4 ? view.getUint16(18, true) : 0
  const prototypeRecordBytes = isV4 ? view.getUint16(20, true) : 0
  if ((!isV2 && !isV3 && !isV4 && version !== 1) || (isV2 && version !== 2) || (isV3 && version !== 3) || (isV4 && version !== 4) || count > CUSTOM_LABELS.length) {
    throw new Error('Unsupported object calibration version')
  }
  if ((isV3 || isV4) && markerValueCount !== CALIBRATION_MARKER_VALUES) {
    throw new Error('Unsupported object calibration version')
  }
  if (isV4 && (prototypeFeatureCount !== CALIBRATION_PROTOTYPE_FEATURES || prototypeRecordBytes !== CALIBRATION_PROTOTYPE_RECORD_BYTES)) {
    throw new Error('Unsupported object calibration version')
  }

  // Jangan biarkan file besar/terpotong memicu pembacaan liar. Format yang
  // sah harus pas: tidak kurang, tidak lebih, dan di bawah budget browser.
  if (buffer.byteLength > CALIBRATION_MAX_BYTES) {
    throw new Error(`Object calibration too large (${buffer.byteLength} bytes)`)
  }
  const headerBytes = isV4 ? 24 : (isV3 ? 16 : 12)
  const recordBytes = (isV2 || isV3 || isV4)
    ? CALIBRATION_RECORD_BYTES_V2
    : CALIBRATION_RECORD_BYTES_V1
  const expectedBytes = headerBytes + count * recordBytes +
    markerCount * markerValueCount * 4 + prototypeCount * prototypeRecordBytes
  if (buffer.byteLength !== expectedBytes) {
    throw new Error(`Object calibration size mismatch (${buffer.byteLength} != ${expectedBytes})`)
  }

  const calibration = getDefaultCalibration()
  let offset = headerBytes
  for (let index = 0; index < count; index += 1) {
    const label = CUSTOM_LABELS[index]
    const previous = calibration[label] || {}
    calibration[label] = {
      ...previous,
      threshold: view.getFloat32(offset, true),
      scale: view.getFloat32(offset + 4, true),
      bias: view.getFloat32(offset + 8, true),
      minRaw: view.getFloat32(offset + 12, true),
      visualBoost: view.getFloat32(offset + 16, true),
      rawOnlyThreshold: view.getFloat32(offset + 20, true),
    }
    if (isV2 || isV3 || isV4) {
      calibration[label] = {
        ...calibration[label],
        minVisual: view.getFloat32(offset + 24, true),
        trustedRaw: view.getFloat32(offset + 28, true),
        relabelRaw: view.getFloat32(offset + 32, true),
        cropRaw: view.getFloat32(offset + 36, true),
      }
    }
    offset += recordBytes
  }

  if (isV3 || isV4) {
    const markerProfiles = cloneMarkerProfiles()
    for (let index = 0; index < markerCount; index += 1) {
      const key = MARKER_PROFILE_KEYS[index]
      const values = []
      for (let valueIndex = 0; valueIndex < CALIBRATION_MARKER_VALUES; valueIndex += 1) {
        values.push(view.getFloat32(offset + valueIndex * 4, true))
      }
      if (key) markerProfiles[key] = values
      offset += CALIBRATION_MARKER_RECORD_BYTES
    }
    calibration._markerProfiles = markerProfiles
  }

  if (isV4) {
    const prototypes = []
    for (let index = 0; index < prototypeCount; index += 1) {
      const classIndex = view.getUint8(offset)
      const kind = view.getUint8(offset + 1)
      const weight = view.getFloat32(offset + 4, true)
      const features = []
      for (let featureIndex = 0; featureIndex < CALIBRATION_PROTOTYPE_FEATURES; featureIndex += 1) {
        features.push(view.getFloat32(offset + 8 + featureIndex * 4, true))
      }
      if (classIndex < CUSTOM_LABELS.length) {
        prototypes.push({ classIndex, kind, weight, features })
      }
      offset += prototypeRecordBytes
    }
    calibration._prototypes = prototypes
  }

  return calibration
}

export function clampScore(value) {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(1, value))
}

export function ratioScore(value, low, high) {
  if (high <= low) return value >= high ? 1 : 0
  return clampScore((value - low) / (high - low))
}

export function calibrateScore(label, rawScore, hints, calibration) {
  const normalized = normalizeLabel(label)
  const rule = calibration[normalized] || {
    threshold: CONFIDENCE_THRESHOLDS[normalized] ?? DEFAULT_CONFIDENCE,
    scale: 1,
    bias: 0,
    minRaw: 0,
    visualBoost: 0,
    rawOnlyThreshold: CONFIDENCE_THRESHOLDS[normalized] ?? DEFAULT_CONFIDENCE,
    minVisual: 0,
    trustedRaw: 0,
    relabelRaw: 1,
    cropRaw: 0,
  }

  if (rawScore < rule.minRaw) {
    return { adjustedScore: rawScore, threshold: rule.threshold, supported: false, visualHint: 0, rule }
  }

  const visualHint = Number(hints?.[normalized] || 0)
  const adjustedScore = clampScore(rawScore * rule.scale + rule.bias + visualHint * rule.visualBoost)
  const supported = visualHint >= (rule.minVisual ?? 0) || rawScore >= rule.rawOnlyThreshold
  return { adjustedScore, threshold: rule.threshold, supported, visualHint, rule }
}

export function getScoreMap(categories) {
  const scores = Object.fromEntries(CUSTOM_LABELS.map(label => [label, 0]))
  for (const category of categories || []) {
    const key = normalizeLabel(category.categoryName || category.displayName || '')
    if (key in scores) {
      scores[key] = Number(category.score || 0)
    }
  }
  return scores
}

export function getPrototypeFeatures(scores, hints) {
  return [
    scores.hp || 0,
    scores.buku || 0,
    scores.layar || 0,
    scores.tulisan_tangan || 0,
    scores.tidak_dikenali || 0,
    Number(hints?.hp || 0),
    Number(hints?.buku || 0),
    Number(hints?.layar || 0),
    Number(hints?.tulisan_tangan || 0),
    Number(hints?._phoneObject || 0),
    Number(hints?._fullDarkScreen || 0),
    Number(hints?._coolScreen || 0),
  ].map(clampScore)
}

function comparePrototypeFeatures(features, prototype) {
  let distance = 0
  for (let index = 0; index < CALIBRATION_PROTOTYPE_FEATURES; index += 1) {
    distance += Math.abs((features[index] || 0) - (prototype.features[index] || 0))
  }
  return clampScore(1 - distance / CALIBRATION_PROTOTYPE_FEATURES) * Number(prototype.weight || 1)
}

export function scorePrototypeMatches(features, calibration) {
  const result = {
    hardNegative: 0,
    byLabel: Object.fromEntries(CUSTOM_LABELS.map(label => [label, 0])),
    bestLabel: '',
    bestLabelScore: 0,
  }
  for (const prototype of calibration?._prototypes || []) {
    const score = comparePrototypeFeatures(features, prototype)
    if (prototype.kind === 1) {
      result.hardNegative = Math.max(result.hardNegative, score)
    } else {
      const label = CUSTOM_LABELS[prototype.classIndex]
      if (label) {
        result.byLabel[label] = Math.max(result.byLabel[label] || 0, score)
        if (score > result.bestLabelScore) {
          result.bestLabel = label
          result.bestLabelScore = score
        }
      }
    }
  }
  return result
}
