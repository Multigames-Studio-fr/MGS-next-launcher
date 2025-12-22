# Helios Core Patch

## Problem
The `helios-core` library (version 2.2.4) has a bug in `JavaGuard.js` where it tries to read the `value` property of a potentially null registry response on Windows, causing:

```
Uncaught TypeError: Cannot read properties of null (reading 'value')
```

This occurs when the Windows registry returns a null value for a Java version key.

## Solution
This project applies an automatic patch via `postinstall` npm hook that:

1. Validates the registry response before accessing `res.value`
2. Gracefully skips null entries instead of crashing
3. Continues scanning for valid Java installations

## Files
- `scripts/patch-helios-core.js` - Patch application script
- `package.json` - Contains `postinstall` hook

## Additional Safeguards
In addition to the patch, the following files have try-catch protection:
- `app/assets/js/scripts/landing.js` - `asyncSystemScan()` and JVM validation
- `app/assets/js/scripts/settings.js` - `populateJavaExecDetails()`
- `app/assets/js/oldsettings.js` - `populateJavaExecDetails()`

This creates a multi-layer defense against registry reading errors.

## Automatic Patching
The patch is automatically applied when running:
```bash
npm install
```

If you need to manually apply the patch:
```bash
npm run postinstall
```
