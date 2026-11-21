// Constants and static thresholds for the browser object detector.
export const CUSTOM_MODEL_URL = './cheat-detector.tflite'
export const CUSTOM_CALIBRATION_URL = './cheat-detector-calibration.bin'
export const GENERIC_MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/int8/1/efficientdet_lite0.tflite'
export const ENABLE_GENERIC_FALLBACK = false

export const CUSTOM_LOAD_TIMEOUT_MS = 15_000
export const GENERIC_LOAD_TIMEOUT_MS = 20_000
export const CUSTOM_FAILURE_COOLDOWN_MS = 5 * 60 * 1000
export const GENERIC_MIN_SCORE = 0.45
export const CUSTOM_CROP_SIZE = 128
export const CUSTOM_CROP_FRACTIONS = [0.58, 0.36]
export const MAX_CUSTOM_CROPS = 26
// Profil HP entry: full-frame + 16 crop besar (grid 4x4) + 4 crop kecil di
// sudut. Full-frame TIDAK pernah dilewati; crop kecil tengah/tepi yang
// dilewati, bukan sudut tempat HP sering dipegang.
export const LOW_END_MAX_CUSTOM_CROPS = 21
export const LOW_END_CORE_LIMIT = 4
export const LOW_END_MEMORY_GB = 4

export function customCropLimit() {
  if (typeof navigator === 'undefined') return MAX_CUSTOM_CROPS
  const cores = Number(navigator.hardwareConcurrency || 0)
  const memory = Number(navigator.deviceMemory || 0)
  const lowEnd = (cores > 0 && cores <= LOW_END_CORE_LIMIT) ||
    (memory > 0 && memory <= LOW_END_MEMORY_GB)
  return lowEnd ? LOW_END_MAX_CUSTOM_CROPS : MAX_CUSTOM_CROPS
}
export const CALIBRATION_MAGIC_V1 = 'CDCAL01\0'
export const CALIBRATION_MAGIC_V2 = 'CDCAL02\0'
export const CALIBRATION_MAGIC_V3 = 'CDCAL03\0'
export const CALIBRATION_MAGIC_V4 = 'CDCAL04\0'
// Batas sidecar yang diterima browser. Bin lama 42.648 byte; plugin baru
// maksimal 74.984 byte. File lebih besar ditolak, bukan diproses.
export const CALIBRATION_MAX_BYTES = 75_000
export const CALIBRATION_RECORD_BYTES_V1 = 24
export const CALIBRATION_RECORD_BYTES_V2 = 40
export const CALIBRATION_MARKER_VALUES = 8
export const CALIBRATION_MARKER_RECORD_BYTES = CALIBRATION_MARKER_VALUES * 4
export const CALIBRATION_PROTOTYPE_FEATURES = 12
export const CALIBRATION_PROTOTYPE_RECORD_BYTES = 8 + CALIBRATION_PROTOTYPE_FEATURES * 4
export const CUSTOM_LABELS = ['hp', 'buku', 'layar', 'tulisan_tangan', 'tidak_dikenali']

export const MARKER_PROFILE_KEYS = [
  'skinPenalty',
  'tallElectronic',
  'brightFramedPhone',
  'whiteScreenPhone',
  'wideShape',
  'coolScreen',
  'paperSurface',
  'bookSurface',
  'handwritingSurface',
  'relabelElectronic',
  'relabelWriting',
  'finalGate',
  'fullCoolScreenEvidence',
  'phoneObject',
  'fullDarkScreenEvidence',
  'phoneRawEvidence',
  'screenContentPhoneEvidence',
  'prototypePositiveGate',
  'prototypeHardNegativeGate',
  'paperColorScreenNegative',
]

export const DEFAULT_MARKER_PROFILES = {
  skinPenalty:        [0.34, 0.22, 0.45, 0, 0, 0, 0, 0],
  tallElectronic:     [0.09, 0.18, 34, 46, 38, 22, 0.92, 0.3],
  brightFramedPhone:  [0.34, 0.52, 0.08, 0.2, 0.46, 0.28, 1.1, 0.35],
  whiteScreenPhone:   [0.4, 0.62, 0.05, 0.18, 0.035, 0.12, 0.24, 0.14],
  wideShape:          [0.13, 0.22, 42, 54, 18, 30, 1.25, 1.75],
  coolScreen:         [0.14, 0.28, 0.2, 0.36, 28, 44, 16, 28],
  paperSurface:       [0.52, 0.32, 0.1, 36, 18, 1.05, 0.55, 0.55],
  bookSurface:        [0.52, 0.72, 0.024, 0.075, 0, 0, 0, 0],
  handwritingSurface: [0.48, 0.68, 0.035, 0.095, 0, 0, 0, 0],
  relabelElectronic:  [0.5, 0.72, 0.7, 0.75, 0.82, 0.72, 0.6, 0.72],
  relabelWriting:     [0.62, 0.58, 0.74, 0, 0, 0, 0, 0],
  finalGate:          [0.72, 0.88, 0.58, 0.8, 0.2, 0.985, 0.12, 0.55],
  fullCoolScreenEvidence: [0.42, 0.8, 0.3, 0.72, 0.42, 0, 0, 0],
  phoneObject:        [0.64, 0.3, 0.48, 0.35, 0.48, 0.75, 0.2, 0.12],
  fullDarkScreenEvidence: [0.5, 0.25, 0.45, 0.35, 0.5, 0.14, 0.08, 0.25],
  phoneRawEvidence:   [0.32, 0.62, 0.36, 0.72, 0.32, 0.32, 0, 0],
  screenContentPhoneEvidence: [0.85, 0.85, 0.28, 0.72, 0.34, 0.55, 0, 0],
  prototypePositiveGate: [0.94, 0.12, 0.42, 0.72, 0.006, 0, 0, 0],
  prototypeHardNegativeGate: [0.89, 0, 0.52, 0.95, 0, 0, 0, 0],
  paperColorScreenNegative: [0.8, 0.12, 0.75, 0.72, 0.55, 0, 0, 0],
}

export const CONFIDENCE_THRESHOLDS = {
  hp:             0.85,
  buku:           0.7,
  layar:          0.6,
  tulisan_tangan: 0.4,
}
export const DEFAULT_CONFIDENCE = 0.5

export const CLASS_TO_REASON = {
  hp:             'object_phone',
  buku:           'object_book_or_notes',
  layar:          'object_second_device',
  tulisan_tangan: 'object_handwriting',
}

export const CLASS_TO_HEAD = {
  hp:             'elektronik',
  layar:          'elektronik',
  buku:           'buku_catatan',
  tulisan_tangan: 'buku_catatan',
}

export const GENERIC_LABEL_RULES = [
  { reason: 'object_phone', labels: ['cell phone', 'mobile phone', 'phone', 'smartphone'] },
  { reason: 'object_book_or_notes', labels: ['book', 'notebook', 'notes', 'paper'] },
  { reason: 'object_second_device', labels: ['laptop', 'tv', 'monitor', 'screen', 'computer'] },
  { reason: 'object_handwriting', labels: ['handwriting', 'hand written', 'written note', 'pen', 'pencil'] },
]
