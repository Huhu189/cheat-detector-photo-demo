# Cheat Detector — Photo Demo

Demo statis untuk menguji `cheat-detector.tflite` lewat upload foto.

## Isi

- `index.html` — UI upload dan hasil prediksi
- `app.js` — inferensi MediaPipe ImageClassifier di browser
- `styles.css` — tampilan
- `cheat-detector.tflite` — model hasil training terbaru

## Menjalankan lokal

```bash
python3 -m http.server 8080
```

Lalu buka `http://localhost:8080`.

## Catatan

- Demo menjalankan satu inferensi full-frame 128×128, tanpa crop ensemble.
- Calibration `.bin` tidak dipakai di demo ini.
- Model dievaluasi 88,43% pada validation set, tetapi foto bebas di luar dataset
  bisa jauh lebih rendah.
- Tidak ada foto yang diunggah ke server; semua proses di browser.
