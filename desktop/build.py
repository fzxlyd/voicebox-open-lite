from __future__ import annotations

import shutil
import subprocess
import sys
from pathlib import Path

APP_NAME = "VoxaStudio"
ROOT = Path(__file__).resolve().parents[1]
DIST = ROOT / "dist"
BUILD = ROOT / "build"
RELEASE = DIST / "release"


def _pyinstaller_cmd() -> list[str]:
    sep = ";" if sys.platform.startswith("win") else ":"
    cmd = [
        sys.executable,
        "-m",
        "PyInstaller",
        "--noconfirm",
        "--clean",
        "--windowed",
        "--name",
        APP_NAME,
        "--add-data",
        f"web{sep}web",
        "desktop/launcher.py",
    ]

    if sys.platform.startswith("win"):
        cmd.insert(4, "--onefile")

    return cmd


def _zip_path(src: Path, archive: Path) -> Path:
    archive.parent.mkdir(parents=True, exist_ok=True)
    base = archive.with_suffix("")
    return Path(shutil.make_archive(str(base), "zip", root_dir=src.parent, base_dir=src.name))


def _package_release() -> Path:
    RELEASE.mkdir(parents=True, exist_ok=True)

    if sys.platform == "darwin":
        app_bundle = DIST / f"{APP_NAME}.app"
        if not app_bundle.exists():
            raise FileNotFoundError(f"Expected macOS app bundle at {app_bundle}")
        return _zip_path(app_bundle, RELEASE / "VoxaStudio-macOS.zip")

    if sys.platform.startswith("win"):
        onefile_exe = DIST / f"{APP_NAME}.exe"
        if onefile_exe.exists():
            return _zip_path(onefile_exe, RELEASE / "VoxaStudio-windows.zip")

        folder_app = DIST / APP_NAME
        if not folder_app.exists():
            raise FileNotFoundError("Expected Windows executable or app folder in dist/")
        return _zip_path(folder_app, RELEASE / "VoxaStudio-windows.zip")

    raise RuntimeError("Desktop packaging script currently supports macOS and Windows only")


def main() -> None:
    for path in (BUILD, DIST):
        if path.exists():
            shutil.rmtree(path)

    subprocess.run(_pyinstaller_cmd(), cwd=ROOT, check=True)
    package = _package_release()
    print(f"Desktop package created: {package}")


if __name__ == "__main__":
    main()
