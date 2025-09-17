// ProcessingHelper.ts
import fs from "node:fs"
import path from "node:path"
import { ScreenshotHelper } from "./ScreenshotHelper"
import { IProcessingHelperDeps } from "./main"
import * as axios from "axios"
import { app, BrowserWindow, dialog } from "electron"
import { OpenAI } from "openai"
import { configHelper } from "./ConfigHelper"
import Anthropic from '@anthropic-ai/sdk';
import FormData from 'form-data';
import { personalityPrompts, DEFAULT_PERSONALITY } from "./ipcHandlers"; // Import constants from ipcHandlers
import crypto from 'crypto';
import { setupVAD, createVADRecorder, VADOptions, VADRecorder, VADHelper } from './VADHelper';
import { GoogleSpeechService } from './GoogleSpeechService'; // Import from local electron directory
// OpenAIWhisperService import removed
// Types directly defined here instead of importing
type RecordType = {
  id: string;
  startTime: number;
  endTime: number;
  duration: number;
  audioBlob: Blob;
  transcript?: string;
}

type ProcessedTranscript = {
  text: string;
  confidenceScore?: number;
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

// Safe warning logging
const safeWarn = (...args: any[]) => {
  try {
    console.warn(...args);
  } catch (error: any) {
    // Silently handle EPIPE errors
    if (error && typeof error === 'object' && 'code' in error && error.code === 'EPIPE') {
      // Process communication pipe is closed, ignore
    } else if (error) {
      // Try to log to stderr instead
      try {
        process.stderr.write(`WARNING: ${args.map(a => String(a)).join(' ')}\n`);
      } catch (_) {
        // Last resort, ignore completely
      }
    }
  }
};

// Interface for Gemini API requests
interface GeminiMessage {
  role: string;
  parts: Array<{
    text?: string;
    inlineData?: {
      mimeType: string;
      data: string;
    }
  }>;
}

interface GeminiResponse {
  candidates: Array<{
    content: {
      parts: Array<{
        text: string;
      }>;
    };
    finishReason: string;
  }>;
}

interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: Array<{
    type: 'text' | 'image';
    text?: string;
    source?: {
      type: 'base64';
      media_type: string;
      data: string;
    };
  }>;
}

// Interface matching the settings structure from store.ts
interface AiSettings {
  personality: string;
  interviewStage: string;
  userPreferences: string;
}

// Add interface for OpenAI transcription response near the top with other interfaces
interface OpenAITranscriptionResponse {
  text: string;
}

export class ProcessingHelper {
  public deps: IProcessingHelperDeps
  private screenshotHelper: any
  private textBuffer: string[] = []
  private openaiClient: OpenAI | null = null
  private anthropicClient: Anthropic | null = null
  private geminiApiKey: string | null = null
  // Speech service and related properties
  private googleSpeechService: GoogleSpeechService | null = null
  private transcriptionCache = new Map<string, { timestamp: number, text: string }>()
  private readonly CACHE_TTL = 1000 * 60 * 10; // 10 minutes cache TTL
  
  // Using 'any' type to avoid import issues
  private vadHelper: any = null
  private isProcessingAudio: boolean = false
  
  private sendMainTranscript: ((transcript: string) => void) | null = null
  private sendPartialTranscript: ((transcript: string) => void) | null = null
  private sendError: ((message: string) => void) | null = null

  // AbortControllers for API requests
  private currentProcessingAbortController: AbortController | null = null
  private currentExtraProcessingAbortController: AbortController | null = null

  // Add features for suggestions and transcription management
  private pendingPartialSuggestions: Map<string, Promise<any>> = new Map();

  // Add properties to the ProcessingHelper class
  private continuousProcessingActive: boolean = false;
  private vadProcessor: VADRecorder | null = null;
  private audioStream: MediaStream | null = null;
  private transcriptBuffer: string = '';
  private autoResponseTimeout: NodeJS.Timeout | null = null;
  private partialTranscripts: string[] = [];
  private lastPartialTranscriptId: string = '';

  constructor(deps: IProcessingHelperDeps) {
    this.deps = deps
    
    // Handle screenshot helper initialization safely
    const screenshotHelper = deps.getScreenshotHelper()
    if (screenshotHelper) {
      this.screenshotHelper = screenshotHelper
    } else {
      // Create a temporary instance for testing purposes - this shouldn't happen in production
      console.error("Warning: ScreenshotHelper not provided in ProcessingHelper constructor")
      this.screenshotHelper = ScreenshotHelper.getInstance()
    }
    
    // Initialize AI client based on config
    this.initializeAIClient();
    
    // Listen for config changes to re-initialize the AI client
    configHelper.on('config-updated', () => {
      this.initializeAIClient();
    });
  }
  
  /**
   * Initialize or reinitialize the AI client with current config
   */
  private initializeAIClient(): void {
    try {
      const config = configHelper.loadConfig();
      
      if (config.apiProvider === "openai") {
        if (config.apiKey) {
          this.openaiClient = new OpenAI({ 
            apiKey: config.apiKey,
            timeout: 30000, // 30 second timeout - reduced from 60s
            maxRetries: 1   // Reduced retries from 2 to 1 for faster failure
          });
          this.anthropicClient = null;
          safeLog("OpenAI client initialized successfully");
        } else {
          this.openaiClient = null;
          this.anthropicClient = null;
          safeLog("No API key available, OpenAI client not initialized");
        }
      } else if (config.apiProvider === "gemini"){
        // Gemini client initialization - Note: Gemini uses REST API, not SDK client
        this.openaiClient = null;
        this.anthropicClient = null;
        if (config.apiKey) {
          // Store Gemini API key for direct REST API calls
          this.geminiApiKey = config.apiKey;
          safeLog("Gemini API key set successfully");
        } else {
          this.openaiClient = null;
          this.anthropicClient = null;
          this.geminiApiKey = null;
          safeLog("No API key available, Gemini client not initialized");
        }
      } else if (config.apiProvider === "anthropic") {
        // Reset other clients
        this.openaiClient = null;
        this.anthropicClient = null;
        if (config.apiKey) {
          this.anthropicClient = new Anthropic({
            apiKey: config.apiKey,
            timeout: 30000, // 30 second timeout - reduced from 60s
            maxRetries: 1   // Reduced retries from 2 to 1 for faster failure
          });
          safeLog("Anthropic client initialized successfully");
        } else {
          this.openaiClient = null;
          this.anthropicClient = null;
          safeLog("No API key available, Anthropic client not initialized");
        }
      }
    } catch (error) {
      safeError("Failed to initialize AI client:", error);
      this.openaiClient = null;
      this.anthropicClient = null;
    }
  }

  private async waitForInitialization(
    mainWindow: BrowserWindow
  ): Promise<void> {
    let attempts = 0
    const maxAttempts = 50 // 5 seconds total

    while (attempts < maxAttempts) {
      const isInitialized = await mainWindow.webContents.executeJavaScript(
        "window.__IS_INITIALIZED__"
      )
      if (isInitialized) return
      await new Promise((resolve) => setTimeout(resolve, 100))
      attempts++
    }
    throw new Error("App failed to initialize after 5 seconds")
  }

  private async getCredits(): Promise<number> {
    const mainWindow = this.deps.getMainWindow()
    if (!mainWindow) return 999 // Unlimited credits in this version

    try {
      await this.waitForInitialization(mainWindow)
      return 999 // Always return sufficient credits to work
    } catch (error) {
      safeError("Error getting credits:", error)
      return 999 // Unlimited credits as fallback
    }
  }

  private async getLanguage(): Promise<string> {
    try {
      // Get language from config
      const config = configHelper.loadConfig();
      if (config.language) {
        return config.language;
      }
      
      // Fallback to window variable if config doesn't have language
      const mainWindow = this.deps.getMainWindow()
      if (mainWindow) {
        try {
          await this.waitForInitialization(mainWindow)
          const language = await mainWindow.webContents.executeJavaScript(
            "window.__LANGUAGE__"
          )

          if (
            typeof language === "string" &&
            language !== undefined &&
            language !== null
          ) {
            return language;
          }
        } catch (err) {
          safeWarn("Could not get language from window", err);
        }
      }
      
      // Default fallback
      return "python";
    } catch (error) {
      safeError("Error getting language:", error)
      return "python"
    }
  }

  public async processScreenshots(): Promise<void> {
    const mainWindow = this.deps.getMainWindow()
    if (!mainWindow) return

    const config = configHelper.loadConfig();
    
    // First verify we have a valid AI client
    if (config.apiProvider === "openai" && !this.openaiClient) {
      this.initializeAIClient();
      
      if (!this.openaiClient) {
        safeError("OpenAI client not initialized");
        mainWindow.webContents.send(
          this.deps.PROCESSING_EVENTS.API_KEY_INVALID
        );
        return;
      }
    } else if (config.apiProvider === "gemini" && !this.geminiApiKey) {
      this.initializeAIClient();
      
      if (!this.geminiApiKey) {
        safeError("Gemini API key not initialized");
        mainWindow.webContents.send(
          this.deps.PROCESSING_EVENTS.API_KEY_INVALID
        );
        return;
      }
    } else if (config.apiProvider === "anthropic" && !this.anthropicClient) {
      // Add check for Anthropic client
      this.initializeAIClient();
      
      if (!this.anthropicClient) {
        safeError("Anthropic client not initialized");
        mainWindow.webContents.send(
          this.deps.PROCESSING_EVENTS.API_KEY_INVALID
        );
        return;
      }
    }

    const view = this.deps.getView()
    safeLog("Processing screenshots in view:", view)

    if (view === "queue") {
      mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.INITIAL_START)
      const screenshotQueue = this.screenshotHelper.getScreenshotQueue()
      safeLog("Processing main queue screenshots:", screenshotQueue)
      
      // Send progress update
      mainWindow.webContents.send("processing-status", {
        message: "Starting problem extraction...",
        progress: 10
      })
      
      // Check if the queue is empty
      if (!screenshotQueue || screenshotQueue.length === 0) {
        safeLog("No screenshots found in queue");
        mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.NO_SCREENSHOTS);
        return;
      }

      // Check that files actually exist
      const existingScreenshots = screenshotQueue.filter((path: string) => fs.existsSync(path));
      if (existingScreenshots.length === 0) {
        safeLog("Screenshot files don't exist on disk");
        mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.NO_SCREENSHOTS);
        return;
      }

      try {
        // Initialize AbortController
        this.currentProcessingAbortController = new AbortController()
        const { signal } = this.currentProcessingAbortController

        const screenshots = await Promise.all(
          existingScreenshots.map(async (path: string) => {
            try {
              return {
                path,
                preview: await this.screenshotHelper.getImagePreview(path),
                data: fs.readFileSync(path).toString('base64')
              };
            } catch (err) {
              safeError(`Error reading screenshot ${path}:`, err);
              return null;
            }
          })
        )

        // Filter out any nulls from failed screenshots
        const validScreenshots = screenshots.filter(Boolean);
        
        if (validScreenshots.length === 0) {
          throw new Error("Failed to load screenshot data");
        }

        // Filter out null values and match expected type for helper functions
        const processableScreenshots = validScreenshots
          .filter((s): s is { path: string; preview: string; data: string } => 
            s !== null && 
            typeof s.path === 'string' && 
            typeof s.data === 'string');

        // Extract needed fields for processing to match expected type
        const processReadyScreenshots = processableScreenshots.map(s => ({
          path: s.path,
          data: s.data
        }));

        const result = await this.processScreenshotsHelper(processReadyScreenshots, signal)

        if (!result.success) {
          safeError("Processing failed:", result.error)
          if (result.error?.includes("API Key") || result.error?.includes("OpenAI") || result.error?.includes("Gemini")) {
            mainWindow.webContents.send(
              this.deps.PROCESSING_EVENTS.API_KEY_INVALID
            )
          } else {
            mainWindow.webContents.send(
              this.deps.PROCESSING_EVENTS.INITIAL_SOLUTION_ERROR,
              result.error
            )
          }
          // Reset view back to queue on error
          safeLog("Resetting view to queue due to error")
          this.deps.setView("queue")
          return
        }

        // Only set view to solutions if processing succeeded
        safeLog("Setting view to solutions after successful processing")
        
        // Save solution data to store for future debug reference
        this.deps.store.set('lastSolutionData', result.data);
        
        // Ensure proper timing for UI updates
        await new Promise(resolve => setTimeout(resolve, 50));
        
        mainWindow.webContents.send(
          this.deps.PROCESSING_EVENTS.SOLUTION_SUCCESS,
          result.data
        )
        this.deps.setView("solutions")
      } catch (error: any) {
        mainWindow.webContents.send(
          this.deps.PROCESSING_EVENTS.INITIAL_SOLUTION_ERROR,
          error
        )
        safeError("Processing error:", error)
        if (axios.isCancel(error)) {
          mainWindow.webContents.send(
            this.deps.PROCESSING_EVENTS.INITIAL_SOLUTION_ERROR,
            "Processing was canceled by the user."
          )
        } else {
          mainWindow.webContents.send(
            this.deps.PROCESSING_EVENTS.INITIAL_SOLUTION_ERROR,
            error.message || "Server error. Please try again."
          )
        }
        // Reset view back to queue on error
        safeLog("Resetting view to queue due to error")
        this.deps.setView("queue")
      } finally {
        this.currentProcessingAbortController = null
      }
    } else {
      // view == 'solutions'
      const extraScreenshotQueue =
        this.screenshotHelper.getExtraScreenshotQueue()
      safeLog("Processing extra queue screenshots:", extraScreenshotQueue)
      
      // Check if the extra queue is empty
      if (!extraScreenshotQueue || extraScreenshotQueue.length === 0) {
        safeLog("No extra screenshots found in queue");
        mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.NO_SCREENSHOTS);
        
        return;
      }

      // Check that files actually exist
      const existingExtraScreenshots = extraScreenshotQueue.filter((path: string) => fs.existsSync(path));
      if (existingExtraScreenshots.length === 0) {
        safeLog("Extra screenshot files don't exist on disk");
        mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.NO_SCREENSHOTS);
        return;
      }
      
      mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.DEBUG_START)
      
      // Send progress update
      mainWindow.webContents.send("processing-status", {
        message: "Processing additional screenshot...",
        progress: 20
      })

      // Initialize AbortController
      this.currentExtraProcessingAbortController = new AbortController()
      const { signal } = this.currentExtraProcessingAbortController

      try {
        // Get all screenshots (both main and extra) for processing
        const allPaths = [
          ...this.screenshotHelper.getScreenshotQueue(),
          ...existingExtraScreenshots
        ];
        
        // Screenshots loaded for debug processing
        
        const screenshots = await Promise.all(
          allPaths.map(async (path) => {
            try {
              if (!fs.existsSync(path)) {
                safeWarn(`Screenshot file does not exist: ${path}`);
                return null;
              }
              
              return {
                path,
                preview: await this.screenshotHelper.getImagePreview(path),
                data: fs.readFileSync(path).toString('base64')
              };
            } catch (err) {
              safeError(`Error reading screenshot ${path}:`, err);
              return null;
            }
          })
        )
        
        // Filter out any nulls from failed screenshots
        const validScreenshots = screenshots.filter(Boolean);
        
        if (validScreenshots.length === 0) {
          throw new Error("Failed to load screenshot data for debugging");
        }
        
        // Log screenshot paths safely
        safeLog(
          "Combined screenshots for processing:",
          validScreenshots.map((s) => s?.path || "unknown path").filter(Boolean)
        )

        // Filter out null values and match expected type for helper functions
        const processableScreenshots = validScreenshots
          .filter((s): s is { path: string; preview: string; data: string } => 
            s !== null && typeof s.path === 'string' && typeof s.data === 'string');

        // Extract needed fields for processing to match expected type
        const processReadyScreenshots = processableScreenshots.map(s => ({
          path: s.path,
          data: s.data
        }));

        // Send progress update before debug processing
        mainWindow.webContents.send("processing-status", {
          message: "Analyzing screenshots for debugging...",
          progress: 50
        });
        
        const result = await this.processExtraScreenshotsHelper(
          processReadyScreenshots,
          signal
        )

        if (result.success) {
          // Add delay to ensure proper UI updates
          await new Promise(resolve => setTimeout(resolve, 100));
          
          safeLog("Sending DEBUG_SUCCESS event with data:", JSON.stringify(result.data, null, 2))
          
          this.deps.setHasDebugged(true)
          mainWindow.webContents.send(
            this.deps.PROCESSING_EVENTS.DEBUG_SUCCESS,
            result.data
          )
        } else {
          mainWindow.webContents.send(
            this.deps.PROCESSING_EVENTS.DEBUG_ERROR,
            result.error
          )
        }
      } catch (error: any) {
        if (axios.isCancel(error)) {
          mainWindow.webContents.send(
            this.deps.PROCESSING_EVENTS.DEBUG_ERROR,
            "Extra processing was canceled by the user."
          )
        } else {
          mainWindow.webContents.send(
            this.deps.PROCESSING_EVENTS.DEBUG_ERROR,
            error.message
          )
        }
      } finally {
        this.currentExtraProcessingAbortController = null
      }
    }
  }

  private async processScreenshotsHelper(
    screenshots: Array<{ path: string; data: string }>,
    signal: AbortSignal
  ) {
    try {
      const config = configHelper.loadConfig();
      const language = await this.getLanguage();
      const mainWindow = this.deps.getMainWindow();
      
      // Step 1: Extract problem info using AI Vision API (OpenAI or Gemini)
      const imageDataList = screenshots.map(screenshot => screenshot.data);
      
      // Update the user on progress
      if (mainWindow) {
        mainWindow.webContents.send("processing-status", {
          message: "Analyzing problem from screenshots...",
          progress: 20
        });
      }

      let problemInfo;
      
      if (config.apiProvider === "openai") {
        // Verify OpenAI client
        if (!this.openaiClient) {
          this.initializeAIClient(); // Try to reinitialize
          
          if (!this.openaiClient) {
            return {
              success: false,
              error: "OpenAI API key not configured or invalid. Please check your settings."
            };
          }
        }

        // Use OpenAI for processing
        const messages = [
          {
            role: "system" as const, 
            content: "You are a coding challenge interpreter. Analyze the screenshot of the coding problem and extract all relevant information. Return the information in JSON format with these fields: problem_statement, constraints, example_input, example_output. Just return the structured JSON without any other text."
          },
          {
            role: "user" as const,
            content: [
              {
                type: "text" as const, 
                text: `Extract the coding problem details from these screenshots. Return in JSON format. Preferred coding language we gonna use for this problem is ${language}.`
              },
              ...imageDataList.map(data => ({
                type: "image_url" as const,
                image_url: { url: `data:image/png;base64,${data}` }
              }))
            ]
          }
        ];

        // Send to OpenAI Vision API
        const extractionResponse = await this.openaiClient.chat.completions.create({
          model: config.extractionModel || "gpt-4o",
          messages: messages,
          max_tokens: 4000,
          temperature: 0.2
        });

        // Parse the response
        try {
          const responseText = extractionResponse.choices[0].message.content || '';
          // Handle when OpenAI might wrap the JSON in markdown code blocks
          const jsonText = responseText.replace(/```json|```/g, '').trim();
          problemInfo = JSON.parse(jsonText);
        } catch (error) {
          safeError("Error parsing OpenAI response:", error);
          return {
            success: false,
            error: "Failed to parse problem information. Please try again or use clearer screenshots."
          };
        }
      } else if (config.apiProvider === "gemini")  {
        // Use Gemini API
        if (!this.geminiApiKey) {
          return {
            success: false,
            error: "Gemini API key not configured. Please check your settings."
          };
        }

        try {
          // Create Gemini message structure
          const geminiMessages = [
            {
              role: "user",
              parts: [
                {
                  text: `You are a coding challenge interpreter. Analyze the screenshots of the coding problem and extract all relevant information. Return the information in JSON format with these fields: problem_statement, constraints, example_input, example_output. Just return the structured JSON without any other text. Preferred coding language we gonna use for this problem is ${language}.`
                },
                ...imageDataList.map(data => ({
                  inlineData: {
                    mimeType: "image/png",
                    data: data
                  }
                }))
              ]
            }
          ];
          
          // Make API request to Gemini using the correct API key
          const response = await axios.default.post(
            `https://generativelanguage.googleapis.com/v1beta/models/${config.extractionModel || "gemini-2.0-flash"}:generateContent?key=${this.geminiApiKey}`,
            {
              contents: geminiMessages,
              generationConfig: {
                temperature: 0.2,
                maxOutputTokens: 4000
              }
            },
            { signal }
          );

          const responseData = response.data as GeminiResponse;
          
          if (!responseData.candidates || responseData.candidates.length === 0) {
            throw new Error("Empty response from Gemini API");
          }
          
          const responseText = responseData.candidates[0].content.parts[0].text;
          
          // Handle when Gemini might wrap the JSON in markdown code blocks
          const jsonText = responseText.replace(/```json|```/g, '').trim();
          problemInfo = JSON.parse(jsonText);
        } catch (error) {
          safeError("Error using Gemini API:", error);
          return {
            success: false,
            error: "Failed to process with Gemini API. Please check your API key or try again later."
          };
        }
      } else if (config.apiProvider === "anthropic") {
        if (!this.anthropicClient) {
          return {
            success: false,
            error: "Anthropic API key not configured. Please check your settings."
          };
        }

        try {
          const messages = [
            {
              role: "user" as const,
              content: [
                {
                  type: "text" as const,
                  text: `Extract the coding problem details from these screenshots. Return in JSON format with these fields: problem_statement, constraints, example_input, example_output. Preferred coding language is ${language}.`
                },
                ...imageDataList.map(data => ({
                  type: "image" as const,
                  source: {
                    type: "base64" as const,
                    media_type: "image/png" as const,
                    data: data
                  }
                }))
              ]
            }
          ];

          const response = await this.anthropicClient.messages.create({
            model: config.extractionModel || "claude-3-7-sonnet-20250219",
            max_tokens: 4000,
            messages: messages,
            temperature: 0.2
          });

          const responseText = (response.content[0] as { type: 'text', text: string }).text;
          const jsonText = responseText.replace(/```json|```/g, '').trim();
          problemInfo = JSON.parse(jsonText);
        } catch (error: any) {
          safeError("Error using Anthropic API:", error);

          // Add specific handling for Claude's limitations
          if (error.status === 429) {
            return {
              success: false,
              error: "Claude API rate limit exceeded. Please wait a few minutes before trying again."
            };
          } else if (error.status === 413 || (error.message && error.message.includes("token"))) {
            return {
              success: false,
              error: "Your screenshots contain too much information for Claude to process. Switch to OpenAI or Gemini in settings which can handle larger inputs."
            };
          }

          return {
            success: false,
            error: "Failed to process with Anthropic API. Please check your API key or try again later."
          };
        }
      }
      
      // Update the user on progress
      if (mainWindow) {
        mainWindow.webContents.send("processing-status", {
          message: "Problem analyzed successfully. Preparing to generate solution...",
          progress: 40
        });
      }

      // Store problem info in AppState
      this.deps.setProblemInfo(problemInfo);

      // Send first success event
      if (mainWindow) {
        mainWindow.webContents.send(
          this.deps.PROCESSING_EVENTS.PROBLEM_EXTRACTED,
          problemInfo
        );

        // Send progress update before solution generation
        mainWindow.webContents.send("processing-status", {
          message: "Generating solution...",
          progress: 60
        });
        
        // Generate solutions after successful extraction
        safeLog("Starting solution generation...")
        const solutionsResult = await this.generateSolutionsHelper(signal);
        safeLog("Solution generation completed. Success:", solutionsResult.success)
        if (solutionsResult.success) {
          safeLog("Solution data:", JSON.stringify(solutionsResult.data, null, 2))
          // Clear any existing extra screenshots before transitioning to solutions view
          this.screenshotHelper.clearExtraScreenshotQueue();
          
          // Final progress update
          mainWindow.webContents.send("processing-status", {
            message: "Solution generated successfully",
            progress: 100
          });
          
          // Add a small delay to ensure proper UI state transition
          await new Promise(resolve => setTimeout(resolve, 100));
          
          // Save solution data to store for future debug reference
          this.deps.store.set('lastSolutionData', solutionsResult.data);
          
          safeLog("Sending SOLUTION_SUCCESS event to renderer")
          mainWindow.webContents.send(
            this.deps.PROCESSING_EVENTS.SOLUTION_SUCCESS,
            solutionsResult.data
          );
          return { success: true, data: solutionsResult.data };
        } else {
          safeError("Solution generation failed:", solutionsResult.error)
          throw new Error(
            solutionsResult.error || "Failed to generate solutions"
          );
        }
      }

      return { success: false, error: "Failed to process screenshots" };
    } catch (error: any) {
      // If the request was cancelled, don't retry
      if (axios.isCancel(error)) {
        return {
          success: false,
          error: "Processing was canceled by the user."
        };
      }
      
      // Handle OpenAI API errors specifically
      if (error?.response?.status === 401) {
        return {
          success: false,
          error: "Invalid OpenAI API key. Please check your settings."
        };
      } else if (error?.response?.status === 429) {
        return {
          success: false,
          error: "OpenAI API rate limit exceeded or insufficient credits. Please try again later."
        };
      } else if (error?.response?.status === 500) {
        return {
          success: false,
          error: "OpenAI server error. Please try again later."
        };
      }

      safeError("API Error Details:", error);
      return { 
        success: false, 
        error: error.message || "Failed to process screenshots. Please try again." 
      };
    }
  }

  private async generateSolutionsHelper(signal: AbortSignal) {
    safeLog("generateSolutionsHelper: Starting solution generation")
    try {
      const problemInfo = this.deps.getProblemInfo();
      const language = await this.getLanguage();
      const config = configHelper.loadConfig();
      const mainWindow = this.deps.getMainWindow();
      
      safeLog("generateSolutionsHelper: Config loaded. API Provider:", config.apiProvider)

      if (!problemInfo) {
        throw new Error("No problem info available");
      }

      // Update progress status
      if (mainWindow) {
        mainWindow.webContents.send("processing-status", {
          message: "Analyzing screenshots for existing code...",
          progress: 50
        });
      }

      // Get screenshots to analyze for existing code
      const screenshotQueue = this.deps.getScreenshotQueue();
      const screenshots: Array<{ path: string; data: string }> = [];
      
      for (const screenshotPath of screenshotQueue) {
        try {
          const imageData = fs.readFileSync(screenshotPath, "base64");
          screenshots.push({ path: screenshotPath, data: imageData });
        } catch (error) {
          console.error(`Failed to load screenshot ${screenshotPath}:`, error);
        }
      }

      // Update progress status
      if (mainWindow) {
        mainWindow.webContents.send("processing-status", {
          message: "Creating optimal solution with detailed explanations...",
          progress: 60
        });
      }

      // Analyze screenshots for existing code
      let existingCodeContext = "";
      if (screenshots.length > 0) {
        existingCodeContext = `

IMPORTANT: I can see screenshots that may contain existing code solutions or attempts. Please analyze the screenshots carefully and:
- If you see existing code, use it as a reference point
- If the existing code is incomplete, build upon it
- If the existing code has issues, improve it while maintaining the same approach when possible
- If the existing code is already good, explain why it works and suggest any optimizations

Please be specific about what you observe in the screenshots when providing your solution.`;
      }

      // Create prompt for solution generation
      const promptText = `
Generate a detailed solution for the following coding problem:

PROBLEM STATEMENT:
${problemInfo.problem_statement}

CONSTRAINTS:
${problemInfo.constraints || "No specific constraints provided."}

EXAMPLE INPUT:
${problemInfo.example_input || "No example input provided."}

EXAMPLE OUTPUT:
${problemInfo.example_output || "No example output provided."}

LANGUAGE: ${language}${existingCodeContext}

I need the response in the following format:
1. Code: A clean, optimized implementation in ${language}
2. Your Thoughts: A list of key insights and reasoning behind your approach
3. Time complexity: O(X) with a detailed explanation (at least 2 sentences)
4. Space complexity: O(X) with a detailed explanation (at least 2 sentences)

For complexity explanations, please be thorough. For example: "Time complexity: O(n) because we iterate through the array only once. This is optimal as we need to examine each element at least once to find the solution." or "Space complexity: O(n) because in the worst case, we store all elements in the hashmap. The additional space scales linearly with the input size."

Your solution should be efficient, well-commented, and handle edge cases.
`;

      let responseContent;
      
      if (config.apiProvider === "openai") {
        // OpenAI processing
        if (!this.openaiClient) {
          return {
            success: false,
            error: "OpenAI API key not configured. Please check your settings."
          };
        }
        
        // Prepare messages with screenshots if available
        const messages: any[] = [
          { role: "system", content: "You are an expert coding interview assistant. Analyze any screenshots provided to understand existing code solutions, then provide clear, optimal solutions with detailed explanations." }
        ];

        if (screenshots.length > 0) {
          // Add user message with text and images
          const userMessage = {
            role: "user" as const,
            content: [
              { type: "text" as const, text: promptText },
              ...screenshots.map(screenshot => ({
                type: "image_url" as const,
                image_url: { url: `data:image/png;base64,${screenshot.data}` }
              }))
            ]
          };
          messages.push(userMessage);
        } else {
          // Add simple text message if no screenshots
          messages.push({ role: "user" as const, content: promptText });
        }
        
        // Send to OpenAI API
        const solutionResponse = await this.openaiClient.chat.completions.create({
          model: config.solutionModel || "gpt-4o",
          messages: messages as any,
          max_tokens: 4000,
          temperature: 0.2
        });

        responseContent = solutionResponse.choices[0].message.content;
      } else if (config.apiProvider === "gemini")  {
        // Gemini processing
        if (!this.geminiApiKey) {
          return {
            success: false,
            error: "Gemini API key not configured. Please check your settings."
          };
        }
        
        try {
          // Create Gemini message structure with screenshots if available
          const parts: any[] = [
            {
              text: `You are an expert coding interview assistant. Analyze any screenshots provided to understand existing code solutions, then provide a clear, optimal solution with detailed explanations for this problem:\n\n${promptText}`
            }
          ];

          // Add screenshots as inline data if available
          if (screenshots.length > 0) {
            screenshots.forEach(screenshot => {
              parts.push({
                inlineData: {
                  mimeType: "image/png",
                  data: screenshot.data
                }
              });
            });
          }

          const geminiMessages = [
            {
              role: "user",
              parts: parts
            }
          ];

          // Make API request to Gemini using correct API key
          const response = await axios.default.post(
            `https://generativelanguage.googleapis.com/v1beta/models/${config.solutionModel || "gemini-2.0-flash"}:generateContent?key=${this.geminiApiKey}`,
            {
              contents: geminiMessages,
              generationConfig: {
                temperature: 0.2,
                maxOutputTokens: 4000
              }
            },
            { signal }
          );

          const responseData = response.data as GeminiResponse;
          
          if (!responseData.candidates || responseData.candidates.length === 0) {
            throw new Error("Empty response from Gemini API");
          }
          
          responseContent = responseData.candidates[0].content.parts[0].text;
        } catch (error) {
          safeError("Error using Gemini API for solution:", error);
          return {
            success: false,
            error: "Failed to generate solution with Gemini API. Please check your API key or try again later."
          };
        }
      } else if (config.apiProvider === "anthropic") {
        // Anthropic processing
        if (!this.anthropicClient) {
          return {
            success: false,
            error: "Anthropic API key not configured. Please check your settings."
          };
        }
        
        try {
          // Prepare content array with text and screenshots
          const content: any[] = [
            {
              type: "text" as const,
              text: `You are an expert coding interview assistant. Analyze any screenshots provided to understand existing code solutions, then provide a clear, optimal solution with detailed explanations for this problem:\n\n${promptText}`
            }
          ];

          // Add screenshots if available
          if (screenshots.length > 0) {
            screenshots.forEach(screenshot => {
              content.push({
                type: "image" as const,
                source: {
                  type: "base64" as const,
                  media_type: "image/png" as const,
                  data: screenshot.data
                }
              });
            });
          }

          const messages = [
            {
              role: "user" as const,
              content: content
            }
          ];

          // Send to Anthropic API
          const response = await this.anthropicClient.messages.create({
            model: config.solutionModel || "claude-3-7-sonnet-20250219",
            max_tokens: 4000,
            messages: messages,
            temperature: 0.2
          });

          responseContent = (response.content[0] as { type: 'text', text: string }).text;
        } catch (error: any) {
          safeError("Error using Anthropic API for solution:", error);

          // Add specific handling for Claude's limitations
          if (error.status === 429) {
            return {
              success: false,
              error: "Claude API rate limit exceeded. Please wait a few minutes before trying again."
            };
          } else if (error.status === 413 || (error.message && error.message.includes("token"))) {
            return {
              success: false,
              error: "Your screenshots contain too much information for Claude to process. Switch to OpenAI or Gemini in settings which can handle larger inputs."
            };
          }

          return {
            success: false,
            error: "Failed to generate solution with Anthropic API. Please check your API key or try again later."
          };
        }
      }
      
      // Extract parts from the response
      const codeMatch = responseContent?.match(/```(?:\w+)?\s*([\s\S]*?)```/);
      const code = codeMatch ? codeMatch[1].trim() : (responseContent || '');
      
      // Extract thoughts, looking for bullet points or numbered lists
      const thoughtsRegex = /(?:Thoughts:|Key Insights:|Reasoning:|Approach:)([\s\S]*?)(?:Time complexity:|$)/i;
      const thoughtsMatch = responseContent?.match(thoughtsRegex);
      let thoughts: string[] = [];
      
      if (thoughtsMatch && thoughtsMatch[1]) {
        // Extract bullet points or numbered items
        const bulletPoints = thoughtsMatch[1].match(/(?:^|\n)\s*(?:[-*•]|\d+\.)\s*(.*)/g);
        if (bulletPoints) {
          thoughts = bulletPoints.map(point => 
            point.replace(/^\s*(?:[-*•]|\d+\.)\s*/, '').trim()
          ).filter(Boolean);
        } else {
          // If no bullet points found, split by newlines and filter empty lines
          thoughts = thoughtsMatch[1].split('\n')
            .map((line) => line.trim())
            .filter(Boolean);
        }
      }
      
      // Extract complexity information
      const timeComplexityPattern = /Time complexity:?\s*([^\n]+(?:\n[^\n]+)*?)(?=\n\s*(?:Space complexity|$))/i;
      const spaceComplexityPattern = /Space complexity:?\s*([^\n]+(?:\n[^\n]+)*?)(?=\n\s*(?:[A-Z]|$))/i;
      
      let timeComplexity = "O(n) - Linear time complexity because we only iterate through the array once. Each element is processed exactly one time, and the hashmap lookups are O(1) operations.";
      let spaceComplexity = "O(n) - Linear space complexity because we store elements in the hashmap. In the worst case, we might need to store all elements before finding the solution pair.";
      
      const timeMatch = responseContent?.match(timeComplexityPattern);
      if (timeMatch && timeMatch[1]) {
        timeComplexity = timeMatch[1].trim();
        if (!timeComplexity.match(/O\([^)]+\)/i)) {
          timeComplexity = `O(n) - ${timeComplexity}`;
        } else if (!timeComplexity.includes('-') && !timeComplexity.includes('because')) {
          const notationMatch = timeComplexity.match(/O\([^)]+\)/i);
          if (notationMatch) {
            const notation = notationMatch[0];
            const rest = timeComplexity.replace(notation, '').trim();
            timeComplexity = `${notation} - ${rest}`;
          }
        }
      }
      
      const spaceMatch = responseContent?.match(spaceComplexityPattern);
      if (spaceMatch && spaceMatch[1]) {
        spaceComplexity = spaceMatch[1].trim();
        if (!spaceComplexity.match(/O\([^)]+\)/i)) {
          spaceComplexity = `O(n) - ${spaceComplexity}`;
        } else if (!spaceComplexity.includes('-') && !spaceComplexity.includes('because')) {
          const notationMatch = spaceComplexity.match(/O\([^)]+\)/i);
          if (notationMatch) {
            const notation = notationMatch[0];
            const rest = spaceComplexity.replace(notation, '').trim();
            spaceComplexity = `${notation} - ${rest}`;
          }
        }
      }

      const formattedResponse = {
        code: code,
        thoughts: thoughts.length > 0 ? thoughts : ["Solution approach based on efficiency and readability"],
        time_complexity: timeComplexity,
        space_complexity: spaceComplexity
      };

      safeLog("generateSolutionsHelper: Solution generation successful. Code length:", code.length)
      return { success: true, data: formattedResponse };
    } catch (error: any) {
      if (axios.isCancel(error)) {
        return {
          success: false,
          error: "Processing was canceled by the user."
        };
      }
      
      if (error?.response?.status === 401) {
        return {
          success: false,
          error: "Invalid OpenAI API key. Please check your settings."
        };
      } else if (error?.response?.status === 429) {
        return {
          success: false,
          error: "OpenAI API rate limit exceeded or insufficient credits. Please try again later."
        };
      }
      
      safeError("generateSolutionsHelper: Solution generation error:", error);
      return { success: false, error: error.message || "Failed to generate solution" };
    }
  }

  private async processExtraScreenshotsHelper(
    screenshots: Array<{ path: string; data: string }>,
    signal: AbortSignal
  ) {
    try {
      const problemInfo = this.deps.getProblemInfo();
      const language = await this.getLanguage();
      const config = configHelper.loadConfig();
      const mainWindow = this.deps.getMainWindow();

      if (!problemInfo) {
        throw new Error("No problem info available");
      }

      // Update progress status
      if (mainWindow) {
        mainWindow.webContents.send("processing-status", {
          message: "Processing debug screenshots...",
          progress: 30
        });
      }

      // Prepare the images for the API call
      const imageDataList = screenshots.map(screenshot => screenshot.data);
      
      let debugContent;
      
      if (config.apiProvider === "openai") {
        if (!this.openaiClient) {
          return {
            success: false,
            error: "OpenAI API key not configured. Please check your settings."
          };
        }
        
        // Get the original solution for context
        const originalSolution = this.deps.store.get('lastSolutionData') as any;
        const originalCode = originalSolution?.code || 'No original solution available';
        
        safeLog("Debug processing - Original solution code:", originalCode.substring(0, 200) + "...");
        
        const messages = [
          {
            role: "system" as const, 
            content: `You are an expert coding interview assistant specializing in debugging and code analysis. You will be given:
1. A coding problem statement
2. An original working solution 
3. Screenshots showing current code, error messages, test failures, or incorrect outputs

Your job is to:
- Compare the current code (from screenshots) with the original working solution
- Identify exactly what went wrong and why
- Provide precise fixes that address the specific issues shown
- Ensure the corrected code maintains the original algorithm's correctness

CRITICAL: Always provide a complete, corrected version of the code that fixes the identified issues.

Your response MUST follow this exact structure:
### Issues Identified
- List each specific issue found with clear explanation
- Reference line numbers or code sections when visible

### Root Cause Analysis  
- Explain the underlying cause of each issue
- Connect errors to specific code changes or logic problems

### Corrected Code Solution
\`\`\`${language.toLowerCase()}
// Provide the complete corrected code here
// Include all necessary parts, not just the changed sections
\`\`\`

### Explanation of Fixes
- Explain why each change fixes the identified problem
- Show before/after comparisons for key changes

### Testing Recommendations
- Suggest specific test cases to verify the fix
- Mention edge cases to validate`
          },
          {
            role: "user" as const,
            content: [
              {
                type: "text" as const, 
                text: `CRITICAL DEBUGGING REQUEST:
Problem: "${problemInfo.problem_statement}"
Language: ${language}

ORIGINAL WORKING SOLUTION:
\`\`\`${language.toLowerCase()}
${originalCode}
\`\`\`

URGENT: I need you to analyze the EXACT ERROR shown in the screenshots.

WHAT TO LOOK FOR IN THE SCREENSHOTS:
1. **Error Messages**: Look for runtime errors, syntax errors, compilation errors
2. **Test Case Failures**: Check if specific test cases are failing
3. **Code Differences**: Compare what's visible in the screenshot with the original solution
4. **Line Numbers**: Pay attention to specific line numbers mentioned in errors

REQUIREMENTS:
- **BE SPECIFIC**: Reference the exact error message you see in the screenshot
- **BE PRECISE**: Identify the exact line and character causing the issue
- **PROVIDE WORKING CODE**: Give the complete corrected solution that fixes the visible error
- **EXPLAIN THE FIX**: Explain exactly what was wrong and why your fix works

DO NOT give generic responses. Analyze the ACTUAL error shown in the screenshot and provide a targeted solution.` 
              },
              ...imageDataList.map(data => ({
                type: "image_url" as const,
                image_url: { url: `data:image/png;base64,${data}` }
              }))
            ]
          }
        ];

        if (mainWindow) {
          mainWindow.webContents.send("processing-status", {
            message: "Analyzing code and generating debug feedback...",
            progress: 60
          });
        }

        const debugResponse = await this.openaiClient.chat.completions.create({
          model: config.debuggingModel || "gpt-4o",
          messages: messages,
          max_tokens: 4000,
          temperature: 0.2
        });
        debugContent = debugResponse.choices[0].message.content;
      } else if (config.apiProvider === "gemini")  {
        if (!this.geminiApiKey) {
          return {
            success: false,
            error: "Gemini API key not configured. Please check your settings."
          };
        }
        
        try {
          // Get the original solution for context
          const originalSolution = this.deps.store.get('lastSolutionData') as any;
          const originalCode = originalSolution?.code || 'No original solution available';
          
          const debugPrompt = `
You are an expert coding interview assistant specializing in debugging and code analysis. You will be given:
1. A coding problem statement
2. An original working solution 
3. Screenshots showing current code, error messages, test failures, or incorrect outputs

Your job is to:
- Compare the current code (from screenshots) with the original working solution
- Identify exactly what went wrong and why
- Provide precise fixes that address the specific issues shown
- Ensure the corrected code maintains the original algorithm's correctness

CRITICAL: Always provide a complete, corrected version of the code that fixes the identified issues.

YOUR RESPONSE MUST FOLLOW THIS EXACT STRUCTURE:
### Issues Identified
- List each specific issue found with clear explanation
- Reference line numbers or code sections when visible

### Root Cause Analysis  
- Explain the underlying cause of each issue
- Connect errors to specific code changes or logic problems

### Corrected Code Solution
\`\`\`${language.toLowerCase()}
// Provide the complete corrected code here
// Include all necessary parts, not just the changed sections
\`\`\`

### Explanation of Fixes
- Explain why each change fixes the identified problem
- Show before/after comparisons for key changes

### Testing Recommendations
- Suggest specific test cases to verify the fix
- Mention edge cases to validate
`;

          const geminiMessages = [
            {
              role: "user",
              parts: [
                { text: `CRITICAL DEBUGGING REQUEST:
Problem: "${problemInfo.problem_statement}"
Language: ${language}

ORIGINAL WORKING SOLUTION:
\`\`\`${language.toLowerCase()}
${originalCode}
\`\`\`

URGENT: Analyze the EXACT ERROR shown in the screenshots.

WHAT TO LOOK FOR:
1. **Error Messages**: Look for runtime errors, syntax errors, compilation errors
2. **Test Case Failures**: Check if specific test cases are failing  
3. **Code Differences**: Compare visible code with the original solution
4. **Line Numbers**: Pay attention to specific line numbers in errors

REQUIREMENTS:
- **BE SPECIFIC**: Reference the exact error message you see
- **BE PRECISE**: Identify the exact line and character causing the issue
- **PROVIDE WORKING CODE**: Give complete corrected solution that fixes the visible error
- **EXPLAIN THE FIX**: Explain exactly what was wrong and why your fix works

DO NOT give generic responses. Analyze the ACTUAL error in the screenshot.` },
                ...imageDataList.map(data => ({
                  inlineData: {
                    mimeType: "image/png",
                    data: data
                  }
                }))
              ]
            }
          ];

          if (mainWindow) {
            mainWindow.webContents.send("processing-status", {
              message: "Analyzing code and generating debug feedback with Gemini...",
              progress: 60
            });
          }

          // Make API request to Gemini using correct API key
          const response = await axios.default.post(
            `https://generativelanguage.googleapis.com/v1beta/models/${config.debuggingModel || "gemini-2.0-flash"}:generateContent?key=${this.geminiApiKey}`,
            {
              contents: geminiMessages,
              generationConfig: {
                temperature: 0.2,
                maxOutputTokens: 4000
              }
            },
            { signal }
          );

          const responseData = response.data as GeminiResponse;
          
          if (!responseData.candidates || responseData.candidates.length === 0) {
            throw new Error("Empty response from Gemini API");
          }
          
          debugContent = responseData.candidates[0].content.parts[0].text;
        } catch (error) {
          safeError("Error using Gemini API for debugging:", error);
          return {
            success: false,
            error: "Failed to process debug request with Gemini API. Please check your API key or try again later."
          };
        }
      } else if (config.apiProvider === "anthropic") {
        if (!this.anthropicClient) {
          return {
            success: false,
            error: "Anthropic API key not configured. Please check your settings."
          };
        }
        
        try {
          // Get the original solution for context
          const originalSolution = this.deps.store.get('lastSolutionData') as any;
          const originalCode = originalSolution?.code || 'No original solution available';
          
          const debugPrompt = `
You are an expert coding interview assistant specializing in debugging and code analysis. You will be given:
1. A coding problem statement
2. An original working solution 
3. Screenshots showing current code, error messages, test failures, or incorrect outputs

Your job is to:
- Compare the current code (from screenshots) with the original working solution
- Identify exactly what went wrong and why
- Provide precise fixes that address the specific issues shown
- Ensure the corrected code maintains the original algorithm's correctness

CRITICAL: Always provide a complete, corrected version of the code that fixes the identified issues.

YOUR RESPONSE MUST FOLLOW THIS EXACT STRUCTURE:
### Issues Identified
- List each specific issue found with clear explanation
- Reference line numbers or code sections when visible

### Root Cause Analysis  
- Explain the underlying cause of each issue
- Connect errors to specific code changes or logic problems

### Corrected Code Solution
\`\`\`${language.toLowerCase()}
// Provide the complete corrected code here
// Include all necessary parts, not just the changed sections
\`\`\`

### Explanation of Fixes
- Explain why each change fixes the identified problem
- Show before/after comparisons for key changes

### Testing Recommendations
- Suggest specific test cases to verify the fix
- Mention edge cases to validate
`;

          const messages = [
            {
              role: "user" as const,
              content: [
                {
                  type: "text" as const,
                  text: `CRITICAL DEBUGGING REQUEST:
Problem: "${problemInfo.problem_statement}"
Language: ${language}

ORIGINAL WORKING SOLUTION:
\`\`\`${language.toLowerCase()}
${originalCode}
\`\`\`

URGENT: Analyze the EXACT ERROR shown in the screenshots.

WHAT TO LOOK FOR:
1. **Error Messages**: Look for runtime errors, syntax errors, compilation errors
2. **Test Case Failures**: Check if specific test cases are failing  
3. **Code Differences**: Compare visible code with the original solution
4. **Line Numbers**: Pay attention to specific line numbers in errors

REQUIREMENTS:
- **BE SPECIFIC**: Reference the exact error message you see
- **BE PRECISE**: Identify the exact line and character causing the issue
- **PROVIDE WORKING CODE**: Give complete corrected solution that fixes the visible error
- **EXPLAIN THE FIX**: Explain exactly what was wrong and why your fix works

DO NOT give generic responses. Analyze the ACTUAL error in the screenshot.`
                },
                ...imageDataList.map(data => ({
                  type: "image" as const,
                  source: {
                    type: "base64" as const,
                    media_type: "image/png" as const, 
                    data: data
                  }
                }))
              ]
            }
          ];

          if (mainWindow) {
            mainWindow.webContents.send("processing-status", {
              message: "Analyzing code and generating debug feedback with Claude...",
              progress: 60
            });
          }

          const response = await this.anthropicClient.messages.create({
            model: config.debuggingModel || "claude-3-7-sonnet-20250219",
            max_tokens: 4000,
            messages: messages,
            temperature: 0.2
          });
          debugContent = (response.content[0] as { type: 'text', text: string }).text;
        } catch (error: any) {
          safeError("Error using Anthropic API for debugging:", error);
          
          // Add specific handling for Claude's limitations
          if (error.status === 429) {
            return {
              success: false,
              error: "Claude API rate limit exceeded. Please wait a few minutes before trying again."
            };
          } else if (error.status === 413 || (error.message && error.message.includes("token"))) {
            return {
              success: false,
              error: "Your screenshots contain too much information for Claude to process. Switch to OpenAI or Gemini in settings which can handle larger inputs."
            };
          }
          
          return {
            success: false,
            error: "Failed to process debug request with Anthropic API. Please check your API key or try again later."
          };
        }
      }
      
      
      if (mainWindow) {
        mainWindow.webContents.send("processing-status", {
          message: "Debug analysis complete",
          progress: 100
        });
      }

      // Extract the corrected code from the debug response
      let extractedCode = "// Debug mode - see analysis below";
      
      safeLog("Debug response content preview:", debugContent?.substring(0, 500) + "...");
      
      // Look for code in the "Corrected Code Solution" section specifically
      const correctedCodeMatch = debugContent?.match(/### Corrected Code Solution[\s\S]*?```[a-zA-Z]*\n([\s\S]*?)\n```/);
      if (correctedCodeMatch && correctedCodeMatch[1]) {
        extractedCode = correctedCodeMatch[1].trim();
        safeLog("Found code in Corrected Code Solution section");
      } else {
        // Look for "Fixed Solution" or similar patterns
        const fixedSolutionMatch = debugContent?.match(/(?:Fixed Solution|Here's the corrected|corrected solution)[\s\S]*?```[a-zA-Z]*\n([\s\S]*?)\n```/i);
        if (fixedSolutionMatch && fixedSolutionMatch[1]) {
          extractedCode = fixedSolutionMatch[1].trim();
          safeLog("Found code in Fixed Solution section");
        } else {
          // Get all code blocks and filter out error messages
          const allCodeBlocks = debugContent?.match(/```[a-zA-Z]*\n([\s\S]*?)\n```/g);
          if (allCodeBlocks && allCodeBlocks.length > 0) {
            // Find the largest code block that doesn't look like an error message
            let bestCode = "";
            for (const block of allCodeBlocks) {
              const codeContent = block.replace(/```[a-zA-Z]*\n/, '').replace(/\n```$/, '').trim();
              // Skip if it looks like an error message or is too short
              if (codeContent.length > bestCode.length && 
                  !codeContent.toLowerCase().includes('syntaxerror') &&
                  !codeContent.toLowerCase().includes('error message') &&
                  codeContent.length > 50 &&
                  (codeContent.includes('def ') || codeContent.includes('class ') || codeContent.includes('function'))) {
                bestCode = codeContent;
              }
            }
            if (bestCode) {
              extractedCode = bestCode;
              safeLog("Found best code block, length:", bestCode.length);
            } else {
              safeLog("No suitable code block found, keeping default");
            }
          }
        }
      }

      let formattedDebugContent = debugContent || '';
      
      // Extract key insights for the thoughts array
      const thoughts = [];
      
      // Extract issues from the "Issues Identified" section
      const issuesMatch = formattedDebugContent.match(/### Issues Identified([\s\S]*?)(?=###|$)/);
      if (issuesMatch) {
        const issues = issuesMatch[1].match(/- ([^\n]+)/g);
        if (issues) {
          thoughts.push(...issues.map(issue => `🔍 ${issue.replace(/^- /, '')}`).slice(0, 2));
        }
      }
      
      // Extract fixes from the "Explanation of Fixes" section
      const fixesMatch = formattedDebugContent.match(/### Explanation of Fixes([\s\S]*?)(?=###|$)/);
      if (fixesMatch) {
        const fixes = fixesMatch[1].match(/- ([^\n]+)/g);
        if (fixes) {
          thoughts.push(...fixes.map(fix => `🔧 ${fix.replace(/^- /, '')}`).slice(0, 2));
        }
      }
      
      // Fallback if no specific sections found
      if (thoughts.length === 0) {
        const bulletPoints = formattedDebugContent.match(/(?:^|\n)[ ]*(?:[-*•]|\d+\.)[ ]+([^\n]+)/g);
        if (bulletPoints) {
          thoughts.push(...bulletPoints.map(point => 
            point.replace(/^[ ]*(?:[-*•]|\d+\.)[ ]+/, '').trim()
          ).slice(0, 4));
        } else {
          thoughts.push("Debug analysis completed - check the corrected code");
        }
      }
      
      const response = {
        code: extractedCode,
        debug_analysis: formattedDebugContent,
        thoughts: thoughts,
        time_complexity: "N/A - Debug mode",
        space_complexity: "N/A - Debug mode"
      };

      safeLog("Debug processing completed. Extracted code length:", extractedCode.length, "First 100 chars:", extractedCode.substring(0, 100))
      safeLog("Debug response thoughts:", thoughts)
      
      return { success: true, data: response };
    } catch (error: any) {
      safeError("Debug processing error:", error);
      return { success: false, error: error.message || "Failed to process debug request" };
    }
  }

  public cancelOngoingRequests(): void {
    let wasCancelled = false

    if (this.currentProcessingAbortController) {
      this.currentProcessingAbortController.abort()
      this.currentProcessingAbortController = null
      wasCancelled = true
    }

    if (this.currentExtraProcessingAbortController) {
      this.currentExtraProcessingAbortController.abort()
      this.currentExtraProcessingAbortController = null
      wasCancelled = true
    }

    this.deps.setHasDebugged(false)

    this.deps.setProblemInfo(null)

    const mainWindow = this.deps.getMainWindow()
    if (wasCancelled && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.NO_SCREENSHOTS)
    }
  }

  // Add a new method for handling simple text queries
  public async handleSimpleQuery(
    query: string, 
    language: string, 
    systemPrompt?: string
  ): Promise<{ success: boolean, data?: string, error?: string }> {
    safeLog(`Handling simple query: "${query}" (Language: ${language})`);
    const config = configHelper.loadConfig();
    const mainWindow = this.deps.getMainWindow();

    // Ensure AI client is initialized and API key is valid
    if (config.apiProvider === "openai" && !this.openaiClient) {
      this.initializeAIClient();
      if (!this.openaiClient) {
        safeError("OpenAI client not initialized for simple query");
        mainWindow?.webContents.send(this.deps.PROCESSING_EVENTS.API_KEY_INVALID);
        return { success: false, error: "OpenAI API key not configured or invalid." };
      }
    } else if (config.apiProvider === "gemini" && !this.geminiApiKey) {
      this.initializeAIClient();
      if (!this.geminiApiKey) {
        safeError("Gemini API key not initialized for simple query");
        mainWindow?.webContents.send(this.deps.PROCESSING_EVENTS.API_KEY_INVALID);
        return { success: false, error: "Gemini API key not configured or invalid." };
      }
    } else if (config.apiProvider === "anthropic" && !this.anthropicClient) {
      this.initializeAIClient();
      if (!this.anthropicClient) {
        safeError("Anthropic client not initialized for simple query");
        mainWindow?.webContents.send(this.deps.PROCESSING_EVENTS.API_KEY_INVALID);
        return { success: false, error: "Anthropic API key not configured or invalid." };
      }
    }

    // Use the provided system prompt or a default
    const finalSystemPrompt = systemPrompt || "You are a helpful AI assistant. Respond clearly and concisely.";
    safeLog(`Using System Prompt: ${finalSystemPrompt.substring(0, 100)}...`);
    
    // Define the model to use (e.g., using the solutionModel or a dedicated one)
    const modelName = config.solutionModel; // Re-use solution model for now

    try {
      let responseText: string | undefined;

      if (config.apiProvider === "openai") {
        const completion = await this.openaiClient!.chat.completions.create({
          model: modelName || "gpt-4o",
          messages: [
            { role: "system", content: finalSystemPrompt }, // Use finalSystemPrompt
            { role: "user", content: query }
          ],
          max_tokens: 1500, // Adjust token limit as needed
          temperature: 0.5, // Adjust temperature for general queries
        });
        responseText = completion.choices[0].message.content || '';

      } else if (config.apiProvider === "gemini") {
        // IMPORTANT: Gemini standard API expects system prompt within the user message or specific setup.
        // Combining here for simplicity, review Gemini docs for best practices.
        const geminiMessages: GeminiMessage[] = [
          { role: "user", parts: [{ text: `${finalSystemPrompt}\n\nUser Query: ${query}` }] }
        ];

        const response = await axios.default.post(
          `https://generativelanguage.googleapis.com/v1beta/models/${modelName || "gemini-2.0-flash"}:generateContent?key=${this.geminiApiKey}`,
          {
            contents: geminiMessages,
            generationConfig: {
              temperature: 0.5,
              maxOutputTokens: 1500
            }
          }
          // Note: AbortSignal not easily applied here without more refactoring
        );
        const responseData = response.data as GeminiResponse;
        if (!responseData.candidates || responseData.candidates.length === 0) {
          throw new Error("Empty response from Gemini API");
        }
        responseText = responseData.candidates[0].content.parts[0].text;

      } else if (config.apiProvider === "anthropic") {
        const response = await this.anthropicClient!.messages.create({
          model: modelName || "claude-3-7-sonnet-20250219",
          max_tokens: 1500,
          messages: [{ role: "user", content: query }],
          system: finalSystemPrompt, // Use finalSystemPrompt
          temperature: 0.5,
        });
        responseText = (response.content[0] as { type: 'text', text: string }).text;
      }

      if (responseText) {
        safeLog(`Simple query successful. Response length: ${responseText.length}`);
        return { success: true, data: responseText };
      } else {
        throw new Error("No response content received from AI provider.");
      }

    } catch (error: any) { // Catch block needs to handle potential errors
      safeError('Error handling simple query:', error);
      let errorMessage = "An unknown error occurred during the AI query.";
      if (error.response) { // Axios error structure
        errorMessage = `API Error (${error.response.status}): ${error.response.data?.error?.message || error.message}`;
      } else if (error.status) { // OpenAI/Anthropic error structure
         errorMessage = `API Error (${error.status}): ${error.message}`;
      } else if (error.message) {
         errorMessage = error.message;
      }
      // Handle specific error codes if needed (e.g., 401, 429)
      if (error.status === 401 || error?.response?.status === 401) {
         errorMessage = "Invalid API Key. Please check settings.";
         mainWindow?.webContents.send(this.deps.PROCESSING_EVENTS.API_KEY_INVALID);
      } else if (error.status === 429 || error?.response?.status === 429) {
         errorMessage = "API Rate Limit Exceeded or insufficient quota. Please try again later.";
      }
      return { success: false, error: errorMessage };
    }
  }

  // --- Audio Transcription ---
  // Handle audio transcription using either OpenAI or Google Speech API
  public async handleAudioTranscription(
    audioBuffer: ArrayBuffer,
    mimeType: string = 'audio/mpeg'
  ): Promise<{ success: boolean, text?: string, error?: string, words?: { word: string, startTime: number, endTime: number }[] }> {
    try {
      safeLog(`Handling audio transcription, buffer size: ${audioBuffer.byteLength} bytes`);
      
      // Check which speech service to use
      const speechService = configHelper.getSpeechService();
      safeLog(`Using speech service: ${speechService}`);

      if (speechService === 'google') {
        const googleApiKey = configHelper.getGoogleSpeechApiKey();
        
        if (!googleApiKey) {
          safeError('Google Speech API key not configured');
          return { success: false, error: "Google Speech API key not configured" };
        }
        
        safeLog(`Using Google Speech API for transcription, API key length: ${googleApiKey.length}`);
        
        // Initialize Google Speech service with API key if needed
        if (!this.googleSpeechService) {
          safeLog('Creating new GoogleSpeechService instance');
          this.googleSpeechService = new GoogleSpeechService(googleApiKey);
        } else {
          // Make sure the API key is up to date
          safeLog('Updating API key in existing GoogleSpeechService instance');
          this.googleSpeechService.setApiKey(googleApiKey);
        }
        
        // For Google Speech, process audio data as LINEAR16
        const arrayBuffer = audioBuffer;
        const buffer = Buffer.from(arrayBuffer);
        safeLog(`Audio buffer converted to Uint8Array, size: ${buffer.length} bytes`);
        
        // Clear any previous audio data
        this.googleSpeechService.clearAudioBuffer();
        
        // Add audio data to Google Speech service
        this.googleSpeechService.sendAudioChunk(buffer);
        
        // Get transcription
        safeLog('Calling GoogleSpeechService.transcribeAudio()');
        try {
          // Pass mimeType to the transcription service
          const transcription = await this.googleSpeechService.transcribeAudio(new Uint8Array(buffer), mimeType);
          
          if (!transcription) {
            safeError('Google Speech API returned empty transcription');
            return { success: false, error: "Failed to transcribe audio with Google Speech API" };
          }
          
          // Check if the response includes word timestamps
          if (typeof transcription === 'object' && transcription.text) {
            safeLog(`Transcription successful with word timestamps, text length: ${transcription.text.length} characters, words: ${transcription.words?.length || 0}`);
            return { 
              success: true, 
              text: transcription.text,
              words: transcription.words || [] 
            };
          } else if (typeof transcription === 'string') {
            // Handle the string response
            safeLog(`Transcription successful (text only), length: ${transcription.length} characters`);
            return { success: true, text: transcription };
          } else {
            safeError('Google Speech API returned unexpected response format');
            // Convert to string to prevent crashes
            const fallbackText = String(transcription);
            if (fallbackText.trim()) {
              safeLog(`Using fallback string conversion: "${fallbackText}"`);
              return { success: true, text: fallbackText };
            }
            return { success: false, error: "Invalid response format from transcription service" };
          }
        } catch (transcriptionError: any) {
          safeError('Error during Google Speech API transcription:', transcriptionError);
          
          // Provide a more detailed error message if available
          let errorMessage = "Failed to transcribe audio with Google Speech API";
          if (transcriptionError.message) {
            // Look for specific known error message patterns
            if (transcriptionError.message.includes('check API key')) {
              errorMessage = "Google Speech API error - check API key in settings";
            } else if (transcriptionError.message.includes('Network')) {
              errorMessage = "Network error connecting to Google Speech API - check your internet connection";
            } else {
              errorMessage = transcriptionError.message;
            }
          }
          
          return { success: false, error: errorMessage };
        }
      } else {
        // Default to OpenAI Whisper
        safeLog('Using OpenAI Whisper for transcription');
        
        // TODO: Implement OpenAI whisper code
        // For now, return an error since we removed the original implementation
        return { 
          success: false, 
          error: "OpenAI Whisper implementation missing. Please configure Google Speech API."
        };
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      safeError("Error processing audio:", error);
      if (this.sendError) {
        this.sendError(`Error processing audio: ${errorMessage}`);
      }
      return { success: false, error: `Transcription failed: ${errorMessage}` };
    }
  }

  // --- Generate Response Suggestion --- 
  public async generateResponseSuggestion(
    question: string,
    jobContext: any, // Consider defining a specific type later
    resumeTextContent: string | null,
    settings: AiSettings, // Receive the full settings object
    speakerRole: 'user' | 'interviewer' = 'user' // Default to user if not specified
  ): Promise<{ success: boolean, data?: string, error?: string }> {
    try {
      safeLog(`Generating response suggestion for question: "${question}" (as ${speakerRole})`);
      const config = configHelper.loadConfig();

      // Clean the transcript for better response quality
      const cleanedQuestion = this.cleanTranscriptForSuggestion(question);

      // Modify the prompt to include speaker role context
      let promptTemplate = "";
      
      // Different prompt based on who is speaking
      if (speakerRole === 'interviewer') {
        promptTemplate = `You are an expert AI interview coach. Your goal is to help a job candidate by providing a strong, well-crafted, and complete sample response to the interviewer's latest statement/question.

The INTERVIEWER just stated or asked: "${cleanedQuestion}"

Based on the candidate profile and job details below, generate a complete, professional sample response that the candidate could use. **Tailor the focus, tone, and content of this response based on the Candidate's AI Assistant Personality ('${settings.personality}') and Preferences ('${settings.userPreferences}').**

Your generated sample response should aim to:
1.  Directly and clearly address the interviewer's specific point.
2.  Strategically connect relevant experiences/skills (from resume/background) to the job requirements or company values.
3.  Be structured logically (e.g., using STAR for behavioral questions where appropriate within the narrative).
4.  Incorporate specific examples or achievements for impact.
5.  Maintain an appropriate professional tone (as influenced by the Personality setting).

CANDIDATE PROFILE & JOB CONTEXT:
- Job Position: ${jobContext?.jobTitle || 'Not specified'}
- Key Skills Sought: ${jobContext?.keySkills || 'Not specified'}
- Company Mission/Values: ${jobContext?.companyMission || 'Not specified'}
- Candidate's AI Assistant Personality: ${settings.personality}
- Interview Stage: ${settings.interviewStage}
- Candidate's Preferences for Assistant: ${settings.userPreferences}
- Resume Summary: ${resumeTextContent ? resumeTextContent.substring(0, 1000) + '...' : 'No resume provided.'}

OUTPUT REQUIREMENTS:
- Provide a single, coherent, fully formulated sample response.
- The response should be ready for the candidate to adapt and use directly.
- Do NOT use bullet points for the main response.`;
      } else {
        // User (candidate) is speaking - AI suggestions are no longer generated for the user.
        // Clear the prompt template to ensure no AI suggestion is generated.
        promptTemplate = '';
      }

      // Only proceed if a prompt template was actually generated (i.e., if the interviewer spoke)
      if (promptTemplate) {
        const config = configHelper.loadConfig();
        let suggestion: string | undefined;

        safeLog(`generateResponseSuggestion: Using API provider: ${config.apiProvider}`);
        safeLog(`generateResponseSuggestion: OpenAI client exists: ${!!this.openaiClient}`);
        safeLog(`generateResponseSuggestion: Anthropic client exists: ${!!this.anthropicClient}`);

        // Use the configured API provider for suggestions
        if (config.apiProvider === "openai") {
          if (!this.openaiClient) {
            safeError('OpenAI client not initialized in ProcessingHelper for generateResponseSuggestion');
            return { success: false, error: 'OpenAI client not initialized' };
          }

          const messages: { role: 'system' | 'user'; content: string }[] = [
            { role: "system", content: "You are an AI interview assistant." },
            { role: "user", content: promptTemplate }
          ];

          const modelForSuggestions = config.solutionModel || "gpt-3.5-turbo";

          const completion = await this.openaiClient.chat.completions.create({
            model: modelForSuggestions,
            messages: messages,
            max_tokens: 2000,
            temperature: 0.5,
          });

          suggestion = completion.choices[0]?.message?.content?.trim();

        } else if (config.apiProvider === "anthropic") {
          if (!this.anthropicClient) {
            safeError('Anthropic client not initialized in ProcessingHelper for generateResponseSuggestion');
            return { success: false, error: 'Anthropic client not initialized' };
          }

          const response = await this.anthropicClient.messages.create({
            model: config.solutionModel || "claude-3-haiku-20240307",
            max_tokens: 2000,
            temperature: 0.5,
            messages: [{
              role: "user",
              content: `You are an AI interview assistant.\n\n${promptTemplate}`
            }]
          });

          suggestion = (response.content[0] as { type: 'text', text: string }).text?.trim();

        } else if (config.apiProvider === "gemini") {
          if (!config.apiKey) {
            safeError('Gemini API key not configured for generateResponseSuggestion');
            return { success: false, error: 'Gemini API key not configured' };
          }

          try {
            const geminiMessages = [{
              role: "user",
              parts: [{
                text: `You are an AI interview assistant.\n\n${promptTemplate}`
              }]
            }];

            const response = await axios.default.post(
              `https://generativelanguage.googleapis.com/v1beta/models/${config.solutionModel || "gemini-2.0-flash"}:generateContent?key=${config.apiKey}`,
              {
                contents: geminiMessages,
                generationConfig: {
                  temperature: 0.5,
                  maxOutputTokens: 2000
                }
              }
            );

            const responseData = response.data as any;
            if (responseData.candidates && responseData.candidates.length > 0) {
              suggestion = responseData.candidates[0].content.parts[0].text?.trim();
            }
          } catch (error) {
            safeError("Error using Gemini API for suggestions:", error);
            return { success: false, error: "Failed to generate suggestion with Gemini API" };
          }
        } else {
          return { success: false, error: "Unsupported API provider for suggestions" };
        }

      if (suggestion) {
        return { success: true, data: suggestion };
      } else {
        safeError("No suggestion content received from AI in generateResponseSuggestion");
        return { success: false, error: "Failed to get a valid suggestion from AI." };
      }
      // --- END MODIFICATION ---
      } else {
        safeError("No prompt template generated for generateResponseSuggestion");
        return { success: false, error: "Failed to generate prompt template" };
      }

    } catch (error) {
      safeError("Error generating response suggestion:", error);
      return { success: false, error: "Failed to generate suggestion" };
    }
  }
  // --- End Generate Response Suggestion ---

  /**
   * Begin generating a suggestion based on partial transcription
   * This allows for suggestions to start processing before transcription is complete
   * @param partialTranscript Partial transcription text
   * @param contextId Unique ID to track this request
   */
  public beginPartialSuggestionGeneration(
    partialTranscript: string,
    contextId: string,
    jobContext?: any,
    resumeTextContent?: string | null
  ): void {
    // Don't start if transcript is too short
    if (!partialTranscript || partialTranscript.length < 15) {
      return;
    }

    // Don't start if we already have a pending suggestion for this context
    if (this.pendingPartialSuggestions.has(contextId)) {
      return;
    }

    safeLog(`Beginning partial suggestion generation for context: ${contextId}`);
    
    // Get a clean version of the transcript with leading/trailing noise removed
    const cleanedTranscript = this.cleanTranscriptForSuggestion(partialTranscript);
    
    // Start a suggestion generation promise but don't await it
    const suggestionPromise = this.generateQuickSuggestion(cleanedTranscript, jobContext, resumeTextContent)
      .catch((error): null => {
        safeError('Error generating partial suggestion:', error);
        // Return null to indicate failure but not break the promise chain
        return null;
      })
      .finally(() => {
        // Clean up when done
        this.pendingPartialSuggestions.delete(contextId);
      });
    
    // Store the promise for later retrieval
    this.pendingPartialSuggestions.set(contextId, suggestionPromise);
  }

  /**
   * Retrieve a suggestion that was started in parallel
   * @param contextId Context ID used when starting the suggestion
   * @returns Promise that resolves to suggestion result or null if not found
   */
  public async getPartialSuggestion(contextId: string): Promise<{
    suggestion: string | null,
    isComplete: boolean
  }> {
    const pendingSuggestion = this.pendingPartialSuggestions.get(contextId);
    
    if (!pendingSuggestion) {
      return { suggestion: null, isComplete: false };
    }
    
    // Create a timeout promise explicitly
    const timeoutPromise = (): Promise<null> => {
      return new Promise<null>(resolve => {
        setTimeout(() => resolve(null), 5000);
      });
    };
    
    try {
      // Wait for the suggestion to complete, with a timeout
      const result = await Promise.race([
        pendingSuggestion,
        timeoutPromise()
      ]);
      
      if (result === null) {
        // Timeout or error occurred
        return { suggestion: null, isComplete: false };
      }
      
      return { 
        suggestion: result.data || null,
        isComplete: true
      };
    } catch (error) {
      safeError('Error retrieving partial suggestion:', error);
      return { suggestion: null, isComplete: false };
    }
  }

  /**
   * Clean transcript text for suggestion
   */
  private cleanTranscriptForSuggestion(transcript: string): string {
    // Remove leading/trailing spaces
    let cleaned = transcript.trim();
    
    // Remove common filler words at the beginning
    const fillerStarts = ['um', 'uh', 'hmm', 'so', 'like', 'well'];
    for (const filler of fillerStarts) {
      if (cleaned.toLowerCase().startsWith(filler + ' ')) {
        cleaned = cleaned.substring(filler.length).trim();
      }
    }
    
    return cleaned;
  }

  /**
   * Generate a quick suggestion based on partial transcript
   * Uses faster models and simpler prompts for speed
   */
  private async generateQuickSuggestion(
    transcript: string,
    jobContext?: any,
    resumeTextContent?: string | null
  ): Promise<{ success: boolean, data?: string, error?: string }> {
    try {
      const config = configHelper.loadConfig();
      
      // Build a simpler prompt for speed
      const prompt = `Generate a brief response suggestion for this interview question: "${transcript}"

Context:
${jobContext ? `- Job: ${jobContext.jobTitle || 'Unknown'}` : '- No job context'}
${resumeTextContent ? '- Resume available' : '- No resume available'}

Format your response as a concise, professional answer appropriate for a job interview. Focus on clarity and relevance. Keep under 200 words.`;

      // Use faster models
      if (config.apiProvider === "openai" && this.openaiClient) {
        // Use GPT-3.5 Turbo for quick responses
        const completion = await this.openaiClient.chat.completions.create({
          model: "gpt-3.5-turbo",
          messages: [{ role: "user", content: prompt }],
          max_tokens: 250,
          temperature: 0.7,
        });
        
        return { 
          success: true, 
          data: completion.choices[0]?.message.content || '' 
        };
      } else if (config.apiProvider === "gemini" && this.geminiApiKey) {
        // Implementation for Gemini would go here
        return { success: false, error: "Gemini implementation pending" };
      } else if (config.apiProvider === "anthropic" && this.anthropicClient) {
        // Implementation for Anthropic would go here  
        return { success: false, error: "Anthropic implementation pending" };
      } else {
        return { success: false, error: "No AI provider configured" };
      }
    } catch (error) {
      safeError('Error generating quick suggestion:', error);
      return { success: false, error: "Failed to generate quick suggestion" };
    }
  }

  // Add this method to detect if text is a complete thought or question
  private isCompleteThought(text: string): boolean {
    const trimmed = text.trim();
    
    // Check for sentence-ending punctuation
    if (/[.?!]$/.test(trimmed)) return true;
    
    // Check for common question phrases
    const questionPhrases = [
      'what do you think',
      'can you explain',
      'please explain',
      'could you describe',
      'what is your opinion',
      'tell me about'
    ];
    
    const lowerText = trimmed.toLowerCase();
    return questionPhrases.some(phrase => lowerText.includes(phrase));
  }

  /**
   * Enable continuous speech processing with automatic response generation
   * Returns controls to start/stop the continuous processing mode
   */
  public enableContinuousProcessing(
    onTranscriptUpdate: (text: string, isFinal: boolean) => void,
    onSuggestionStart: () => void,
    onSuggestionReady: (suggestion: string) => void,
    jobContext?: any,
    resumeTextContent?: string | null,
    settings?: AiSettings
  ): { start: () => Promise<boolean>, stop: () => Promise<void> } { // Made stop async
    
    const generateResponseFromTranscript = async (transcript: string) => {
      if (transcript.trim().length === 0) return;
      safeLog(`Generating response for final transcript: "${transcript}"`);
      onSuggestionStart();
      const fullResult = await this.generateResponseSuggestion(
        transcript, 
        jobContext || {}, 
        resumeTextContent || null,
        settings || { personality: 'Default', interviewStage: 'Initial Screening', userPreferences: '' }
      );
      if (fullResult.success && fullResult.data) {
        onSuggestionReady(fullResult.data);
      } else {
        safeError('Failed to generate suggestion from final transcript', fullResult.error);
      }
    };

    const start = async (): Promise<boolean> => {
      if (this.continuousProcessingActive) return true;
      
      try {
        this.partialTranscripts = [];
        if (this.autoResponseTimeout) clearTimeout(this.autoResponseTimeout);
        this.autoResponseTimeout = null;

        // FIXME: Determine speech service type properly from settings/deps
        const speechServiceType: string = 'google'; // Explicitly type as string for now
        safeLog(`Starting continuous processing with speech service: ${speechServiceType}`);

        let googleStreamStarted = false;
        if (speechServiceType === 'google') {
          this.googleSpeechService = new GoogleSpeechService();
          // TODO: Ensure API key is set or ADC/env vars configured
          
          const handleGoogleTranscript = (transcript: string, isFinal: boolean) => {
            // safeLog(`Google Transcript (${isFinal ? 'Final' : 'Interim'}): "${transcript}"`);
            onTranscriptUpdate(transcript, isFinal); // Forward to UI/main handler

            if (isFinal && transcript.trim()) {
              if (this.autoResponseTimeout) clearTimeout(this.autoResponseTimeout);
              // Simple approach: Generate suggestion immediately on final result
              generateResponseFromTranscript(transcript);
            } else if (transcript.trim()) { // Interim result
               if (this.autoResponseTimeout) clearTimeout(this.autoResponseTimeout);
               // Reset timeout: Generate suggestion if no further updates for 3s
               this.autoResponseTimeout = setTimeout(() => {
                  safeLog('Timeout after interim Google results - generating suggestion');
                  // We only have the interim transcript here. Might need to accumulate finals.
                  // For now, let's still call generateResponseFromTranscript with the last *interim*.
                  generateResponseFromTranscript(transcript); 
               }, 3000); 
            }
          };

          const webContents = this.deps.getMainWindow()?.webContents;
          if (!webContents) {
            safeError('Cannot start Google Speech streaming: Main window webContents not available.');
            return false;
          }
          // Pass webContents (now guaranteed to exist)
          // --- MODIFIED: Pass undefined for languageCode, callback as 3rd arg ---
          googleStreamStarted = this.googleSpeechService.startStreamingTranscription(webContents, undefined, handleGoogleTranscript);
          if (!googleStreamStarted) {
            safeError('Failed to start Google Speech streaming. Aborting start.');
            return false;
          }
        }
        
        // FIXME: These browser APIs (navigator, window) are not available in Node.js/Electron main process
        // This code needs to be moved to the renderer process or use IPC to communicate with renderer
        /*
        this.audioStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
        const sourceSampleRate = audioContext.sampleRate;
        safeLog(`AudioContext sample rate: ${sourceSampleRate}Hz`);
        */
        
        // Placeholder implementation for now
        safeLog('Audio capture not implemented in main process - needs renderer process integration');
        const sourceSampleRate = 44100; // Default assumption

        const vadOptions: VADOptions = {
          audioThreshold: 0.05,
          silenceThreshold: 750, // Default is now 750ms
          minSpeechDuration: 300,
          onSpeechStart: () => {
            safeLog('VAD: Speech started');
            if (this.autoResponseTimeout) clearTimeout(this.autoResponseTimeout);
            this.autoResponseTimeout = null;
          },
          onSpeechEnd: async (float32Audio: Float32Array) => { // Add type Float32Array
            safeLog(`VAD: Speech ended, processing ${float32Audio.length} samples`);
            
            if (speechServiceType === 'google' && this.googleSpeechService) {
                const linear16Buffer = await this.googleSpeechService.convertFloat32ToLinear16(float32Audio, sourceSampleRate, 16000);
                if (linear16Buffer) {
                    this.googleSpeechService.sendAudioChunk(linear16Buffer); // <-- Remove role argument
                } else {
                    safeError('Failed to convert audio for Google Speech');
                }
            } else {
              // Handle non-Google services (e.g., OpenAI)
              // The type checker warning is avoided by using else instead of else if
              if (speechServiceType === 'openai') {
                safeLog('Processing audio chunk for OpenAI...');
                try {
                  const blob = await this.float32ArrayToBlob(float32Audio, sourceSampleRate);
                  const arrayBuffer = await blob.arrayBuffer();
                  const result = await this.handleAudioTranscription(arrayBuffer, blob.type);
                  if (result.success && result.text) {
                    safeLog(`OpenAI Transcription: "${result.text}"`);
                    onTranscriptUpdate(result.text, true);
                    generateResponseFromTranscript(result.text);
                  } else {
                    safeError('OpenAI transcription failed', result.error);
                  }
                } catch (error) {
                   safeError('Error during OpenAI audio processing:', error);
                }
              } else {
                 safeWarn(`Unsupported or non-Google speech service type configured: ${speechServiceType}`);
              }
            }
          },
          onSilence: () => {
            safeLog('VAD: Silence detected');
          }
        };

        this.vadProcessor = createVADRecorder(vadOptions);
        await this.vadProcessor.start(); // Await start if it returns a Promise
        
        this.continuousProcessingActive = true;
        safeLog('Continuous processing started');
        return true;
        
      } catch (error) {
        safeError('Error starting continuous processing:', error);
        await stop();
        return false;
      }
    };
    
    const stop = async () => {
      if (!this.continuousProcessingActive) return;
      safeLog('Stopping continuous processing');
      this.continuousProcessingActive = false;
      
      if (this.vadProcessor) {
        this.vadProcessor.stop();
        this.vadProcessor = null;
      }

      if (this.googleSpeechService) {
          this.googleSpeechService.stopStreamingTranscription();
          this.googleSpeechService = null;
      }
      
      if (this.audioStream) {
        this.audioStream.getTracks().forEach(track => track.stop());
        this.audioStream = null;
      }
      
      if (this.autoResponseTimeout) {
        clearTimeout(this.autoResponseTimeout);
        this.autoResponseTimeout = null;
      }
      
      this.partialTranscripts = [];
      
      safeLog('Continuous processing stopped');
    };

    return { start, stop };
  }

  // Add a public stop method that's used in the enableContinuousProcessing method
  public stop(): void {
    // Stop continuous processing if active
    if (this.continuousProcessingActive) {
      // Stop VAD processor
      if (this.vadProcessor) {
        this.vadProcessor.stop();
        this.vadProcessor = null;
      }
      
      // Stop audio stream
      if (this.audioStream) {
        this.audioStream.getTracks().forEach(track => track.stop());
        this.audioStream = null;
      }
      
      // Clear timeouts
      if (this.autoResponseTimeout) {
        clearTimeout(this.autoResponseTimeout);
        this.autoResponseTimeout = null;
      }
      
      // Reset state
      this.partialTranscripts = [];
      this.continuousProcessingActive = false;
      
      safeLog('Continuous processing stopped');
    }
  }

  // Add a utility method to convert Float32Array to Blob
  private async float32ArrayToBlob(audioData: Float32Array, sampleRate: number): Promise<Blob> {
    // Create a buffer for the WAV file
    const buffer = new ArrayBuffer(44 + audioData.length * 2);
    const view = new DataView(buffer);
    
    // Write WAV header
    // "RIFF" chunk descriptor
    this.writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + audioData.length * 2, true);
    this.writeString(view, 8, 'WAVE');
    
    // "fmt " sub-chunk
    this.writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true); // fmt chunk size
    view.setUint16(20, 1, true); // audio format (PCM)
    view.setUint16(22, 1, true); // num channels (mono)
    view.setUint32(24, sampleRate, true); // sample rate
    view.setUint32(28, sampleRate * 2, true); // byte rate
    view.setUint16(32, 2, true); // block align
    view.setUint16(34, 16, true); // bits per sample
    
    // "data" sub-chunk
    this.writeString(view, 36, 'data');
    view.setUint32(40, audioData.length * 2, true); // chunk size
    
    // Write audio data
    const volume = 0.5; // Adjust volume if needed
    let offset = 44;
    for (let i = 0; i < audioData.length; i++, offset += 2) {
      const s = Math.max(-1, Math.min(1, audioData[i] * volume));
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
    }
    
    return new Blob([buffer], { type: 'audio/wav' });
  }

  // Helper to write strings to DataView
  private writeString(view: DataView, offset: number, string: string): void {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  }

  /**
   * Sets up the VAD helper
   */
  public setVadHelper(helper: VADHelper): void {
    this.vadHelper = helper
  }

  /**
   * Set up callback handlers for the processing helper
   */
  public setCallbacks(
    sendMainTranscript: (transcript: string) => void,
    sendPartialTranscript: (transcript: string) => void,
    sendError: (message: string) => void
  ): void {
    this.sendMainTranscript = sendMainTranscript
    this.sendPartialTranscript = sendPartialTranscript
    this.sendError = sendError
  }

  /**
   * Initializes services with API keys
   */
  public initializeServices(): void {
    try {
      const apiKey = configHelper.getApiKey()
      const language = configHelper.getLanguage() || "en-US"

      if (!apiKey) {
        console.error("API key not found")
        return
      }

      // Initialize Google Speech service with the API key
      this.googleSpeechService = new GoogleSpeechService(apiKey, language)

      console.log("Audio processing services initialized with API key")
    } catch (error) {
      console.error("Error initializing services:", error)
    }
  }

  /**
   * Starts the VAD processing if not already active
   */
  public startVADProcessing(): void {
    if (!this.vadHelper) {
      console.error("VAD helper not set")
      if (this.sendError) {
        this.sendError("VAD helper not set")
      }
      return
    }

    // Set up VAD callbacks
    this.vadHelper.setCallbacks({
      onSpeechStart: this.handleSpeechStart.bind(this),
      onSpeechData: this.handleSpeechData.bind(this),
      onSpeechEnd: this.handleSpeechEnd.bind(this),
      onVADMisfire: this.handleVADMisfire.bind(this),
    })

    // Start the VAD detection
    this.vadHelper.startVAD()
    console.log("VAD processing started")
  }

  /**
   * Stops the VAD processing
   */
  public stopVADProcessing(): void {
    if (this.vadHelper) {
      this.vadHelper.stopVAD()
      console.log("VAD processing stopped")
    }
  }

  /**
   * Handles the start of speech detection from VAD
   */
  private handleSpeechStart(): void {
    console.log("Speech started")
    // Reset the Google Speech service buffer when new speech is detected
    if (this.googleSpeechService) {
      this.googleSpeechService.clearAudioBuffer()
    }
    
    if (this.sendPartialTranscript) {
      this.sendPartialTranscript("") // Clear any previous partial transcript
    }
  }

  /**
   * Handles speech data from VAD
   * @param audioData Audio data from VAD
   */
  private handleSpeechData(audioData: Float32Array): void {
    // Skip if we're still processing the previous audio segment
    if (this.isProcessingAudio || !this.googleSpeechService) {
      return
    }

    // Convert Float32Array to Int16Array (required by Google Speech API)
    const pcmData = this.convertFloat32ToInt16(audioData)
    
    // Add the data to the Google Speech buffer for processing - CONVERT to Buffer
    this.googleSpeechService.sendAudioChunk(Buffer.from(pcmData.buffer, pcmData.byteOffset, pcmData.byteLength)); // <-- Remove role argument
    
    // Process for partial transcription every few chunks
    // This provides real-time feedback without overwhelming the API
    this.processPartialTranscription()
  }

  /**
   * Process partial transcription periodically
   */
  private async processPartialTranscription(): Promise<void> {
    if (!this.googleSpeechService || !this.sendPartialTranscript) {
      return
    }

    try {
      // Get partial transcription
      const partialResult = await this.googleSpeechService.transcribeAudio(new Uint8Array(0));
      
      // Convert result to string based on its type
      let partialText = "";
      if (typeof partialResult === 'string') {
        partialText = partialResult;
      } else if (partialResult && typeof partialResult === 'object' && 'text' in partialResult) {
        partialText = partialResult.text;
      }
      
      if (partialText) {
        this.sendPartialTranscript(partialText);
      }
    } catch (error) {
      console.error("Error getting partial transcription:", error)
    }
  }

  /**
   * Handles the end of speech detection from VAD
   * @param audioData Final audio data from VAD
   */
  private async handleSpeechEnd(audioData: Float32Array): Promise<void> {
    console.log("Speech ended, processing final audio...")
    
    if (!this.googleSpeechService || !this.sendMainTranscript) {
      return
    }

    try {
      this.isProcessingAudio = true
      
      // Convert and add final audio chunk - CONVERT to Buffer
      const pcmData = this.convertFloat32ToInt16(audioData)
      this.googleSpeechService.sendAudioChunk(Buffer.from(pcmData.buffer, pcmData.byteOffset, pcmData.byteLength)); // <-- Remove role argument
      
      // Process the full audio for final transcription
      const transcript = await this.googleSpeechService.transcribeAudio(pcmData);
      
      if (transcript) {
        console.log("Final transcript:", transcript)
        // Check if transcript is a string or an object with text property
        if (typeof transcript === 'string') {
          this.sendMainTranscript(transcript)
        } else if (typeof transcript === 'object' && 'text' in transcript) {
          this.sendMainTranscript(transcript.text)
        }
      } else {
        console.log("No transcript returned")
        if (this.sendError) {
          this.sendError("No transcript could be generated")
        }
      }
      
      // Clear the buffer after processing
      this.googleSpeechService.clearAudioBuffer()
      
    } catch (error) {
      console.error("Error processing audio:", error)
      if (this.sendError) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        this.sendError(`Error processing audio: ${errorMessage}`)
      }
    } finally {
      this.isProcessingAudio = false
    }
  }

  /**
   * Handles VAD misfire (false positive)
   */
  private handleVADMisfire(): void {
    console.log("VAD misfire detected, ignoring audio segment")
    
    // Clear any partial transcripts
    if (this.sendPartialTranscript) {
      this.sendPartialTranscript("")
    }
    
    // Reset the Google Speech service buffer
    if (this.googleSpeechService) {
      this.googleSpeechService.clearAudioBuffer()
    }
  }

  /**
   * Converts Float32Array audio data to Int16Array (format expected by Google Speech)
   * @param float32Audio Audio data as Float32Array
   * @returns Uint8Array containing Int16 PCM data
   */
  private convertFloat32ToInt16(float32Audio: Float32Array): Uint8Array {
    const pcmBuffer = new Int16Array(float32Audio.length)
    
    // Convert float audio values to 16-bit PCM
    for (let i = 0; i < float32Audio.length; i++) {
      // Scale to 16-bit signed int range (-32768 to 32767)
      // Clamp to range [-1, 1]
      const sample = Math.max(-1, Math.min(1, float32Audio[i]))
      
      // Convert to 16-bit int
      pcmBuffer[i] = sample < 0 
        ? sample * 0x8000 
        : sample * 0x7FFF
    }
    
    // Convert to Uint8Array for easier handling
    return new Uint8Array(pcmBuffer.buffer)
  }

  /**
   * Tests the Google API key
   * @returns Promise resolving to true if the API key is valid
   */
  public async testGoogleApiKey(): Promise<boolean> {
    try {
      const apiKey = configHelper.getApiKey()
      if (!apiKey) {
        return false
      }
      
      // Initialize a temporary service for testing
      const tempService = new GoogleSpeechService(apiKey)
      return await tempService.testApiKey()
    } catch (error) {
      console.error("Error testing Google API key:", error)
      return false
    }
  }

  /**
   * Tests the OpenAI API key
   * @returns Promise resolving to true if the API key is valid
   */
  public async testOpenAIApiKey(): Promise<boolean> {
    try {
      const apiKey = configHelper.getApiKey()
      if (!apiKey) {
        return false
      }
      
      // Direct API request to test OpenAI API key validity
      const response = await fetch("https://api.openai.com/v1/models", {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        }
      });
      
      return response.status === 200
    } catch (error) {
      console.error("Error testing OpenAI API key:", error)
      return false
    }
  }
}
