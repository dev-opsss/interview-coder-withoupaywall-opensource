/**
 * Test script to verify logging IPC handlers work correctly
 * Run this in the Electron renderer console to test logging settings
 */

async function testLoggingIPC() {
  console.log('🧪 Testing Logging IPC Handlers...');
  
  try {
    // Test 1: Get current logging config
    console.log('\n📖 Test 1: Getting current logging config...');
    const currentConfig = await window.electronAPI?.invoke('get-logging-config');
    console.log('Current config:', currentConfig);
    
    if (!currentConfig) {
      console.error('❌ Failed to get logging config');
      return false;
    }
    
    // Test 2: Save a modified config
    console.log('\n💾 Test 2: Saving modified logging config...');
    const testConfig = {
      ...currentConfig,
      globalLevel: 'TRACE', // Change to TRACE
      categoryLevels: {
        ...currentConfig.categoryLevels,
        speech: 'DEBUG',
        ui: 'INFO'
      },
      enabledCategories: ['speech', 'ui', 'system'], // Enable only these
      fileLogging: { enabled: true, directory: currentConfig.fileLogging?.directory || '' },
      consoleLogging: { enabled: true }
    };
    
    const saveResult = await window.electronAPI?.invoke('set-logging-config', testConfig);
    console.log('Save result:', saveResult);
    
    // Test 3: Verify the config was saved
    console.log('\n✅ Test 3: Verifying config was saved...');
    const updatedConfig = await window.electronAPI?.invoke('get-logging-config');
    console.log('Updated config:', updatedConfig);
    
    // Compare key values
    const success = updatedConfig.globalLevel === 'TRACE' && 
                   updatedConfig.categoryLevels?.speech === 'DEBUG' &&
                   updatedConfig.enabledCategories?.includes('speech');
    
    if (success) {
      console.log('✅ All tests passed! Logging IPC handlers work correctly.');
      
      // Test actual logging
      console.log('\n🔍 Test 4: Testing actual logging output...');
      console.log('Check the console for categorized log output:');
      
      return true;
    } else {
      console.error('❌ Config verification failed');
      return false;
    }
    
  } catch (error) {
    console.error('❌ Test failed with error:', error);
    return false;
  }
}

// Instructions for manual testing
console.log(`
🧪 LOGGING INTEGRATION TEST SCRIPT

To test the logging settings integration:

1. Open the application
2. Open Developer Tools (F12)
3. Go to Console tab
4. Run: testLoggingIPC()
5. Check the results

Expected behavior:
- ✅ get-logging-config returns current configuration
- ✅ set-logging-config saves changes successfully  
- ✅ Settings persist between get calls
- ✅ No errors in console

Manual UI Test:
1. Open Settings → Logging Settings
2. Change Global Level from DEBUG to INFO
3. Disable some categories (uncheck boxes)
4. Click "Save Settings"
5. Close and reopen Settings
6. Verify changes persisted
`);

// Export for console use
if (typeof window !== 'undefined') {
  window.testLoggingIPC = testLoggingIPC;
}
