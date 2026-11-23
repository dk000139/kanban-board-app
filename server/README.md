## PaddleOCR バックエンドのセットアップ

1. Python 3.9〜3.11 の仮想環境を作成して有効化します。
2. 必要なライブラリをインストールします。
   ```bash
   pip install -r requirements.txt
   ```
   **Mac CPU の場合:** `paddlepaddle` のインストールでエラーが出た際は、公式配布元のホイールを指定してください。
   例:
   ```bash
   pip install paddlepaddle==2.5.2 -f https://www.paddlepaddle.org.cn/whl/macos.html
   ```
3. サーバーを起動します。
   ```bash
    uvicorn main:app --host 0.0.0.0 --port 8000 --reload
   ```
4. `GET http://localhost:8000/health` が `{"status":"ok"}` を返せば準備完了です。

フロントエンド (`my-dashboard-app`) からは `POST http://localhost:8000/api/ocr` に画像を送信します。必要に応じて `REACT_APP_OCR_ENDPOINT` を設定し、プロダクションや別ホストに切り替えてください。
