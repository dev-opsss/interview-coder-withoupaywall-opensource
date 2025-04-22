// sanitizer.ts - Provides text sanitization utilities

import { safeLog } from "./main";

/**
 * Sanitizes a collection of texts to prevent XSS and other potential security issues
 * @param texts Array of text strings to sanitize
 * @returns Array of sanitized text strings
 */
export function sanitizeTexts(texts: string[]): string[] {
  safeLog("Sanitizing texts...");
  
  return texts.map(text => {
    // If null or undefined, return empty string
    if (text == null) return '';
    
    // Ensure we're working with a string
    const str = String(text);
    
    // Basic sanitization - remove suspicious HTML/scripts
    return str
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '')
      .replace(/<img[^>]*>/gi, '[IMAGE]')
      .replace(/<[^>]*>?/gi, ''); // Strip all remaining HTML tags
  });
} 