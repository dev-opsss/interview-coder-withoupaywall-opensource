import Store from "electron-store"

// Define the shape of your settings
interface AiSettings {
  personality: string;
  interviewStage: string;
  userPreferences: string;
}

// Update the store schema to include AI settings
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
    userPreferences: ''
  }
};

// Explicitly type the store variable
const store: Store<StoreSchema> = new Store<StoreSchema>({
  defaults,
  // Consider making encryptionKey more robust or loading from env
  // encryptionKey: "your-encryption-key" 
  // If not using encryption, remove the key.
  // For development, simple key is okay, but change for production.
});

// Type-safe getter for AI settings
export function getAiSettings(): AiSettings {
  // Always return settings, falling back to defaults
  const settings = (store as any).get("aiSettings");
  return {
    personality: settings?.personality || defaults.aiSettings!.personality,
    interviewStage: settings?.interviewStage || defaults.aiSettings!.interviewStage,
    userPreferences: settings?.userPreferences || defaults.aiSettings!.userPreferences,
  };
}

// Type-safe setter for AI settings
export function saveAiSettings(settings: Partial<AiSettings>): void {
  // Merge with existing settings to allow partial updates
  const currentSettings = getAiSettings(); 
  const newSettings = { ...currentSettings, ...settings };
  (store as any).set("aiSettings", newSettings);
}

// Export the raw store instance if needed elsewhere (use with caution)
export { store };
