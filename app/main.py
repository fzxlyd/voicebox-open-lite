from __future__ import annotations

import os
from datetime import datetime, timezone
from pathlib import Path
from time import perf_counter
from uuid import uuid4

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.history_store import HistoryStore
from app.schemas import (
    BatchSpeakItem,
    BatchSpeakRequest,
    BatchSpeakResponse,
    HistoryItem,
    PresetItem,
    SpeakRequest,
    SpeakResponse,
    VoiceOption,
)
from app.tts_engine import DEFAULT_VOICE, list_available_voices, parse_locale_from_voice, synthesize_speech

BASE_DIR = Path(__file__).resolve().parent.parent
WEB_DIR = Path(os.getenv("VOXA_WEB_DIR", str(BASE_DIR / "web"))).expanduser().resolve()
OUTPUT_DIR = Path(os.getenv("VOXA_OUTPUT_DIR", str(BASE_DIR / "outputs"))).expanduser().resolve()
HISTORY_FILE = Path(os.getenv("VOXA_HISTORY_FILE", str(OUTPUT_DIR / "history.json"))).expanduser().resolve()
INDEX_FILE = WEB_DIR / "index.html"

OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
history_store = HistoryStore(HISTORY_FILE, OUTPUT_DIR)

PRESETS: list[PresetItem] = [
    PresetItem(
        id="short-video-hook",
        title="Short Video Hook",
        locale="en-US",
        text="Stop scrolling for 8 seconds. This workflow lets you publish faster without sacrificing quality.",
    ),
    PresetItem(
        id="product-teaser",
        title="Product Teaser",
        locale="en-US",
        text="Meet the new release. Cleaner controls, faster output, and zero setup friction.",
    ),
    PresetItem(
        id="support-reply",
        title="Support Reply",
        locale="en-US",
        text="Thanks for contacting us. We fixed the issue and your workspace should now load correctly.",
    ),
    PresetItem(
        id="podcast-intro",
        title="Podcast Intro",
        locale="en-US",
        text="Welcome back. In this episode, we break down the product decisions that changed everything.",
    ),
    PresetItem(
        id="launch-cn",
        title="中文发布通知",
        locale="zh-CN",
        text="大家好，今天我们正式上线新版本，速度更快，界面更清晰，欢迎体验。",
    ),
    PresetItem(
        id="education-tip",
        title="Learning Tip",
        locale="en-US",
        text="If you want better outcomes, split your goal into tiny actions and repeat daily for seven days.",
    ),
]

app = FastAPI(
    title="Voxa Studio",
    description="Open-source text-to-speech studio inspired by voicebox.",
    version="0.4.0",
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


@app.delete("/api/history")
async def clear_history() -> dict[str, int]:
    removed = history_store.clear()
    return {"removed": removed}


def _text_preview(text: str, limit: int = 96) -> str:
    normalized = " ".join(text.split())
    if len(normalized) <= limit:
        return normalized
    return f"{normalized[:limit].rstrip()}..."


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


async def _voice_map() -> dict[str, VoiceOption]:
    voices = await list_available_voices(limit=500)
    return {voice.short_name: voice for voice in voices}


def _assert_voice(selected_voice: str, voices: dict[str, VoiceOption]) -> None:
    if selected_voice not in voices:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown voice '{selected_voice}'. Use /api/voices to list supported voices.",
        )


async def _generate_single(payload: SpeakRequest, voices: dict[str, VoiceOption]) -> SpeakResponse:
    file_id = uuid4().hex
    file_name = f"{file_id}.{payload.format}"
    output_path = OUTPUT_DIR / file_name

    try:
        final_voice = await synthesize_speech(payload, output_path)
    except Exception as exc:
        raise RuntimeError(f"TTS generation failed: {exc}") from exc

    locale = voices.get(final_voice).locale if final_voice in voices else parse_locale_from_voice(final_voice)
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


@app.post("/api/speak", response_model=SpeakResponse)
async def speak(payload: SpeakRequest) -> SpeakResponse:
    selected_voice = payload.voice or DEFAULT_VOICE
    payload.voice = selected_voice

    voices = await _voice_map()
    _assert_voice(selected_voice, voices)

    try:
        return await _generate_single(payload, voices)
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/speak/batch", response_model=BatchSpeakResponse)
async def speak_batch(payload: BatchSpeakRequest) -> BatchSpeakResponse:
    selected_voice = payload.voice or DEFAULT_VOICE
    voices = await _voice_map()
    _assert_voice(selected_voice, voices)

    started = perf_counter()
    items: list[BatchSpeakItem] = []
    success_count = 0

    for idx, text in enumerate(payload.texts):
        row_payload = SpeakRequest(
            text=text,
            voice=selected_voice,
            rate=payload.rate,
            pitch=payload.pitch,
            format=payload.format,
        )

        try:
            result = await _generate_single(row_payload, voices)
            items.append(
                BatchSpeakItem(
                    index=idx,
                    success=True,
                    text_preview=result.text_preview,
                    result=result,
                )
            )
            success_count += 1
        except RuntimeError as exc:
            items.append(
                BatchSpeakItem(
                    index=idx,
                    success=False,
                    text_preview=_text_preview(text),
                    error=str(exc),
                )
            )

    duration_ms = int((perf_counter() - started) * 1000)

    return BatchSpeakResponse(
        total=len(payload.texts),
        success=success_count,
        failed=len(payload.texts) - success_count,
        duration_ms=duration_ms,
        items=items,
    )
