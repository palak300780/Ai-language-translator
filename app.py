from flask import Flask, render_template, request, jsonify, session
from deep_translator import GoogleTranslator
from langdetect import detect
from gtts import gTTS
import base64
import os
import uuid

app = Flask(__name__)
app.secret_key = "translator_secret_key_2024"

USERS_DB = {}

@app.route("/")
def home():
    return render_template("index.html")

@app.route("/translate", methods=["POST"])
def translate():
    data = request.get_json()
    text = data["text"]
    source = data["source"]
    target = data["target"]
    try:
        detected_lang = detect(text)
        translated = GoogleTranslator(source=source, target=target).translate(text)
        return jsonify({"translated_text": translated, "detected_language": detected_lang})
    except Exception as e:
        return jsonify({"error": str(e)})

@app.route("/speak", methods=["POST"])
def speak():
    data = request.get_json()
    text = data["text"]
    lang = data["lang"]
    speed = data.get("speed", 1.0)
    try:
        slow = speed < 0.8
        tts = gTTS(text=text, lang=lang, slow=slow)
        filename = f"static/output_{uuid.uuid4().hex[:8]}.mp3"
        tts.save(filename)
        return jsonify({"audio": f"/{filename}"})
    except Exception as e:
        return jsonify({"error": str(e)})

@app.route("/correct", methods=["POST"])
def correct():
    data = request.get_json()
    text = data["text"]
    try:
        # Use translation round-trip for basic correction (EN→EN via detect)
        detected = detect(text)
        corrected = GoogleTranslator(source=detected, target="en").translate(text)
        if detected != "en":
            corrected = GoogleTranslator(source="en", target=detected).translate(corrected)
        return jsonify({"corrected": corrected})
    except Exception as e:
        return jsonify({"error": str(e)})

@app.route("/translate_pdf", methods=["POST"])
def translate_pdf():
    try:
        import fitz  # PyMuPDF
        file = request.files["pdf"]
        target = request.form["target"]
        doc = fitz.open(stream=file.read(), filetype="pdf")
        full_text = ""
        for page in doc:
            full_text += page.get_text()
        detected = detect(full_text[:500])
        chunks = [full_text[i:i+4500] for i in range(0, min(len(full_text), 18000), 4500)]
        translated_chunks = []
        for chunk in chunks:
            t = GoogleTranslator(source=detected, target=target).translate(chunk)
            translated_chunks.append(t)
        translated = "\n\n".join(translated_chunks)
        return jsonify({"translated_text": translated, "detected_language": detected, "original_length": len(full_text)})
    except Exception as e:
        return jsonify({"error": str(e)})

@app.route("/register", methods=["POST"])
def register():
    data = request.get_json()
    username = data.get("username", "").strip()
    password = data.get("password", "").strip()
    if not username or not password:
        return jsonify({"error": "Username and password required"})
    if username in USERS_DB:
        return jsonify({"error": "Username already exists"})
    USERS_DB[username] = {"password": password, "history": []}
    session["user"] = username
    return jsonify({"success": True, "username": username})

@app.route("/login", methods=["POST"])
def login():
    data = request.get_json()
    username = data.get("username", "").strip()
    password = data.get("password", "").strip()
    if username not in USERS_DB:
        return jsonify({"error": "User not found"})
    if USERS_DB[username]["password"] != password:
        return jsonify({"error": "Wrong password"})
    session["user"] = username
    return jsonify({"success": True, "username": username, "history": USERS_DB[username]["history"]})

@app.route("/logout", methods=["POST"])
def logout():
    session.pop("user", None)
    return jsonify({"success": True})

@app.route("/save_history", methods=["POST"])
def save_history():
    data = request.get_json()
    username = session.get("user")
    if not username or username not in USERS_DB:
        return jsonify({"error": "Not logged in"})
    entry = data.get("entry")
    USERS_DB[username]["history"].insert(0, entry)
    USERS_DB[username]["history"] = USERS_DB[username]["history"][:20]
    return jsonify({"success": True})

if __name__ == "__main__":
    app.run(debug=True)