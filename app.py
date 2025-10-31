from flask import Flask, render_template, request, jsonify, send_file
from flask_cors import CORS
from yt_dlp import YoutubeDL
from pathlib import Path
import os

app = Flask(__name__)
CORS(app)  # Enables communication from frontend (if hosted separately)

# Folder to store downloaded videos
MEDIA_DIR = Path("downloads")
MEDIA_DIR.mkdir(exist_ok=True)

# yt-dlp settings
YTDL_OPTS = {
    "format": "best",
    "outtmpl": str(MEDIA_DIR / "%(id)s.%(ext)s"),
    "noplaylist": True,
    "quiet": True,
    "no_warnings": True,
}

def download_video(url):
    """Download the video and return the file path."""
    with YoutubeDL(YTDL_OPTS) as ydl:
        info = ydl.extract_info(url, download=True)
        filepath = ydl.prepare_filename(info)
        return filepath

# Serve the frontend
@app.route("/")
def index():
    return render_template("index.html")

# API endpoint to handle download requests
@app.route("/api/download", methods=["POST"])
def api_download():
    data = request.get_json()
    url = data.get("url")

    if not url:
        return jsonify({"error": "No URL provided"}), 400

    try:
        filepath = download_video(url)
        if not os.path.exists(filepath):
            return jsonify({"error": "Download failed"}), 500

        filename = os.path.basename(filepath)
        return send_file(filepath, as_attachment=True, download_name=filename)

    except Exception as e:
        print(f"[ERROR] {e}")
        return jsonify({"error": str(e)}), 500


if __name__ == "__main__":
    app.run(debug=True, port=5000)
