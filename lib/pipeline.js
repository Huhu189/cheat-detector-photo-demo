// Port of the frontend custom-detector pipeline.
// Difference from the source hook: the model and calibration are passed in,
// generic fallback and micro-log upload are omitted.
import { customCropLimit } from './constants.js'
import {
  calibrateScore,
  clampScore,
  getClassHead,
  getCustomReason,
  getEffectiveCustomLabel,
  getPrototypeFeatures,
  getScoreMap,
  marker,
  normalizeLabel,
  scorePrototypeMatches,
} from './calibration.js'
import { buildCustomClassifierInputs, getVisualHints } from './imageAnalysis.js'
import {
  acceptCustomDetections,
  isRejectedByRule,
  keepBestDetection,
  selectCustomDetections,
} from './customDecision.js'

const microLog = () => {}

export function detectCalibrated(input, classifier, calibration) {
  const started = Date.now()
  const bestByReason = new Map()
  const bestByHead = new Map()
  const finalProfile = marker(calibration, 'finalGate')
  const fullCoolScreenProfile = marker(calibration, 'fullCoolScreenEvidence')
  const phoneProfile = marker(calibration, 'phoneObject')
  const fullDarkScreenProfile = marker(calibration, 'fullDarkScreenEvidence')
  const phoneRawProfile = marker(calibration, 'phoneRawEvidence')
  const screenContentPhoneProfile = marker(calibration, 'screenContentPhoneEvidence')
  const prototypePositiveProfile = marker(calibration, 'prototypePositiveGate')
  const prototypeHardNegativeProfile = marker(calibration, 'prototypeHardNegativeGate')
  const paperColorScreenNegativeProfile = marker(calibration, 'paperColorScreenNegative')

  const cropLimit = customCropLimit()
  const candidates = buildCustomClassifierInputs(input, cropLimit)
  microLog('detect_start', { crops: candidates.length, cropLimit })
  for (const candidate of candidates) {
    const hints = getVisualHints(candidate.source, calibration)
    const result = classifier.classify(candidate.source)
    const categories = (result.classifications || []).flatMap(classification => classification.categories || [])
    const scoreMap = getScoreMap(categories)
    const prototypeMatch = scorePrototypeMatches(getPrototypeFeatures(scoreMap, hints), calibration)
    for (const classification of result.classifications || []) {
      for (const category of classification.categories || []) {
        const rawLabel = category.categoryName || category.displayName || ''
        const score = Number(category.score || 0)
        const normalizedRaw = normalizeLabel(rawLabel)
        const scoringHints = normalizedRaw === 'hp' && score >= phoneProfile[0]
          ? { ...hints, hp: Math.max(Number(hints?.hp || 0), Number(hints?._phoneObject || 0)) }
          : hints
        let label = getEffectiveCustomLabel(rawLabel, scoringHints, score, calibration)
        const whiteHeldPaperRescueCandidate =
          (normalizedRaw === 'hp' || normalizedRaw === 'tidak_dikenali') &&
          score >= 0.5 &&
          Number(hints?._brightRatio || 0) >= 0.45 &&
          Number(hints?._brightRatio || 0) <= 0.7 &&
          Number(hints?._saturatedRatio || 0) < 0.06 &&
          Number(hints?._skinRatio || 0) >= 0.16 &&
          Number(hints?._skinRatio || 0) <= 0.36 &&
          Number(hints?._inkRatio || 0) >= 0.18 &&
          Number(hints?._inkRatio || 0) <= 0.55 &&
          Number(hints?._coolScreen || 0) <= 0 &&
          Number(scoreMap.layar || 0) < 0.12
        const whiteHeldSheetRescueCandidate =
          score >= 0.3 &&
          Number(hints?._brightRatio || 0) >= 0.3 &&
          Number(hints?._brightRatio || 0) <= 0.62 &&
          Number(hints?._saturatedRatio || 0) >= 0.06 &&
          Number(hints?._saturatedRatio || 0) <= 0.32 &&
          Number(hints?._skinRatio || 0) >= 0.07 &&
          Number(hints?._skinRatio || 0) <= 0.36 &&
          Number(hints?._inkRatio || 0) >= 0.08 &&
          Number(hints?._inkRatio || 0) <= 0.2 &&
          Number(hints?._coolScreen || 0) <= 0 &&
          Number(hints?._phoneObject || 0) <= 0
        const whiteHeldSheetFromScreenCandidate =
          normalizedRaw === 'layar' &&
          score >= 0.58 &&
          Number(hints?._brightRatio || 0) >= 0.5 &&
          Number(hints?._brightRatio || 0) <= 0.72 &&
          Number(hints?._saturatedRatio || 0) < 0.08 &&
          Number(hints?._skinRatio || 0) >= 0.05 &&
          Number(hints?._skinRatio || 0) <= 0.25 &&
          Number(hints?._inkRatio || 0) >= 0.08 &&
          Number(hints?._inkRatio || 0) <= 0.2 &&
          Number(hints?._coolScreen || 0) <= 0 &&
          Number(hints?._phoneObject || 0) <= 0 &&
          Number(hints?._darkRatio || 0) < 0.08
        if (
          normalizedRaw === 'buku' &&
          score >= screenContentPhoneProfile[0] &&
          Number(hints?._coolScreen || 0) >= screenContentPhoneProfile[1]
        ) {
          label = 'layar'
        }
        const prototypeHardNegative = prototypeMatch.hardNegative || 0
        if (
          prototypeMatch.bestLabel === 'tulisan_tangan' &&
          label === 'buku' &&
          !(
            normalizedRaw === 'buku' &&
            score >= 0.5 &&
            Number(hints?._brightRatio || 0) >= 0.28 &&
            Number(hints?._inkRatio || 0) < 0.18 &&
            Number(hints?._saturatedRatio || 0) >= 0.35 &&
            Number(hints?._skinRatio || 0) < 0.72
          ) &&
          prototypeMatch.bestLabelScore >= prototypePositiveProfile[0] &&
          score >= prototypePositiveProfile[1] &&
          prototypeMatch.bestLabelScore >= prototypeMatch.hardNegative + prototypePositiveProfile[4]
        ) {
          label = 'tulisan_tangan'
        }
        if (
          prototypeMatch.bestLabel === 'layar' &&
          normalizedRaw !== 'buku' &&
          label !== 'layar' &&
          prototypeMatch.bestLabelScore >= prototypePositiveProfile[0] &&
          score >= prototypePositiveProfile[1] &&
          Number(hints?._phoneObject || 0) >= 0.55
        ) {
          label = 'layar'
        }
        const prototypeWritingScore = prototypeMatch.byLabel.tulisan_tangan || 0
        if (
          label === 'buku' &&
          normalizedRaw === 'buku' &&
          score >= 0.72 &&
          prototypeWritingScore >= 0.993 &&
          prototypeHardNegative <= prototypeWritingScore + 0.002 &&
          Number(hints?._skinRatio || 0) >= 0.8 &&
          Number(hints?._saturatedRatio || 0) >= 0.75
        ) {
          label = 'tulisan_tangan'
        }
        if (whiteHeldPaperRescueCandidate || whiteHeldSheetRescueCandidate || whiteHeldSheetFromScreenCandidate) {
          label = 'buku'
        }
        // Halaman kertas bertinta yang classifier sebut "layar": terang sedang,
        // tinta banyak, warna netral, dan bukan bentuk HP. Ini kebalikan dari
        // rescue layar gelap/cool di bawah, yang justru mengandalkan coolScreen.
        // Dievaluasi setelah relabel prototype agar rawLabel 'tidak_dikenali'
        // yang baru menjadi 'layar' juga bisa dipulihkan.
        const paperLikeScreenRescueCandidate =
          label === 'layar' &&
          normalizedRaw !== 'buku' &&
          Number(hints?._brightRatio || 0) >= 0.2 &&
          Number(hints?._brightRatio || 0) <= 0.4 &&
          Number(hints?._inkRatio || 0) >= 0.4 &&
          Number(hints?._saturatedRatio || 0) < 0.12 &&
          Number(hints?._skinRatio || 0) < 0.12 &&
          Number(hints?._phoneObject || 0) < 0.7 &&
          Number(hints?._coolScreen || 0) <= 0
        if (paperLikeScreenRescueCandidate) label = 'buku'
        let textScreenshotRescue = false
        if (
          normalizedRaw === 'layar' &&
          label === 'layar' &&
          score >= 0.35 &&
          Number(hints?._brightRatio || 0) >= 0.78 &&
          Number(hints?._brightRatio || 0) < 0.94 &&
          Number(hints?._darkNeutralRatio || 0) >= 0.02 &&
          Number(hints?._darkNeutralRatio || 0) < 0.09 &&
          Number(hints?._inkRatio || 0) >= 0.015 &&
          Number(hints?._inkRatio || 0) < 0.08 &&
          Number(hints?._skinRatio || 0) < 0.03 &&
          Number(hints?._phoneObject || 0) < 0.1 &&
          Number(hints?._coolScreen || 0) < 0.05
        ) {
          label = 'tulisan_tangan'
          textScreenshotRescue = true
        }
        const reason = getCustomReason(label)
        let calibrated = calibrateScore(label, score, scoringHints, calibration)
        let brightTextRescue = false
        let largeLaptopScreenRescue = false
        let paperBookRescue = false

        if (whiteHeldPaperRescueCandidate || whiteHeldSheetRescueCandidate || whiteHeldSheetFromScreenCandidate) {
          calibrated = {
            ...calibrated,
            adjustedScore: Math.max(calibrated.adjustedScore, clampScore(score + 0.18)),
            threshold: 0.72,
            supported: true,
            visualHint: Math.max(calibrated.visualHint, Number(hints?._brightRatio || 0)),
            rule: {
              ...calibrated.rule,
              threshold: 0.72,
              minVisual: whiteHeldSheetRescueCandidate ? 0.3 : 0.45,
              trustedRaw: 0.5,
              relabelRaw: 0.5,
              cropRaw: 0.5,
            },
          }
          paperBookRescue = true
        }
        if (paperLikeScreenRescueCandidate) {
          calibrated = {
            ...calibrated,
            adjustedScore: Math.max(calibrated.adjustedScore, clampScore(score + 0.18)),
            threshold: 0.72,
            supported: true,
            visualHint: Math.max(calibrated.visualHint, Number(hints?._brightRatio || 0)),
            rule: {
              ...calibrated.rule,
              threshold: 0.72,
              minVisual: 0.28,
              trustedRaw: 0.5,
              relabelRaw: 0.5,
              cropRaw: 0.5,
            },
          }
          paperBookRescue = true
        }
        if (textScreenshotRescue) {
          calibrated = {
            ...calibrated,
            adjustedScore: Math.max(calibrated.adjustedScore, clampScore(score + 0.24)),
            threshold: 0.58,
            supported: true,
            visualHint: Math.max(calibrated.visualHint, Number(hints?._brightRatio || 0)),
            rule: {
              ...calibrated.rule,
              threshold: 0.58,
              minVisual: 0.78,
              trustedRaw: 0.35,
              relabelRaw: 0.35,
              cropRaw: 0.35,
            },
          }
        }
        if (
          candidate.crop === 'full' &&
          normalizedRaw === 'layar' &&
          score >= fullCoolScreenProfile[0] &&
          Number(hints?._coolScreen || 0) >= fullCoolScreenProfile[1]
        ) {
          calibrated = {
            ...calibrated,
            adjustedScore: Math.max(calibrated.adjustedScore, clampScore(score + fullCoolScreenProfile[2])),
            threshold: fullCoolScreenProfile[3],
            supported: true,
            visualHint: Math.max(calibrated.visualHint, Number(hints?._coolScreen || 0)),
            rule: {
              ...calibrated.rule,
              threshold: fullCoolScreenProfile[3],
              minVisual: fullCoolScreenProfile[1],
              trustedRaw: fullCoolScreenProfile[4],
              relabelRaw: fullCoolScreenProfile[4],
              cropRaw: fullCoolScreenProfile[4],
            },
          }
        }
        if (
          normalizedRaw === 'tulisan_tangan' &&
          score >= 0.36 &&
          Number(hints?._brightRatio || 0) >= 0.82 &&
          Number(hints?._skinRatio || 0) < 0.05 &&
          Number(hints?._phoneObject || 0) < 0.1 &&
          Number(hints?._coolScreen || 0) < 0.1
        ) {
          calibrated = {
            ...calibrated,
            adjustedScore: Math.max(calibrated.adjustedScore, clampScore(score + 0.22)),
            threshold: 0.58,
            supported: true,
            visualHint: Math.max(calibrated.visualHint, Number(hints?._brightRatio || 0)),
            rule: {
              ...calibrated.rule,
              threshold: 0.58,
              minVisual: 0.82,
              trustedRaw: 0.36,
              relabelRaw: 0.36,
              cropRaw: 0.36,
            },
          }
          brightTextRescue = true
        }
        if (
          normalizedRaw === 'layar' &&
          score >= 0.3 &&
          Number(hints?._coolScreen || 0) >= 0.95 &&
          Number(hints?._skinRatio || 0) < 0.2
        ) {
          calibrated = {
            ...calibrated,
            adjustedScore: Math.max(calibrated.adjustedScore, clampScore(score + 0.42)),
            threshold: 0.72,
            supported: true,
            visualHint: Math.max(calibrated.visualHint, Number(hints?._coolScreen || 0)),
            rule: {
              ...calibrated.rule,
              threshold: 0.72,
              minVisual: 0.95,
              trustedRaw: 0.3,
              relabelRaw: 0.3,
              cropRaw: 0.3,
            },
          }
        }
        if (
          normalizedRaw === 'layar' &&
          score >= 0.58 &&
          Number(hints?._darkRatio || 0) >= 0.28 &&
          Number(hints?._darkRatio || 0) <= 0.56 &&
          Number(hints?._darkNeutralRatio || 0) >= 0.68 &&
          Number(hints?._inkRatio || 0) >= 0.62 &&
          Number(hints?._saturatedRatio || 0) < 0.18 &&
          Number(hints?._brightRatio || 0) < 0.04 &&
          Number(hints?._skinRatio || 0) < 0.28
        ) {
          calibrated = {
            ...calibrated,
            adjustedScore: Math.max(calibrated.adjustedScore, clampScore(score + 0.18)),
            threshold: 0.72,
            supported: true,
            visualHint: Math.max(calibrated.visualHint, Number(hints?._darkNeutralRatio || 0)),
            rule: {
              ...calibrated.rule,
              threshold: 0.72,
              minVisual: 0.68,
              trustedRaw: 0.58,
              relabelRaw: 0.58,
              cropRaw: 0.58,
            },
          }
          largeLaptopScreenRescue = true
        }
        if (
          normalizedRaw === 'buku' &&
          label === 'buku' &&
          score >= 0.5 &&
          Number(hints?._brightRatio || 0) >= 0.28 &&
          Number(hints?._brightRatio || 0) <= 0.58 &&
          Number(hints?._inkRatio || 0) < 0.18 &&
          Number(hints?._saturatedRatio || 0) >= 0.35 &&
          Number(hints?._saturatedRatio || 0) <= 0.75 &&
          Number(hints?._skinRatio || 0) < 0.72 &&
          Number(hints?._phoneObject || 0) < 0.12 &&
          Number(hints?._coolScreen || 0) < 0.12
        ) {
          calibrated = {
            ...calibrated,
            adjustedScore: Math.max(calibrated.adjustedScore, clampScore(score + 0.24)),
            threshold: 0.72,
            supported: true,
            visualHint: Math.max(calibrated.visualHint, Number(hints?._brightRatio || 0)),
            rule: {
              ...calibrated.rule,
              threshold: 0.72,
              minVisual: 0.28,
              trustedRaw: 0.5,
              relabelRaw: 0.5,
              cropRaw: 0.5,
            },
          }
          paperBookRescue = true
        }
        if (
          normalizedRaw === 'buku' &&
          label === 'buku' &&
          score >= 0.58 &&
          Number(hints?._inkRatio || 0) >= 0.55 &&
          Number(hints?._inkRatio || 0) <= 0.72 &&
          Number(hints?._skinRatio || 0) >= 0.32 &&
          Number(hints?._skinRatio || 0) <= 0.52 &&
          Number(hints?._brightRatio || 0) < 0.01 &&
          Number(hints?._coolScreen || 0) >= 0.25 &&
          Number(hints?._coolScreen || 0) <= 0.65 &&
          Number(hints?._phoneObject || 0) < 0.08
        ) {
          calibrated = {
            ...calibrated,
            adjustedScore: Math.max(calibrated.adjustedScore, clampScore(score + 0.18)),
            threshold: 0.72,
            supported: true,
            visualHint: Math.max(calibrated.visualHint, Number(hints?._coolScreen || 0)),
            rule: {
              ...calibrated.rule,
              threshold: 0.72,
              minVisual: 0.25,
              trustedRaw: 0.58,
              relabelRaw: 0.58,
              cropRaw: 0.58,
            },
          }
          paperBookRescue = true
        }
        if (
          normalizedRaw === 'layar' &&
          score >= fullDarkScreenProfile[0] &&
          Number(hints?._fullDarkScreen || 0) >= finalProfile[4]
        ) {
          calibrated = {
            ...calibrated,
            adjustedScore: Math.max(calibrated.adjustedScore, clampScore(score + fullDarkScreenProfile[7])),
            threshold: finalProfile[0],
            supported: true,
            visualHint: Math.max(calibrated.visualHint, Number(hints?._fullDarkScreen || 0)),
            rule: {
              ...calibrated.rule,
              threshold: finalProfile[0],
              minVisual: finalProfile[4],
              trustedRaw: fullDarkScreenProfile[0],
              relabelRaw: fullDarkScreenProfile[0],
              cropRaw: fullDarkScreenProfile[0],
            },
          }
        }
        if (
          normalizedRaw === 'layar' &&
          Number(hints?._coolScreen || 0) >= paperColorScreenNegativeProfile[0] &&
          Number(hints?._skinRatio || 0) >= paperColorScreenNegativeProfile[1] &&
          Number(hints?._inkRatio || 0) >= paperColorScreenNegativeProfile[2] &&
          score < paperColorScreenNegativeProfile[3]
        ) {
          calibrated = {
            ...calibrated,
            adjustedScore: calibrated.adjustedScore * paperColorScreenNegativeProfile[4],
            supported: false,
          }
        }
        if (
          normalizedRaw === 'hp' &&
          score >= phoneRawProfile[0] &&
          Number(hints?._phoneObject || 0) >= phoneRawProfile[1]
        ) {
          calibrated = {
            ...calibrated,
            adjustedScore: Math.max(calibrated.adjustedScore, clampScore(score + phoneRawProfile[2])),
            threshold: phoneRawProfile[3],
            supported: true,
            visualHint: Math.max(calibrated.visualHint, Number(hints?._phoneObject || 0)),
            rule: {
              ...calibrated.rule,
              threshold: phoneRawProfile[3],
              minVisual: phoneRawProfile[1],
              trustedRaw: phoneRawProfile[4],
              relabelRaw: phoneRawProfile[4],
              cropRaw: phoneRawProfile[5],
            },
          }
        }
        if (
          normalizedRaw === 'buku' &&
          label === 'layar' &&
          score >= screenContentPhoneProfile[0] &&
          Number(hints?._coolScreen || 0) >= screenContentPhoneProfile[1]
        ) {
          calibrated = {
            ...calibrated,
            adjustedScore: Math.max(calibrated.adjustedScore, clampScore(score + screenContentPhoneProfile[2])),
            threshold: screenContentPhoneProfile[3],
            supported: true,
            visualHint: Math.max(calibrated.visualHint, Number(hints?._coolScreen || 0)),
            rule: {
              ...calibrated.rule,
              threshold: screenContentPhoneProfile[3],
              minVisual: screenContentPhoneProfile[1],
              trustedRaw: screenContentPhoneProfile[4],
              relabelRaw: screenContentPhoneProfile[4],
              cropRaw: screenContentPhoneProfile[5],
            },
          }
        }
        const prototypeLabelScore = prototypeMatch.byLabel[label] || 0
        const prototypePositiveAllowed = label !== 'tulisan_tangan' || normalizedRaw !== 'tulisan_tangan' || score >= 0.65
        let prototypeBoosted = false
        if (
          prototypePositiveAllowed &&
          prototypeLabelScore >= prototypePositiveProfile[0] &&
          score >= prototypePositiveProfile[1] &&
          prototypeLabelScore >= prototypeHardNegative + prototypePositiveProfile[4]
        ) {
          calibrated = {
            ...calibrated,
            adjustedScore: Math.max(calibrated.adjustedScore, clampScore(score + prototypePositiveProfile[2])),
            threshold: prototypePositiveProfile[3],
            supported: true,
            visualHint: Math.max(calibrated.visualHint, prototypeLabelScore),
            rule: {
              ...calibrated.rule,
              threshold: prototypePositiveProfile[3],
              minVisual: prototypePositiveProfile[0],
              trustedRaw: prototypePositiveProfile[1],
              relabelRaw: prototypePositiveProfile[1],
              cropRaw: prototypePositiveProfile[1],
            },
          }
          prototypeBoosted = true
        }
        if (
          !brightTextRescue &&
          !textScreenshotRescue &&
          !largeLaptopScreenRescue &&
          !paperBookRescue &&
          prototypeHardNegative >= prototypeHardNegativeProfile[0] &&
          prototypeHardNegative >= prototypeLabelScore + prototypeHardNegativeProfile[1] &&
          score < prototypeHardNegativeProfile[3]
        ) {
          calibrated = {
            ...calibrated,
            adjustedScore: calibrated.adjustedScore * prototypeHardNegativeProfile[2],
            supported: false,
          }
        }

        const { adjustedScore, threshold, supported, visualHint, rule } = calibrated

        if (!reason || !supported || adjustedScore < threshold) continue
        // Aturan yang sama dengan REJECTION_RULES['layar_weak_prototype'] di
        // customDecision.js (sebelumnya ditulis ulang di sini secara manual).
        if (isRejectedByRule('layar_weak_prototype', {
          classHead: getClassHead(label),
          label,
          prototypeBoosted,
          largeLaptopScreenRescue,
          rawScore: score,
          hintCoolScreen: hints?._coolScreen,
          hintPhoneObject: hints?._phoneObject,
          hintFullDarkScreen: hints?._fullDarkScreen,
        })) {
          continue
        }

        const previous = bestByReason.get(reason)
        if (!previous || adjustedScore > previous.score) {
          const item = {
            reason,
            label,
            score: adjustedScore,
            rawScore: score,
            rawLabel,
            visualScore: visualHint,
            rule,
            classHead: getClassHead(label),
            crop: candidate.crop,
            calibrated: true,
            prototypeBoosted,
            brightTextRescue,
            textScreenshotRescue,
            largeLaptopScreenRescue,
            paperBookRescue,
            prototypeLabelScore,
            prototypeHardNegative,
            hintSkinRatio: Number(hints?._skinRatio || 0),
            hintInkRatio: Number(hints?._inkRatio || 0),
            hintDarkNeutralRatio: Number(hints?._darkNeutralRatio || 0),
            hintSaturatedRatio: Number(hints?._saturatedRatio || 0),
            hintBrightRatio: Number(hints?._brightRatio || 0),
            hintCoolScreen: Number(hints?._coolScreen || 0),
            hintPhoneObject: Number(hints?._phoneObject || 0),
            hintFullDarkScreen: Number(hints?._fullDarkScreen || 0),
            hintMirrorReflection: Number(hints?._mirrorReflection || 0),
          }
          keepBestDetection(bestByReason, bestByHead, item)
        }
      }
    }
  }

  const selected = selectCustomDetections(acceptCustomDetections(bestByReason, calibration), calibration)
  microLog('detect_done', {
    ms: Date.now() - started,
    crops: candidates.length,
    found: selected.found.length,
  })
  return { ...selected, crops: candidates.length }
}

