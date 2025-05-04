import { app } from 'electron';
import path from 'path';
import fs from 'fs';
import { DEFAULT_PERSONALITY } from './ipcHandlers'; // Import default personality

// Define interfaces here
export interface AiSettings {
  personality: string;
  interviewStage: string;
  userPreferences: string;
  autoMode?: boolean; // Add autoMode setting
}

interface StoreSchema {
  aiSettings?: AiSettings;
  // Add other settings here like resumePath if needed
  // lastUploadedResumePath?: string;
}

// Define default values
const defaults: StoreSchema = {
  // Set initial defaults for the new fields
  aiSettings: { 
    personality: 'Default', 
    interviewStage: 'Initial Screening', 
    userPreferences: '',
    autoMode: false // Default to false for auto mode
  }
};

// --- Remove StoreWrapper --- 
/*
// Cache for frequently accessed settings
let aiSettingsCache: AiSettings | null = null;
let cacheTimestamp = 0;
const CACHE_TTL = 60000; // 1 minute cache lifetime

// Create a wrapper with optimized initialization
class StoreWrapper {
  private _storePromise: Promise<any> | null = null;
  private _initialized = false;
  
  constructor() {
    // Eagerly initialize the store when the module loads
    this.initStore().then(() => {
      this._initialized = true;
      console.log('Store initialized successfully via Wrapper'); // Added log
    }).catch(err => {
      console.error('Failed to initialize store via Wrapper:', err);
    });
  }
  
  async initStore() {
    if (!this._storePromise) {
      // Cache the promise to avoid multiple dynamic imports
      this._storePromise = import('electron-store').then(storeModule => {
        const Store = storeModule.default;
        // return new Store<StoreSchema>({ defaults }); // Use defaults if keeping schema
         return new Store(); // Simpler init without schema/defaults here
      });
    }
    return this._storePromise;
  }
  
  async get(key: string) {
    const store = await this.initStore();
    return store.get(key);
  }
  
  async set(key: string, value: any) {
    const store = await this.initStore();
    
    // If setting AI settings, invalidate the cache
    if (key === "aiSettings") {
      aiSettingsCache = null;
    }
    
    store.set(key, value);
  }
  
  async getMultiple(keys: string[]) {
    const store = await this.initStore();
    const result: Record<string, any> = {};
    
    for (const key of keys) {
      result[key] = store.get(key);
    }
    
    return result;
  }
  
  async isInitialized() {
    return this._initialized;
  }
}

const storeWrapper = new StoreWrapper();
*/
// --- End Remove StoreWrapper --- 

// --- Refined Store Initialization --- 
let store: any | null = null;
let storeReadyPromise: Promise<boolean> | null = null;

// Initialize store asynchronously
// This should be called explicitly from main.ts ONCE
export async function initializeStore(): Promise<boolean> {
  if (storeReadyPromise) {
    // If initialization is already in progress or done, return the existing promise
    console.log('Store initialization already requested, returning promise.');
    return storeReadyPromise;
  }
  console.log('Starting store initialization...');
  storeReadyPromise = (async () => {
    try {
      const { default: ElectronStore } = await import('electron-store');
      // Initialize with defaults if needed (can be added back)
      store = new ElectronStore({ defaults }); // Use defaults defined above
      console.log('Electron-store initialized successfully.');
      console.log('Store path:', store.path);
      // You might want to load initial cache here if needed
      return true;
    } catch (error: any) {
       console.error('Failed to initialize store:', error);
       store = null; // Ensure store is null on failure
       storeReadyPromise = null; // Allow retrying initialization
       return false;
    }
  })();

  return storeReadyPromise;
}

// Function to safely get the store instance
export function getStoreInstance(): any | null {
  // Returns the instance if initialized, otherwise null
  return store; 
}

// Utility function to wait for store initialization
// Checks if the module-level 'store' variable is set
export async function waitForStoreReady(timeout = 5000): Promise<boolean> {
  const start = Date.now();
  console.log('Waiting for store to be ready...');
  while (Date.now() - start < timeout) {
    // if (await storeWrapper.isInitialized()) { // OLD check
    if (getStoreInstance() !== null) { // NEW check: Directly check if store instance exists
      console.log('Store is ready.');
      return true;
    }
    await new Promise(resolve => setTimeout(resolve, 50)); // Small delay
  }
  console.error(`Store not ready after ${timeout}ms timeout.`);
  return false;
}
// --- End Refined Store Initialization --- 

// --- Settings Functions (using getStoreInstance) --- 

// Type-safe getter for AI settings (now uses getStoreInstance)
export async function getAiSettings(): Promise<AiSettings> {
  await waitForStoreReady();
  const currentStore = getStoreInstance();
  if (!currentStore) {
    console.error("Store not available for getAiSettings");
    return defaults.aiSettings!; // Return default if store failed
  }
  
  const settings = currentStore.get("aiSettings");
  const defaultSettings = defaults.aiSettings!;
  
  // Merge with defaults
  return {
    personality: settings?.personality ?? defaultSettings.personality,
    interviewStage: settings?.interviewStage ?? defaultSettings.interviewStage,
    userPreferences: settings?.userPreferences ?? defaultSettings.userPreferences,
    autoMode: settings?.autoMode ?? defaultSettings.autoMode,
  };
}

// Type-safe setter for AI settings (now uses getStoreInstance)
export async function saveAiSettings(settings: Partial<AiSettings>): Promise<void> {
  await waitForStoreReady();
  const currentStore = getStoreInstance();
  if (!currentStore) {
    throw new Error("Store not available for saveAiSettings");
  }
  // Merge with existing settings stored under 'aiSettings' key
  const currentSettings = (currentStore.get("aiSettings") || defaults.aiSettings) as AiSettings;
  const newSettings = { ...currentSettings, ...settings };
  currentStore.set("aiSettings", newSettings);
}

// Remove export { storeWrapper as store };

// --- Audio Device Settings --- 
export interface AudioDeviceSettings {
  speakerDeviceId: string | null;
  microphoneDeviceId: string | null;
}

export async function getAudioDeviceSettings(): Promise<AudioDeviceSettings> {
  await waitForStoreReady();
  const store = getStoreInstance(); // Correct way to get the instance
  // if (!store) { // Check is handled by waitForStoreReady and getStoreInstance returning null
  //   console.error("Store not ready for getAudioDeviceSettings");
  //   return { speakerDeviceId: null, microphoneDeviceId: null };
  // }
  return {
    // Use nullish coalescing or explicit checks if store might be null 
    // (though waitForStoreReady should prevent this if it resolves)
    speakerDeviceId: store?.get('audio.speakerDeviceId', null) as string | null ?? null,
    microphoneDeviceId: store?.get('audio.microphoneDeviceId', null) as string | null ?? null,
  };
}

export async function saveAudioDeviceSettings(settings: Partial<AudioDeviceSettings>): Promise<void> {
  await waitForStoreReady();
  const store = getStoreInstance(); // Correct way to get the instance
  if (!store) {
    // This case should ideally not happen if waitForStoreReady worked,
    // but defensively throw an error.
    throw new Error("Store not initialized for saving audio device settings");
  }
  if (settings.speakerDeviceId !== undefined) {
    store.set('audio.speakerDeviceId', settings.speakerDeviceId);
  }
  if (settings.microphoneDeviceId !== undefined) {
    store.set('audio.microphoneDeviceId', settings.microphoneDeviceId);
  }
}
// --- End Audio Device Settings --- 
