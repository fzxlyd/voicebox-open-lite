# Voxa Studio

Open-source text-to-speech starter inspired by [jamiepine/voicebox](https://github.com/jamiepine/voicebox).

[![CI](https://github.com/fzxlyd/voicebox-open-lite/actions/workflows/ci.yml/badge.svg)](https://github.com/fzxlyd/voicebox-open-lite/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE)
[![Python 3.11](https://img.shields.io/badge/python-3.11-blue.svg)](https://www.python.org/)

This project gives you a deployable baseline with:

- FastAPI backend
- Studio-grade browser UI with branded design system
- MP3 generation endpoint
- Voice search/filter (`search`, `locale`, `gender`, `limit`)
- Preset script templates
- Persistent render history (replay / copy link / delete)
- Runtime stats panel
- Docker support
- GitHub Actions CI

## UI Preview

![Voxa Studio demo](output/playwright/demo.png)

## Demo Features

- `GET /api/health` health check
- `GET /api/voices` list voices with filtering
- `GET /api/presets` built-in script presets
- `GET /api/history` list generation history
- `DELETE /api/history/{id}` delete a history record and audio file
- `GET /api/stats` aggregate counters for dashboard
- `POST /api/speak` synthesize speech and store history

## Stack

- Python 3.11
- FastAPI + Uvicorn
- [edge-tts](https://pypi.org/project/edge-tts/)
- Plain HTML/CSS/JS frontend

## Quick Start

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements-dev.txt
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

Open: `http://127.0.0.1:8000`

## API Example

```bash
curl -X POST http://127.0.0.1:8000/api/speak \
  -H "Content-Type: application/json" \
  -d '{
    "text": "Hello from Voxa Studio",
    "voice": "en-US-AriaNeural",
    "rate": 0,
    "pitch": 0,
    "format": "mp3"
  }'
```

Response:

```json
{
  "id": "...",
  "voice": "en-US-AriaNeural",
  "locale": "en-US",
  "rate": 0,
  "pitch": 0,
  "format": "mp3",
  "audio_url": "/audio/<id>.mp3",
  "created_at": "2026-03-02T07:00:00Z",
  "characters": 29,
  "text_preview": "Hello from Voxa Studio"
}
```

## Run Tests

```bash
pytest -q
```

## Docker

```bash
docker build -t voxa-studio .
docker run --rm -p 8000:8000 voxa-studio
```

## Deploy

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/fzxlyd/voicebox-open-lite)

Or deploy with Render Blueprint:

```bash
render blueprint launch
```

## Project Layout

```text
.
├── app/
├── output/playwright/
├── render.yaml
├── web/
├── tests/
└── .github/workflows/ci.yml
```

## Safety Notes

- Do not use generated audio for impersonation, fraud, or deceptive use.
- Add user consent checks before deploying voice-clone features.
- If you add uploads or auth later, enforce rate limits and storage lifecycle controls.

## License

MIT
