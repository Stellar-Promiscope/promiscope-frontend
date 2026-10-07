# Application Icons — Implementation Guide

## Overview

This guide explains how the Promiscope application icons are structured and how to generate or replace them. The icon system includes:

- **SVG source** (`icon.svg`) — Scalable vector format for web and design tools
- **PNG variants** — Raster formats for browser favicons, app installs, and PWA
- **Manifest integration** — Web app manifest with proper icon declarations
- **Browser integration** — Multiple favicon sizes for different contexts

## Icon Assets

All icons are stored in `public/icons/`:

```
public/icons/
├── icon.svg                 # Source vector (branding: #0f172a bg, white mark)
├── icon-16x16.png          # Browser tab favicon
├── icon-32x32.png          # Larger browser favicon
├── icon-192x192.png        # App home screen (Android, desktop)
├── icon-512x512.png        # Splash screen (Android, installation)
└── icon-maskable-512x512.png # Android adaptive icon (safe zone)
```

## Design Specifications

- **Background Color**: `#0f172a` (Dark slate/navy)
- **Foreground Mark**: White (`#ffffff`)
- **Style**: Clean, modern, scalable
- **Scalable Vector Format**: SVG remains crisp at any size
- **Maskable Icon**: Includes Android safe-zone padding

## How to Generate PNG Icons

### Option 1: Using the Node.js Script (Recommended for development)

```bash
npm run generate:icons
```

This creates placeholder PNG files using pure Node.js. **Note**: These are minimal placeholders for development; they should be replaced with proper SVG conversions for production.

### Option 2: Using Inkscape (CLI)

```bash
# Generate all sizes
inkscape -w 16 -h 16 public/icons/icon.svg -o public/icons/icon-16x16.png
inkscape -w 32 -h 32 public/icons/icon.svg -o public/icons/icon-32x32.png
inkscape -w 192 -h 192 public/icons/icon.svg -o public/icons/icon-192x192.png
inkscape -w 512 -h 512 public/icons/icon.svg -o public/icons/icon-512x512.png
inkscape -w 512 -h 512 public/icons/icon.svg -o public/icons/icon-maskable-512x512.png
```

### Option 3: Using ImageMagick

```bash
# Generate all sizes with high density for crisp output
convert -density 300 -resize 16x16 public/icons/icon.svg public/icons/icon-16x16.png
convert -density 300 -resize 32x32 public/icons/icon.svg public/icons/icon-32x32.png
convert -density 300 -resize 192x192 public/icons/icon.svg public/icons/icon-192x192.png
convert -density 300 -resize 512x512 public/icons/icon.svg public/icons/icon-512x512.png
convert -density 300 -resize 512x512 public/icons/icon.svg public/icons/icon-maskable-512x512.png
```

### Option 4: Online Converter

1. Visit [Convertio](https://convertio.co/svg-png/) or similar service
2. Upload `public/icons/icon.svg`
3. Download PNG at each required size (16, 32, 192, 512)
4. Place files in `public/icons/`

### Option 5: Design Tool Export (Figma, Adobe XD, etc.)

1. Create or import the SVG design
2. Export at each size (16, 32, 192, 512)
3. Ensure output format is PNG with proper transparency
4. Place files in `public/icons/`

## SVG Source Format

The `icon.svg` includes:

- **Circle background**: White outer ring for contrast
- **Shield/badge shape**: Dark `#0f172a` interior
- **Scout binoculars**: White, centered symbol for the scouting theme
- **Football element**: Subtle sports reference with laces detail

All elements use the brand colors and scale smoothly across sizes.

## Integration Points

### Browser Integration (app/layout.tsx)

```tsx
<link rel="icon" type="image/png" sizes="32x32" href="/icons/icon-32x32.png" />
<link rel="icon" type="image/png" sizes="16x16" href="/icons/icon-16x16.png" />
<link rel="manifest" href="/manifest.json" />
<meta name="theme-color" content="#0f172a" />
<link rel="apple-touch-icon" href="/icons/icon-192x192.png" />
```

**What each does:**

- `rel="icon"` — Favicon for browser tabs and address bar
- `rel="manifest"` — Web App Manifest for PWA/app installation
- `theme-color` — Browser UI color matching app branding
- `apple-touch-icon` — Home screen icon on iOS devices

### Web App Manifest (public/manifest.json)

```json
{
  "icons": [
    {
      "src": "/icons/icon-192x192.png",
      "sizes": "192x192",
      "type": "image/png",
      "purpose": "any"
    },
    {
      "src": "/icons/icon-192x192.png",
      "sizes": "192x192",
      "type": "image/png",
      "purpose": "maskable"
    },
    {
      "src": "/icons/icon-512x512.png",
      "sizes": "512x512",
      "type": "image/png",
      "purpose": "any"
    },
    {
      "src": "/icons/icon-maskable-512x512.png",
      "sizes": "512x512",
      "type": "image/png",
      "purpose": "maskable"
    }
  ]
}
```

**Icon purposes:**

- `"any"` — Standard display in app menus and settings
- `"maskable"` — Android adaptive icons (safe zone: 80% of canvas)

## Verification

### Browser Favicon

1. Hard refresh the browser (`Cmd+Shift+R` on macOS, `Ctrl+Shift+F5` on Windows)
2. Check the browser tab for the favicon
3. Check the address bar for the favicon

### Web App Install (Chrome, Edge)

1. Open DevTools (`F12`)
2. Go to **Application** → **Manifest**
3. Verify all icons are listed and referenced correctly
4. Check **Lighthouse** report for PWA score

### iOS/macOS Home Screen

1. On Safari (iOS), tap **Share** → **Add to Home Screen**
2. Verify the home screen icon appears correctly
3. Tap to launch and verify the app icon displays

### Android Installation

1. Open Chrome and navigate to the app
2. Tap **Install** or **Add to Home Screen**
3. Verify both standard and adaptive icons display correctly
4. Check Settings → Apps for correct icon rendering

## Production Deployment

Before deploying to production:

1. **Replace placeholder PNGs** with proper SVG conversions
   - Use Inkscape, ImageMagick, or a design tool
   - Ensure crisp output at all sizes
   - Verify color accuracy (#0f172a and white)

2. **Validate all icon files exist**

   ```bash
   ls -lh public/icons/
   ```

3. **Test in browser** (hard refresh, check DevTools)

4. **Test app installation**
   - Chrome: Install PWA
   - Safari: Add to Home Screen
   - Verify icons appear on home screen/app drawer

5. **Run Lighthouse audit**

   ```bash
   npm run build
   npm run start
   # Then Lighthouse → PWA
   ```

6. **Commit and merge** PR with icon implementation

## Troubleshooting

### Favicon Not Appearing in Browser Tab

1. **Hard refresh** the page (`Cmd+Shift+R` or `Ctrl+Shift+F5`)
2. **Clear browser cache** (DevTools → Settings → Network conditions → Disable cache)
3. **Verify file exists** at `public/icons/icon-32x32.png`
4. **Check DevTools** → Console for 404 errors on icon requests
5. **Verify path** in `app/layout.tsx` matches file location

### Icons Missing from Manifest

1. Check `public/manifest.json` syntax (use JSON validator)
2. Verify all file paths are correct and files exist
3. Check browser console for manifest loading errors
4. Use **Lighthouse** → PWA audit to identify issues

### App Icon Not Displaying on Home Screen

1. **Clear app data** and reinstall
2. **Verify maskable icon** is properly formatted
3. **Check manifest purpose field** is exactly `"maskable"`
4. On Android: Clear Chrome cache and reinstall PWA

### SVG to PNG Conversion Issues

- **Imagemagick errors**: Install with `brew install imagemagick` (macOS)
- **Inkscape not found**: Install from [inkscape.org](https://inkscape.org/)
- **Image too large/small**: Adjust `-w` and `-h` flags or `-density` parameter
- **Colors inverted**: Ensure SVG uses correct color space (RGB, not CMYK)

## References

- [MDN: Web App Manifest Icons](https://developer.mozilla.org/en-US/docs/Web/Manifest/icons)
- [MDN: Favicon Guide](https://developer.mozilla.org/en-US/docs/Glossary/Favicon)
- [Web.dev: Icons and Browser Colors](https://web.dev/add-web-app-manifest/)
- [Android: Adaptive Icons](https://developer.android.com/guide/topics/ui/look-and-feel/icon_design_adaptive)
- [Convertio SVG to PNG](https://convertio.co/svg-png/)

## Questions or Issues?

If icons are not displaying correctly after following these steps, check:

1. File permissions (`chmod 644 public/icons/*.png`)
2. Build output (`npm run build` and verify `out/icons/` has files)
3. Deployment logs (ensure assets are served from `/icons/`)
4. Browser DevTools Network tab (verify successful 200 responses for icon files)
