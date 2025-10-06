const ProcessBuilder = require('./app/assets/js/processbuilder.js');
const path = require('path');

// Mock some required objects for testing
const mockDistroServer = {
    rawServer: {
        id: 'test-server',
        minecraftVersion: '1.19.2'
    },
    modules: []
};

const mockVanillaManifest = {
    id: '1.19.2',
    libraries: []
};

// Create a ProcessBuilder instance for testing
const processBuilder = new ProcessBuilder(mockDistroServer, mockVanillaManifest, null, null, '1.0.0');

// Test the deduplication with ASM library paths similar to the error
const testLibraryPaths = [
    'C:/Users/wiltark/AppData/Roaming/.loftylauncher/common/libraries/org/ow2/asm/asm/9.8/asm-9.8.jar',
    'C:/Users/wiltark/AppData/Roaming/.loftylauncher/common/libraries/org/ow2/asm/asm/9.6/asm-9.6.jar',
    'C:/Users/wiltark/AppData/Roaming/.loftylauncher/common/libraries/org/ow2/asm/asm-commons/9.6/asm-commons-9.6.jar',
    'C:/Users/wiltark/AppData/Roaming/.loftylauncher/common/libraries/org/ow2/asm/asm-commons/9.8/asm-commons-9.8.jar',
    'C:/Users/wiltark/AppData/Roaming/.loftylauncher/common/libraries/com/google/guava/guava/32.1.1-jre/guava-32.1.1-jre.jar'
];

console.log('Testing library deduplication...');
console.log('Input libraries:');
testLibraryPaths.forEach(lib => console.log(`  ${lib}`));

try {
    const deduplicated = processBuilder._deduplicateLibraries(testLibraryPaths);
    
    console.log('\nDeduplicated libraries:');
    deduplicated.forEach(lib => console.log(`  ${lib}`));
    
    console.log('\nTest Results:');
    console.log(`Original count: ${testLibraryPaths.length}`);
    console.log(`Deduplicated count: ${deduplicated.length}`);
    
    // Check if ASM 9.8 is kept over 9.6
    const hasAsm98 = deduplicated.some(lib => lib.includes('asm-9.8.jar'));
    const hasAsm96 = deduplicated.some(lib => lib.includes('asm-9.6.jar'));
    const hasAsmCommons98 = deduplicated.some(lib => lib.includes('asm-commons-9.8.jar'));
    const hasAsmCommons96 = deduplicated.some(lib => lib.includes('asm-commons-9.6.jar'));
    
    console.log(`ASM 9.8 present: ${hasAsm98}`);
    console.log(`ASM 9.6 present: ${hasAsm96}`);
    console.log(`ASM Commons 9.8 present: ${hasAsmCommons98}`);
    console.log(`ASM Commons 9.6 present: ${hasAsmCommons96}`);
    
    if (hasAsm98 && !hasAsm96 && hasAsmCommons98 && !hasAsmCommons96) {
        console.log('\n✅ SUCCESS: Deduplication working correctly - newer versions kept');
    } else {
        console.log('\n❌ FAILURE: Deduplication not working as expected');
    }
    
} catch (error) {
    console.error('Error during testing:', error);
}