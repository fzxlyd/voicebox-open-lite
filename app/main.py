from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.history_store import HistoryStore
from app.schemas import HistoryItem, PresetItem, SpeakRequest, SpeakResponse, VoiceOption
from app.tts_engine import DEFAULT_VOICE, list_available_voices, parse_locale_from_voice, synthesize_speech

BASE_DIR = Path(__file__).resolve().parent.parent
WEB_DIR = BASE_DIR / "web"
OUTPUT_DIR = BASE_DIR / "outputs"
HISTORY_FILE = OUTPUT_DIR / "history.json"
INDEX_FILE = WEB_DIR / "index.html"

OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
history_store = HistoryStore(HISTORY_FILE, OUTPUT_DIR)

PRESETS: list[PresetItem] = [
    PresetItem(
        id="podcast-intro",
        title="Podcast Intro",
        locale="en-US",
        text="Welcome back to the show. Today we are breaking down the biggest product decisions of the week.",
    ),
    PresetItem(
        id="video-hook",
        title="Video Hook",
        locale="en-US",
        text="Stop scrolling. In the next twenty seconds, I will show you a faster way to ship your next launch.",
    ),
    PresetItem(
        id="customer-support",
        title="Support Reply",
        locale="en-US",
        text="Thanks for reaching out. We have applied a fix and your account should be fully operational now.",
    ),
    PresetItem(
        id="product-launch",
        title="Launch Note",
        locale="en-US",
        text="Today we are launching a major upgrade with cleaner controls, faster generation, and better reliability.",
    ),
]

app = FastAPI(
    title="Voxa Studio",
    description="Open-source text-to-speech studio inspired by voicebox.",
    version="0.2.1",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/audio", StaticFiles(directory=OUTPUT_DIR), name="audio")
app.mount("/web", StaticFiles(directory=WEB_DIR), name="web")


@app.get("/")
async def root() -> FileResponse:
    return FileResponse(INDEX_FILE)


@app.get("/api/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "version": app.version}


@app.get("/api/voices", response_model=list[VoiceOption])
async def get_voices(
    locale: str | None = Query(default=None, min_length=2, max_length=16),
    search: str | None = Query(default=None, min_length=1, max_length=48),
    gender: str | None = Query(default=None, min_length=3, max_length=16),
    limit: int = Query(default=200, ge=1, le=500),
) -> list[VoiceOption]:
    voices = await list_available_voices(locale=locale, search=search, gender=gender, limit=limit)
    return voices


@app.get("/api/presets", response_model=list[PresetItem])
async def list_presets() -> list[PresetItem]:
    return PRESETS


@app.get("/api/history", response_model=list[HistoryItem])
async def list_history(limit: int = Query(default=20, ge=1, le=50)) -> list[HistoryItem]:
    return history_store.list(limit=limit)


@app.get("/api/stats")
async def get_stats() -> dict[str, int]:
    items = history_store.list(limit=50)
    total_characters = sum(item.characters for item in items)
    return {"history_count": len(items), "total_characters": total_characters}


@app.delete("/api/history/{item_id}")
async def delete_history_item(item_id: str) -> dict[str, str]:
    deleted = history_store.delete(item_id)
    if not deleted:
        raise HTTPException(status_code=404, detail=f"History item '{item_id}' not found")

    return {"deleted": item_id}


def _text_preview(text: str, limit: int = 96) -> str:
    normalized = " ".join(text.split())
    if len(normalized) <= limit:
        return normalized
    return f"{normalized[:limit].rstrip()}..."


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


@app.post("/api/speak", response_model=SpeakResponse)
async def speak(payload: SpeakRequest) -> SpeakResponse:
    selected_voice = payload.voice or DEFAULT_VOICE

    voices = await list_available_voices(limit=500)
    voice_map = {voice.short_name: voice for voice in voices}
    if selected_voice not in voice_map:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown voice '{selected_voice}'. Use /api/voices to list supported voices.",
        )

    file_id = uuid4().hex
    file_name = f"{file_id}.{payload.format}"
    output_path = OUTPUT_DIR / file_name

    try:
        final_voice = await synthesize_speech(payload, output_path)
    except Exception as exc:  # pragma: no cover
        raise HTTPException(status_code=500, detail=f"TTS generation failed: {exc}") from exc

    locale = voice_map.get(final_voice).locale if final_voice in voice_map else parse_locale_from_voice(final_voice)
    history_item = HistoryItem(
        id=file_id,
        voice=final_voice,
        locale=locale,
        rate=payload.rate,
        pitch=payload.pitch,
        format=payload.format,
        audio_url=f"/audio/{file_name}",
        created_at=_utc_now_iso(),
        characters=len(payload.text.strip()),
        text_preview=_text_preview(payload.text),
    )
    history_store.append(history_item)

    return SpeakResponse(**history_item.model_dump())
