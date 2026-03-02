.PHONY: install run test desktop-build

install:
	python3 -m pip install --upgrade pip
	pip install -r requirements-dev.txt

run:
	uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

test:
	pytest -q

desktop-build:
	pip install -r requirements-desktop.txt pyinstaller
	python desktop/build.py
