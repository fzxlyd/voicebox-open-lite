# Desktop Build Notes

This project can be packaged into desktop binaries for macOS and Windows.

## Local Build

Install desktop build dependencies:

```bash
pip install -r requirements-desktop.txt pyinstaller
```

Build package:

```bash
python desktop/build.py
```

Output archives are placed in:

- `dist/release/VoxaStudio-macOS-arm64.zip`
- `dist/release/VoxaStudio-windows-x64.zip`

(Archive name depends on the current OS.)
