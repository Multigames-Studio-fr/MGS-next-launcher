#!/usr/bin/env node

/**
 * Post-install patch for helios-core JavaGuard.js
 * Fixes issue where res can be null when reading Windows registry
 */

const fs = require('fs');
const path = require('path');

const javaGuardPath = path.join(__dirname, '../node_modules/helios-core/dist/java/JavaGuard.js');

console.log('[Patch] Applying helios-core JavaGuard fix...');

try {
    if (!fs.existsSync(javaGuardPath)) {
        console.warn('[Patch] JavaGuard.js not found at', javaGuardPath);
        process.exit(0);
    }

    let content = fs.readFileSync(javaGuardPath, 'utf-8');
    
    // Check if already patched
    if (content.includes('if (!res || !res.value)')) {
        console.log('[Patch] Already patched, skipping');
        process.exit(0);
    }

    // Apply the patch
    const originalCode = `if (major > -1) {
                                            javaVer.get('JavaHome', (err, res) => {
                                                const jHome = res.value;`;

    const patchedCode = `if (major > -1) {
                                            javaVer.get('JavaHome', (err, res) => {
                                                // Handle null or missing res object
                                                if (!res || !res.value) {
                                                    numDone++;
                                                    if (numDone === javaVers.length) {
                                                        keysDone++;
                                                        if (keysDone === regKeys.length) {
                                                            resolve([...candidates]);
                                                        }
                                                    }
                                                    return;
                                                }
                                                const jHome = res.value;`;

    if (!content.includes(originalCode)) {
        // Try with slightly different whitespace
        const alt1 = content.includes('if (!res || !res.value)');
        if (alt1) {
            console.log('[Patch] Already patched (alternative check)');
            process.exit(0);
        }
        
        console.warn('[Patch] Could not find target code, manual intervention may be needed');
        process.exit(0);
    }

    content = content.replace(originalCode, patchedCode);
    fs.writeFileSync(javaGuardPath, content, 'utf-8');

    console.log('[Patch] Successfully patched helios-core JavaGuard.js');
    process.exit(0);

} catch (error) {
    console.error('[Patch] Error applying patch:', error.message);
    process.exit(0); // Non-fatal, don't break installation
}
