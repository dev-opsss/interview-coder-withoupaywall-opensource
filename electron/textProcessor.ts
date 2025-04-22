// textProcessor.ts - Handles processing of text inputs
import { safeLog, safeError } from "./main";
import { sanitizeTexts } from "./sanitizer";
import { configHelper } from "./ConfigHelper";

/**
 * Process text input from the user, handling commands and natural language
 * @param text The text input to process
 * @returns Result object with the processing outcome
 */
export async function processText(text: string): Promise<{
  success: boolean;
  data?: any;
  error?: string;
}> {
  try {
    if (!text || typeof text !== 'string') {
      return { success: false, error: 'Invalid input text' };
    }

    // Sanitize the input
    const [sanitizedText] = sanitizeTexts([text]);
    safeLog(`Processing text: "${sanitizedText}"`);

    // Check if we have API access
    if (!configHelper.hasApiKey()) {
      return { 
        success: false, 
        error: 'API key not configured. Please add your OpenAI API key in settings.' 
      };
    }

    // Get the API key and model from config
    const config = configHelper.loadConfig();
    const apiKey = config.apiKey;
    const provider = config.apiProvider;
    const model = config.extractionModel;

    // Process the text with OpenAI API (simple implementation)
    // In a real app, you would make the actual API call here
    safeLog(`Using model: ${model}`);
    
    // Simplified response for now
    return {
      success: true,
      data: {
        processed: true,
        text: sanitizedText,
        response: `Processed: ${sanitizedText}`
      }
    };
  } catch (error: any) {
    safeError('Error processing text:', error);
    return {
      success: false,
      error: error?.message || 'Unknown error processing text'
    };
  }
} 