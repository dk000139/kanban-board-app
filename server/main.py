import io
from typing import List

import numpy as np
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from paddleocr import PaddleOCR
from PIL import Image

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"]
)

# CPUでPaddleOCRを初期化（日本語＋英語を対象）
ocr = PaddleOCR(lang="japan", use_gpu=False, show_log=False)


@app.get("/health")
async def health_check():
    return {"status": "ok"}


@app.post("/api/ocr")
async def run_ocr(file: UploadFile = File(...)):
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="画像ファイルをアップロードしてください。")

    file_bytes = await file.read()

    try:
        image = Image.open(io.BytesIO(file_bytes)).convert("RGB")
    except Exception as exc:
        raise HTTPException(status_code=400, detail="画像を読み込めませんでした。") from exc

    image_np = np.array(image)

    try:
        ocr_result = ocr.ocr(image_np, cls=True)
    except Exception as exc:
        raise HTTPException(status_code=500, detail="OCR処理中にエラーが発生しました。") from exc

    segments: List[dict] = []
    for block in ocr_result:
        for line in block:
            polygon = line[0]
            text, confidence = line[1]
            if not text:
                continue
            x_coords = [point[0] for point in polygon]
            y_coords = [point[1] for point in polygon]
            segments.append(
                {
                    "text": text,
                    "confidence": float(confidence),
                    "polygon": polygon,
                    "bbox": [
                        float(min(x_coords)),
                        float(min(y_coords)),
                        float(max(x_coords)),
                        float(max(y_coords))
                    ]
                }
            )

    combined_text = "\n".join(item["text"] for item in segments)

    return {"text": combined_text, "segments": segments}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
