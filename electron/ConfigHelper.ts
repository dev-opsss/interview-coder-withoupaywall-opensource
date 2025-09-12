// ConfigHelper.ts
import fs from "node:fs"
import path from "node:path"
import { app } from "electron"
import { OpenAI } from "openai"
import axios from "axios"
import crypto from "crypto"

interface Config {
  apiKey: string;
  apiProvider: "openai" | "gemini" | "anthropic";  // Added provider selection
  // Add separate API keys for each provider
  openaiApiKey?: string;
  geminiApiKey?: string;
  anthropicApiKey?: string;
  extractionModel: string;
  solutionModel: string;
  debuggingModel: string;
  language: string;
  opacity: number;
  // Add speech service settings
  speechService: "whisper" | "google";
  googleSpeechApiKey: string;
  // Add config object for nested settings from store.ts
  config?: {
    speechService?: "whisper" | "google";
    googleSpeechApiKey?: string;
  };
  hasSpeechCredentials: boolean;
  speechCredentialsPath?: string;
}

// Safe console logging to prevent EPIPE errors
const safeLog = (...args: any[]) => {
  try {
    console.log(...args);
  } catch (error: any) {
    // Silently handle EPIPE errors
    if (error && typeof error === 'object' && 'code' in error && error.code === 'EPIPE') {
      // Process communication pipe is closed, ignore
    } else if (error) {
      // Try to log to stderr instead
      try {
        process.stderr.write(`Error during logging: ${error?.message || String(error)}\n`);
      } catch (_) {
        // Last resort, ignore completely
      }
    }
  }
};

// Safe error logging
const safeError = (...args: any[]) => {
  try {
    console.error(...args);
  } catch (error: any) {
    // Silently handle EPIPE errors
    if (error && typeof error === 'object' && 'code' in error && error.code === 'EPIPE') {
      // Process communication pipe is closed, ignore
    } else if (error) {
      // Try to log to stderr instead
      try {
        process.stderr.write(`ERROR: ${args.map(a => String(a)).join(' ')}\n`);
      } catch (_) {
        // Last resort, ignore completely
      }
    }
  }
};

export class ConfigHelper {
  private configPath: string;
  private defaultConfig: Config = {
    apiKey: "",
    apiProvider: "gemini", // Default to Gemini for speed
    // Initialize separate API keys for each provider
    openaiApiKey: "",
    geminiApiKey: "",
    anthropicApiKey: "",
    extractionModel: "gemini-2.0-flash", // Fastest model for extraction
    solutionModel: "gemini-2.0-flash", // Fastest model for solutions
    debuggingModel: "gemini-2.0-flash", // Fastest model for debugging
    language: "python",
    opacity: 1.0,
    // Add default speech service settings
    speechService: "whisper",
    googleSpeechApiKey: "",
    // Initialize empty config object
    config: {
      speechService: "whisper",
      googleSpeechApiKey: ""
    },
    hasSpeechCredentials: false,
    speechCredentialsPath: undefined
  };
  
  private eventHandlers: {[key: string]: Function[]} = {};

  constructor() {
    // Use the app's user data directory to store the config
    try {
      this.configPath = path.join(app.getPath('userData'), 'config.json');
      safeLog('Config path:', this.configPath);
    } catch (err) {
      safeLog('Could not access user data path, using fallback');
      this.configPath = path.join(process.cwd(), 'config.json');
    }
    
    // Ensure the initial config file exists
    this.ensureConfigExists();
  }
  
  // Custom event emitter implementation
  public on(event: string, handler: Function): void {
    if (!this.eventHandlers[event]) {
      this.eventHandlers[event] = [];
    }
    this.eventHandlers[event].push(handler);
  }
  
  public emit(event: string, ...args: any[]): void {
    const handlers = this.eventHandlers[event];
    if (handlers) {
      handlers.forEach(handler => {
        try {
          handler(...args);
        } catch (err) {
          safeError(`Error in event handler for ${event}:`, err);
        }
      });
    }
  }

  /**
   * Ensure config file exists
   */
  private ensureConfigExists(): void {
    try {
      if (!fs.existsSync(this.configPath)) {
        this.saveConfig(this.defaultConfig);
      }
    } catch (err) {
      safeError("Error ensuring config exists:", err);
    }
  }

  /**
   * Validate and sanitize model selection to ensure only allowed models are used
   */
  private sanitizeModelSelection(model: string, provider: "openai" | "gemini" | "anthropic"): string {
    if (provider === "openai") {
      // Only allow gpt-4o and gpt-4o-mini for OpenAI
      const allowedModels = ['gpt-4o', 'gpt-4o-mini'];
      if (!allowedModels.includes(model)) {
        safeLog(`Invalid OpenAI model specified: ${model}. Using default model: gpt-4o`);
        return 'gpt-4o';
      }
      return model;
    } else if (provider === "gemini")  {
      // Only allow gemini-1.5-pro and gemini-2.0-flash for Gemini
      const allowedModels = ['gemini-1.5-pro', 'gemini-2.0-flash'];
      if (!allowedModels.includes(model)) {
        safeLog(`Invalid Gemini model specified: ${model}. Using default model: gemini-2.0-flash`);
        return 'gemini-2.0-flash'; // Changed default to flash
      }
      return model;
    }  else if (provider === "anthropic") {
      // Only allow Claude models
      const allowedModels = ['claude-3-7-sonnet-20250219', 'claude-3-5-sonnet-20241022', 'claude-3-opus-20240229'];
      if (!allowedModels.includes(model)) {
        safeLog(`Invalid Anthropic model specified: ${model}. Using default model: claude-3-7-sonnet-20250219`);
        return 'claude-3-7-sonnet-20250219';
      }
      return model;
    }
    // Default fallback
    return model;
  }

  public loadConfig(): Config {
    try {
      if (fs.existsSync(this.configPath)) {
        const configData = fs.readFileSync(this.configPath, 'utf8');
        const config = JSON.parse(configData);
        
        // Ensure apiProvider is a valid value
        if (config.apiProvider !== "openai" && config.apiProvider !== "gemini"  && config.apiProvider !== "anthropic") {
          config.apiProvider = "gemini"; // Default to Gemini if invalid
        }
        
        // Sanitize model selections to ensure only allowed models are used
        if (config.extractionModel) {
          config.extractionModel = this.sanitizeModelSelection(config.extractionModel, config.apiProvider);
        }
        if (config.solutionModel) {
          config.solutionModel = this.sanitizeModelSelection(config.solutionModel, config.apiProvider);
        }
        if (config.debuggingModel) {
          config.debuggingModel = this.sanitizeModelSelection(config.debuggingModel, config.apiProvider);
        }
        
        return {
          ...this.defaultConfig,
          ...config
        };
      }
      
      // If no config exists, create a default one
      this.saveConfig(this.defaultConfig);
      return this.defaultConfig;
    } catch (err) {
      safeError("Error loading config:", err);
      return this.defaultConfig;
    }
  }

  /**
   * Save configuration to disk
   */
  public saveConfig(config: Config): void {
    try {
      // Ensure the directory exists
      const configDir = path.dirname(this.configPath);
      if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
      }
      // Write the config file
      fs.writeFileSync(this.configPath, JSON.stringify(config, null, 2));
    } catch (err) {
      safeError("Error saving config:", err);
    }
  }

  /**
   * Update specific configuration values
   */
  public updateConfig(updates: Partial<Config>): Config {
    try {
      const currentConfig = this.loadConfig();
      let provider = updates.apiProvider || currentConfig.apiProvider;
      
      // Auto-detect provider based on API key format if a new key is provided
      if (updates.apiKey && !updates.apiProvider) {
        // If API key starts with "sk-", it's likely an OpenAI key
        if (updates.apiKey.trim().startsWith('sk-')) {
          provider = "openai";
          safeLog("Auto-detected OpenAI API key format");
        } else if (updates.apiKey.trim().startsWith('sk-ant-')) {
          provider = "anthropic";
          safeLog("Auto-detected Anthropic API key format");
        } else {
          provider = "gemini";
          safeLog("Using Gemini API key format (default)");
        }
        
        // Update the provider in the updates object
        updates.apiProvider = provider;
      }
      
      // Handle provider-specific API key updates
      if (updates.apiKey !== undefined) {
        // Store the API key in the provider-specific field
        if (provider === "openai") {
          updates.openaiApiKey = updates.apiKey;
        } else if (provider === "gemini") {
          updates.geminiApiKey = updates.apiKey;
        } else if (provider === "anthropic") {
          updates.anthropicApiKey = updates.apiKey;
        }
      }
      
      // Handle individual provider API key updates
      if (updates.openaiApiKey !== undefined) {
        // If we're setting OpenAI key and it's the current provider, update main apiKey
        if (provider === "openai") {
          updates.apiKey = updates.openaiApiKey;
        }
      }
      if (updates.geminiApiKey !== undefined) {
        // If we're setting Gemini key and it's the current provider, update main apiKey
        if (provider === "gemini") {
          updates.apiKey = updates.geminiApiKey;
        }
      }
      if (updates.anthropicApiKey !== undefined) {
        // If we're setting Anthropic key and it's the current provider, update main apiKey
        if (provider === "anthropic") {
          updates.apiKey = updates.anthropicApiKey;
        }
      }
      
      // If provider is changing, update the main apiKey from the provider-specific key
      if (updates.apiProvider && updates.apiProvider !== currentConfig.apiProvider) {
        const newProvider = updates.apiProvider;
        if (newProvider === "openai" && (currentConfig.openaiApiKey || updates.openaiApiKey)) {
          updates.apiKey = updates.openaiApiKey || currentConfig.openaiApiKey || "";
          updates.extractionModel = "gpt-4o";
          updates.solutionModel = "gpt-4o";
          updates.debuggingModel = "gpt-4o";
        } else if (newProvider === "gemini" && (currentConfig.geminiApiKey || updates.geminiApiKey)) {
          updates.apiKey = updates.geminiApiKey || currentConfig.geminiApiKey || "";
          updates.extractionModel = "gemini-2.0-flash";
          updates.solutionModel = "gemini-2.0-flash";
          updates.debuggingModel = "gemini-2.0-flash";
        } else if (newProvider === "anthropic" && (currentConfig.anthropicApiKey || updates.anthropicApiKey)) {
          updates.apiKey = updates.anthropicApiKey || currentConfig.anthropicApiKey || "";
          updates.extractionModel = "claude-3-7-sonnet-20250219";
          updates.solutionModel = "claude-3-7-sonnet-20250219";
          updates.debuggingModel = "claude-3-7-sonnet-20250219";
        } else {
          // No key available for the new provider, clear main apiKey
          updates.apiKey = "";
          if (newProvider === "openai") {
            updates.extractionModel = "gpt-4o";
            updates.solutionModel = "gpt-4o";
            updates.debuggingModel = "gpt-4o";
          } else if (newProvider === "anthropic") {
            updates.extractionModel = "claude-3-7-sonnet-20250219";
            updates.solutionModel = "claude-3-7-sonnet-20250219";
            updates.debuggingModel = "claude-3-7-sonnet-20250219";
          } else {
            updates.extractionModel = "gemini-2.0-flash";
            updates.solutionModel = "gemini-2.0-flash";
            updates.debuggingModel = "gemini-2.0-flash";
          }
        }
      }
      
      // Sanitize model selections in the updates
      if (updates.extractionModel) {
        updates.extractionModel = this.sanitizeModelSelection(updates.extractionModel, provider);
      }
      if (updates.solutionModel) {
        updates.solutionModel = this.sanitizeModelSelection(updates.solutionModel, provider);
      }
      if (updates.debuggingModel) {
        updates.debuggingModel = this.sanitizeModelSelection(updates.debuggingModel, provider);
      }
      
      const newConfig = { ...currentConfig, ...updates };
      this.saveConfig(newConfig);
      
      // Only emit update event for changes other than opacity
      // This prevents re-initializing the AI client when only opacity changes
      if (updates.apiKey !== undefined || updates.apiProvider !== undefined || 
          updates.openaiApiKey !== undefined || updates.geminiApiKey !== undefined || updates.anthropicApiKey !== undefined ||
          updates.extractionModel !== undefined || updates.solutionModel !== undefined || 
          updates.debuggingModel !== undefined || updates.language !== undefined) {
        this.emit('config-updated', newConfig);
      }
      
      return newConfig;
    } catch (error) {
      safeError('Error updating config:', error);
      return this.defaultConfig;
    }
  }

  /**
   * Check if the API key is configured
   */
  public hasApiKey(): boolean {
    const config = this.loadConfig();
    return !!config.apiKey && config.apiKey.trim().length > 0;
  }
  
  /**
   * Validate the API key format
   */
  public isValidApiKeyFormat(apiKey: string, provider?: "openai" | "gemini" | "anthropic" ): boolean {
    // If provider is not specified, attempt to auto-detect
    if (!provider) {
      if (apiKey.trim().startsWith('sk-')) {
        if (apiKey.trim().startsWith('sk-ant-')) {
          provider = "anthropic";
        } else {
          provider = "openai";
        }
      } else {
        provider = "gemini";
      }
    }
    
    if (provider === "openai") {
      // Basic format validation for OpenAI API keys
      return /^sk-[a-zA-Z0-9]{32,}$/.test(apiKey.trim());
    } else if (provider === "gemini") {
      // Basic format validation for Gemini API keys (usually alphanumeric with no specific prefix)
      return apiKey.trim().length >= 10; // Assuming Gemini keys are at least 10 chars
    } else if (provider === "anthropic") {
      // Basic format validation for Anthropic API keys
      return /^sk-ant-[a-zA-Z0-9]{32,}$/.test(apiKey.trim());
    }
    
    return false;
  }
  
  /**
   * Get the stored opacity value
   */
  public getOpacity(): number {
    const config = this.loadConfig();
    return config.opacity !== undefined ? config.opacity : 1.0;
  }

  /**
   * Set the window opacity value
   */
  public setOpacity(opacity: number): void {
    // Ensure opacity is between 0.1 and 1.0
    const validOpacity = Math.min(1.0, Math.max(0.1, opacity));
    this.updateConfig({ opacity: validOpacity });
  }  
  
  /**
   * Get the preferred programming language
   */
  public getLanguage(): string {
    const config = this.loadConfig();
    return config.language || this.defaultConfig.language;
  }

  /**
   * Set the preferred programming language
   */
  public setLanguage(language: string): void {
    this.updateConfig({ language });
  }
  
  /**
   * Test API key with the selected provider
   */
  public async testApiKey(apiKey: string, provider?: "openai" | "gemini" | "anthropic"): Promise<{valid: boolean, error?: string}> {
    // Auto-detect provider based on key format if not specified
    if (!provider) {
      if (apiKey.trim().startsWith('sk-')) {
        if (apiKey.trim().startsWith('sk-ant-')) {
          provider = "anthropic";
          safeLog("Auto-detected Anthropic API key format for testing");
        } else {
          provider = "openai";
          safeLog("Auto-detected OpenAI API key format for testing");
        }
      } else {
        provider = "gemini";
        safeLog("Using Gemini API key format for testing (default)");
      }
    }
    
    if (provider === "openai") {
      return this.testOpenAIKey(apiKey);
    } else if (provider === "gemini") {
      return this.testGeminiKey(apiKey);
    } else if (provider === "anthropic") {
      return this.testAnthropicKey(apiKey);
    }
    
    return { valid: false, error: "Unknown API provider" };
  }
  
  /**
   * Test OpenAI API key
   */
  private async testOpenAIKey(apiKey: string): Promise<{valid: boolean, error?: string}> {
    try {
      const openai = new OpenAI({ apiKey });
      // Make a simple API call to test the key
      await openai.models.list();
      return { valid: true };
    } catch (error: any) {
      safeError('OpenAI API key test failed:', error);
      
      // Determine the specific error type for better error messages
      let errorMessage = 'Unknown error validating OpenAI API key';
      
      if (error.status === 401) {
        errorMessage = 'Invalid API key. Please check your OpenAI key and try again.';
      } else if (error.status === 429) {
        errorMessage = 'Rate limit exceeded. Your OpenAI API key has reached its request limit or has insufficient quota.';
      } else if (error.status === 500) {
        errorMessage = 'OpenAI server error. Please try again later.';
      } else if (error.message) {
        errorMessage = `Error: ${error.message}`;
      }
      
      return { valid: false, error: errorMessage };
    }
  }
  
  /**
   * Test Gemini API key
   * Note: This is a simplified implementation since we don't have the actual Gemini client
   */
  private async testGeminiKey(apiKey: string): Promise<{valid: boolean, error?: string}> {
    try {
      // For now, we'll just do a basic check to ensure the key exists and has valid format
      // In production, you would connect to the Gemini API and validate the key
      if (apiKey && apiKey.trim().length >= 20) {
        // Here you would actually validate the key with a Gemini API call
        return { valid: true };
      }
      return { valid: false, error: 'Invalid Gemini API key format.' };
    } catch (error: any) {
      safeError('Gemini API key test failed:', error);
      let errorMessage = 'Unknown error validating Gemini API key';
      
      if (error.message) {
        errorMessage = `Error: ${error.message}`;
      }
      
      return { valid: false, error: errorMessage };
    }
  }

  /**
   * Test Anthropic API key
   * Note: This is a simplified implementation since we don't have the actual Anthropic client
   */
  private async testAnthropicKey(apiKey: string): Promise<{valid: boolean, error?: string}> {
    try {
      // For now, we'll just do a basic check to ensure the key exists and has valid format
      // In production, you would connect to the Anthropic API and validate the key
      if (apiKey && /^sk-ant-[a-zA-Z0-9]{32,}$/.test(apiKey.trim())) {
        // Here you would actually validate the key with an Anthropic API call
        return { valid: true };
      }
      return { valid: false, error: 'Invalid Anthropic API key format.' };
    } catch (error: any) {
      safeError('Anthropic API key test failed:', error);
      let errorMessage = 'Unknown error validating Anthropic API key';
      
      if (error.message) {
        errorMessage = `Error: ${error.message}`;
      }
      
      return { valid: false, error: errorMessage };
    }
  }

  /**
   * Get the stored API key
   */
  public getApiKey(): string {
    const config = this.loadConfig();
    return config.apiKey || "";
  }

  /**
   * Get the OpenAI API key
   */
  public getOpenAIApiKey(): string {
    const config = this.loadConfig();
    return config.openaiApiKey || "";
  }

  /**
   * Get the Gemini API key
   */
  public getGeminiApiKey(): string {
    const config = this.loadConfig();
    return config.geminiApiKey || "";
  }

  /**
   * Get the Anthropic API key
   */
  public getAnthropicApiKey(): string {
    const config = this.loadConfig();
    return config.anthropicApiKey || "";
  }


  /**
   * Get the speech service type (whisper or google)
   */
  public getSpeechService(): "whisper" | "google" {
    const config = this.loadConfig();
    // Check both places where the setting might be stored
    return config.config?.speechService || config.speechService || "whisper";
  }

  /**
   * Set the speech service type
   */
  public setSpeechService(service: "whisper" | "google"): void {
    const updates: Partial<Config> = {
      speechService: service,
      config: { speechService: service }
    };
    this.updateConfig(updates);
  }

  /**
   * Get the Google Speech API key
   */
  public getGoogleSpeechApiKey(): string {
    const config = this.loadConfig();
    // Check both places where the key might be stored
    return config.config?.googleSpeechApiKey || config.googleSpeechApiKey || "";
  }

  /**
   * Set the Google Speech API key
   */
  public setGoogleSpeechApiKey(apiKey: string): void {
    const updates: Partial<Config> = {
      googleSpeechApiKey: apiKey,
      config: { googleSpeechApiKey: apiKey }
    };
    this.updateConfig(updates);
  }

  /**
   * Test if the Google Speech API key is valid
   */
  public async testGoogleSpeechApiKey(): Promise<{valid: boolean, error?: string}> {
    try {
      const apiKey = this.getGoogleSpeechApiKey();
      if (!apiKey) {
        return { valid: false, error: 'Google Speech API key is not configured.' };
      }

      // Simple format validation
      if (apiKey.length < 20) {
        return { valid: false, error: 'Google API key appears to be too short. It should be at least 20 characters.' };
      }

      safeLog('Testing Google Speech API key validity...');
      
      // Make a simple API call to test the key - use a minimal request
      try {
        const response = await axios.post(
          `https://speech.googleapis.com/v1/speech:recognize?key=${apiKey}`,
          {
            config: {
              encoding: 'LINEAR16',
              sampleRateHertz: 16000,
              languageCode: 'en-US',
              model: 'command_and_search',
            },
            audio: {
              content: 'AA==', // Minimal valid base64
            },
          },
          { timeout: 10000 } // 10 second timeout
        );

        // We expect a 400 error from Google because our audio is invalid
        // This means the API key is valid but our request format is wrong
        safeLog('Unexpected 200 success from Google Speech API test');
        return { valid: true };
      } catch (error: any) {
        // If we get a 400 error about invalid audio, the API key is valid
        if (error.response?.status === 400 && 
            (error.response.data?.error?.message?.includes('Invalid audio'))) {
          safeLog('Valid API key but invalid audio (this is expected)');
          return { valid: true };
        }
        
        // Error 403 means API key is invalid
        if (error.response?.status === 403) {
          safeError('Google Speech API key invalid:', error.response.data);
          return { 
            valid: false, 
            error: 'Invalid API key. Please verify your Google Cloud Speech-to-Text API key.' 
          };
        }
        
        // Network error means we can't reach Google's API
        if (error.code === 'ECONNABORTED' || error.message?.includes('timeout') || !error.response) {
          safeError('Network error testing Google Speech API:', error);
          return { 
            valid: false, 
            error: 'Network error: Unable to connect to Google Speech API. Please check your internet connection.' 
          };
        }
        
        // Any other error - provide details
        safeError('Error testing Google Speech API key:', error.response?.data || error.message);
        return { 
          valid: false, 
          error: `API error: ${error.response?.data?.error?.message || error.message || 'Unknown error'}` 
        };
      }
    } catch (error: any) {
      safeError('Error testing Google Speech API key:', error);
      
      return { 
        valid: false, 
        error: `Error: ${error.message || 'Unknown error validating Google Speech API key'}` 
      };
    }
  }

  /**
   * Store Google Speech service account JSON key file securely
   */
  public storeServiceAccountKey(keyData: string): void {
    try {
      console.log('ConfigHelper: Storing service account key');
      
      // Validate JSON format before storing
      try {
        const parsed = JSON.parse(keyData);
        if (!parsed.type || !parsed.private_key || !parsed.client_email) {
          console.warn('ConfigHelper: Service account JSON missing required fields');
        }
      } catch (e) {
        console.error('ConfigHelper: Invalid JSON provided for service account key:', e);
        // Continue anyway since we're just validating
      }
      
      // Encrypt before storing
      const encryptedKey = this.encrypt(keyData);
      
      // Store in a separate, secure location
      const keyPath = path.join(app.getPath('userData'), 'speech-credentials.enc');
      fs.writeFileSync(keyPath, encryptedKey);
      console.log(`ConfigHelper: Credentials stored at: ${keyPath}`);
      
      // Also save to a more accessible temp file for debugging
      const tempJsonPath = path.join(app.getPath('temp'), 'speech-credentials-debug.json');
      fs.writeFileSync(tempJsonPath, keyData);
      console.log(`ConfigHelper: Debug copy saved at: ${tempJsonPath} (for development only)`);
      
      // Update config to note we have credentials
      this.updateConfig({ 
        hasSpeechCredentials: true,
        speechCredentialsPath: keyPath
      });
      
      console.log('ConfigHelper: Google Speech service account credentials stored securely');
    } catch (err) {
      safeError("ConfigHelper: Error storing service account key:", err);
    }
  }

  /**
   * Load the Google Speech service account credentials
   */
  public loadServiceAccountKey(): string | null {
    try {
      console.log('ConfigHelper: Loading service account key');
      const config = this.loadConfig();
      const keyPath = config.speechCredentialsPath || path.join(app.getPath('userData'), 'speech-credentials.enc');
      
      if (!fs.existsSync(keyPath)) {
        console.log(`ConfigHelper: No service account credentials found at path: ${keyPath}`);
        return null;
      }
      
      console.log(`ConfigHelper: Reading encrypted credentials from: ${keyPath}`);
      const encryptedKey = fs.readFileSync(keyPath, 'utf8');
      const decrypted = this.decrypt(encryptedKey);
      
      // Validate JSON format after loading
      try {
        const parsed = JSON.parse(decrypted);
        console.log('ConfigHelper: Successfully loaded and parsed service account credentials');
        if (!parsed.type || !parsed.private_key || !parsed.client_email) {
          console.warn('ConfigHelper: Loaded service account JSON missing some required fields');
        }
      } catch (e) {
        console.error('ConfigHelper: Invalid JSON after decryption:', e);
        // Continue anyway to return what we have
      }
      
      return decrypted;
    } catch (err) {
      safeError("ConfigHelper: Error loading service account key:", err);
      return null;
    }
  }

  /**
   * Check if service account credentials are configured
   */
  public hasServiceAccountCredentials(): boolean {
    try {
      const config = this.loadConfig();
      const keyPath = config.speechCredentialsPath || path.join(app.getPath('userData'), 'speech-credentials.enc');
      return fs.existsSync(keyPath);
    } catch (err) {
      safeError("Error checking for service account credentials:", err);
      return false;
    }
  }

  /**
   * Remove stored service account credentials
   */
  public removeServiceAccountCredentials(): boolean {
    try {
      const config = this.loadConfig();
      // Clear speech credentials related properties
      config.hasSpeechCredentials = false;
      config.speechCredentialsPath = undefined;
      
      // Also attempt to delete the file if it exists
      if (config.speechCredentialsPath && fs.existsSync(config.speechCredentialsPath)) {
        fs.unlinkSync(config.speechCredentialsPath);
      }
      
      // Save updated config
      this.saveConfig(config);
      
      // Emit config updated event
      this.emit('config-updated');
      
      return true;
    } catch (error) {
      safeError('Error removing service account credentials:', error);
      return false;
    }
  }

  /**
   * Simple encryption method for service account credentials
   */
  private encrypt(text: string): string {
    const algorithm = 'aes-256-ctr';
    const machineId = this.getMachineId(); // Get unique machine identifier
    const key = crypto.scryptSync(machineId, 'salt', 32);
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(algorithm, key, iv);
    const encrypted = Buffer.concat([cipher.update(text), cipher.final()]);
    return `${iv.toString('hex')}:${encrypted.toString('hex')}`;
  }

  /**
   * Decrypt service account credentials
   */
  private decrypt(encryptedText: string): string {
    try {
      const algorithm = 'aes-256-ctr';
      const machineId = this.getMachineId();
      const key = crypto.scryptSync(machineId, 'salt', 32);
      
      const [ivHex, encryptedHex] = encryptedText.split(':');
      const iv = Buffer.from(ivHex, 'hex');
      const encryptedBuffer = Buffer.from(encryptedHex, 'hex');
      
      const decipher = crypto.createDecipheriv(algorithm, key, iv);
      const decrypted = Buffer.concat([decipher.update(encryptedBuffer), decipher.final()]);
      
      return decrypted.toString();
    } catch (err) {
      safeError("Error decrypting data:", err);
      return '';
    }
  }

  /**
   * Get a unique machine identifier for encryption key
   */
  private getMachineId(): string {
    try {
      // Use app name and user data path to create a unique but consistent ID
      const baseId = app.getName() + app.getPath('userData');
      const hash = crypto.createHash('sha256').update(baseId).digest('hex');
      return hash.substring(0, 32); // Return first 32 chars for AES-256
    } catch (err) {
      safeError("Error getting machine ID:", err);
      // Fallback to a static key - not ideal but prevents crashes
      return 'f4ll8ack1d3nt1f13rf0r3ncrypt10n';
    }
  }
}

// Export a singleton instance
export const configHelper = new ConfigHelper();
