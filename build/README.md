# Build Assets

Place your app icons here before running `npm run dist:*`.

## Required files

### Windows
- `icon.ico` — 256×256 minimum. Multi-resolution ICO preferred.

### macOS
- `icon.icns` — Must contain 512×512 and 1024×1024 (Retina) sizes.

### Linux
Create an `icons/` subdirectory with PNG files named by size:
- `icons/16x16.png`
- `icons/32x32.png`
- `icons/48x48.png`
- `icons/64x64.png`
- `icons/128x128.png`
- `icons/256x256.png`
- `icons/512x512.png`

## Generating icons from a single PNG

If you have a 1024×1024 source PNG, you can generate all required formats:

```
# Install electron-icon-builder
npm install --save-dev electron-icon-builder

# Generate from source PNG
npx electron-icon-builder --input=build/icon-source.png --output=build
```

This produces `icon.ico`, `icon.icns`, and the `icons/` PNG set automatically.
