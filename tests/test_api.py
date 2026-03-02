from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import app
from app.schemas import HistoryItem, VoiceOption


client = TestClient(app)


class FakeHistoryStore:
    def __init__(self) -> None:
        self.items: list[HistoryItem] = []

    def list(self, limit: int = 20) -> list[HistoryItem]:
        return self.items[:limit]

    def append(self, item: HistoryItem) -> None:
        self.items = [item, *self.items]

    def delete(self, item_id: str) -> bool:
        before = len(self.items)
        self.items = [item for item in self.items if item.id != item_id]
        return len(self.items) < before

    def clear(self) -> int:
        removed = len(self.items)
        self.items = []
        return removed


async def _fake_voices(
    locale: str | None = None,
    search: str | None = None,
    gender: str | None = None,
    limit: int = 200,
) -> list[VoiceOption]:
    voices = [
        VoiceOption(short_name="en-US-AriaNeural", display_name="Aria", locale="en-US", gender="Female"),
        VoiceOption(short_name="en-US-GuyNeural", display_name="Guy", locale="en-US", gender="Male"),
    ]

    filtered = []
    for voice in voices:
        if locale and not voice.locale.lower().startswith(locale.lower()):
            continue
        if gender and (voice.gender or "").lower() != gender.lower():
            continue
        if search and search.lower() not in voice.short_name.lower() and search.lower() not in voice.display_name.lower():
            continue
        filtered.append(voice)

    return filtered[:limit]


async def _fake_speech(payload, output_path):
    output_path.write_bytes(b"fake-mp3")
    return payload.voice or "en-US-AriaNeural"


async def _fake_speech_fail_some(payload, output_path):
    if "fail" in payload.text.lower():
        raise RuntimeError("simulated failure")
    output_path.write_bytes(b"fake-mp3")
    return payload.voice or "en-US-AriaNeural"


def _patch_dependencies(monkeypatch, with_fail: bool = False) -> FakeHistoryStore:
    from app import main

    fake_store = FakeHistoryStore()
    monkeypatch.setattr(main, "list_available_voices", _fake_voices)
    monkeypatch.setattr(main, "synthesize_speech", _fake_speech_fail_some if with_fail else _fake_speech)
    monkeypatch.setattr(main, "history_store", fake_store)
    return fake_store


def test_health() -> None:
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"
    assert response.json()["version"] == "0.4.0"


def test_get_voices_with_filters(monkeypatch) -> None:
    from app import main

    monkeypatch.setattr(main, "list_available_voices", _fake_voices)

    response = client.get("/api/voices?search=aria&gender=Female")
    assert response.status_code == 200
    payload = response.json()
    assert len(payload) == 1
    assert payload[0]["short_name"] == "en-US-AriaNeural"


def test_presets_available() -> None:
    response = client.get("/api/presets")
    assert response.status_code == 200
    assert len(response.json()) >= 1


def test_speak_success(monkeypatch) -> None:
    _patch_dependencies(monkeypatch)

    response = client.post(
        "/api/speak",
        json={"text": "Hello world", "voice": "en-US-AriaNeural", "rate": 0, "pitch": 0, "format": "mp3"},
    )

    assert response.status_code == 200
    data = response.json()
    assert data["voice"] == "en-US-AriaNeural"
    assert data["locale"] == "en-US"
    assert data["characters"] == 11
    assert data["audio_url"].startswith("/audio/")


def test_batch_speak_success(monkeypatch) -> None:
    _patch_dependencies(monkeypatch)

    response = client.post(
        "/api/speak/batch",
        json={
            "texts": ["Line one", "Line two"],
            "voice": "en-US-AriaNeural",
            "rate": 0,
            "pitch": 0,
            "format": "mp3",
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["total"] == 2
    assert payload["success"] == 2
    assert payload["failed"] == 0
    assert payload["items"][0]["success"] is True
    assert payload["items"][0]["result"]["audio_url"].startswith("/audio/")


def test_batch_partial_failure(monkeypatch) -> None:
    _patch_dependencies(monkeypatch, with_fail=True)

    response = client.post(
        "/api/speak/batch",
        json={
            "texts": ["normal line", "this should fail", "another normal"],
            "voice": "en-US-AriaNeural",
            "rate": 0,
            "pitch": 0,
            "format": "mp3",
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["total"] == 3
    assert payload["success"] == 2
    assert payload["failed"] == 1
    assert any(not item["success"] for item in payload["items"])


def test_history_list_and_delete(monkeypatch) -> None:
    fake_store = _patch_dependencies(monkeypatch)

    create_response = client.post(
        "/api/speak",
        json={"text": "History test", "voice": "en-US-AriaNeural", "rate": 0, "pitch": 0, "format": "mp3"},
    )
    assert create_response.status_code == 200
    item_id = create_response.json()["id"]
    assert len(fake_store.items) == 1

    list_response = client.get("/api/history")
    assert list_response.status_code == 200
    assert list_response.json()[0]["id"] == item_id

    stats_response = client.get("/api/stats")
    assert stats_response.status_code == 200
    assert stats_response.json()["history_count"] == 1

    delete_response = client.delete(f"/api/history/{item_id}")
    assert delete_response.status_code == 200
    assert delete_response.json()["deleted"] == item_id

    missing_response = client.delete(f"/api/history/{item_id}")
    assert missing_response.status_code == 404


def test_history_clear(monkeypatch) -> None:
    _patch_dependencies(monkeypatch)
    client.post(
        "/api/speak",
        json={"text": "item one", "voice": "en-US-AriaNeural", "rate": 0, "pitch": 0, "format": "mp3"},
    )
    client.post(
        "/api/speak",
        json={"text": "item two", "voice": "en-US-AriaNeural", "rate": 0, "pitch": 0, "format": "mp3"},
    )

    clear_response = client.delete("/api/history")
    assert clear_response.status_code == 200
    assert clear_response.json()["removed"] == 2

    empty_response = client.get("/api/history")
    assert empty_response.status_code == 200
    assert empty_response.json() == []


def test_speak_unknown_voice(monkeypatch) -> None:
    _patch_dependencies(monkeypatch)

    response = client.post(
        "/api/speak",
        json={"text": "Hello", "voice": "en-US-UnknownNeural", "rate": 0, "pitch": 0, "format": "mp3"},
    )

    assert response.status_code == 400


def test_speak_empty_text(monkeypatch) -> None:
    _patch_dependencies(monkeypatch)

    response = client.post(
        "/api/speak",
        json={"text": "   ", "voice": "en-US-AriaNeural", "rate": 0, "pitch": 0, "format": "mp3"},
    )

    assert response.status_code == 422


def test_batch_empty_payload(monkeypatch) -> None:
    _patch_dependencies(monkeypatch)

    response = client.post(
        "/api/speak/batch",
        json={"texts": ["   ", ""], "voice": "en-US-AriaNeural", "rate": 0, "pitch": 0, "format": "mp3"},
    )

    assert response.status_code == 422
