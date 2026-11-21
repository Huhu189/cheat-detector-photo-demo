# Cheat Detector — Photo Demo

Demo statis untuk menguji `cheat-detector.tflite` lewat upload foto.

## Isi

- `index.html` — UI upload dan dua hasil prediksi
- `app.js` — inferensi MediaPipe, hasil mentah + pipeline kalibrasi
- `styles.css` — tampilan
- `lib/` — parser bin, crop/visual hint, dan decision pipeline dari frontend
- `cheat-detector.tflite` — model hasil training terbaru
- `cheat-detector-calibration.bin` — bin kalibrasi 72.520 byte, 1.291 prototipe

## Menjalankan lokal

```bash
python3 -m http.server 8080
```

Lalu buka `http://localhost:8080`.

## Dua mode hasil

1. **Model mentah** — satu inferensi full-frame 128×128.
2. **Dengan bin** — crop ensemble, visual hint, threshold, prototype, dan
   final gate dari `cheat-detector-calibration.bin`.

## Hasil uji 100 foto internet

20 foto per kelas, sumber Wikimedia Commons + Openverse:

| Mode | Benar |
|---|---:|
| Model mentah full-frame | 58/100 = 58% |
| Dengan bin + crop/gate | 46/100 = 46% |

Bin belum memperbaiki foto internet full-scene. Bin dibuat dari checkpoint
float dan prototype-nya tidak membawa visual hint; pipeline juga dirancang
untuk frame kamera, bukan foto bebas. Model mentah tetap ditampilkan sebagai
pembanding, bukan dihapus.

## Catatan

- Model dievaluasi 88,43% pada validation set, tetapi foto bebas di luar
  dataset bisa jauh lebih rendah.
- Tidak ada foto yang diunggah ke server; semua proses di browser.
- Jangan gunakan hasil demo ini sebagai keputusan final dalam ujian sungguhan.
