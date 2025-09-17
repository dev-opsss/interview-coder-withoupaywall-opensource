/**
 * Centralized Secure Logging System
 * - Category-based logging (speech, ui, ipc, auth, etc.)
 * - Runtime enable/disable per category
 * - Sanitizes sensitive data (API keys, tokens, credentials)
 * - File output with rotation
 * - Performance monitoring
 * - Backwards compatible with existing safeLog/safeError
 */

import fs from 'fs';
import path from 'path';
import { app } from 'electron';

export enum LogLevel {
  ERROR = 0,
  WARN = 1,
  INFO = 2,
  DEBUG = 3,
  TRACE = 4
}

export type LogCategory = 
  | 'speech'      // Audio processing, STT, TTS
  | 'ui'          // UI interactions, component lifecycle
  | 'ipc'         // Inter-process communication
  | 'auth'        // Authentication, API keys
  | 'file'        // File operations, I/O
  | 'network'     // HTTP requests, API calls
  | 'window'      // Window management, multi-monitor
  | 'system'      // System events, app lifecycle
  | 'performance' // Timing, memory, metrics
  | 'general';    // Default category

interface LogEntry {
  timestamp: string;
  level: string;
  category: LogCategory;
  message: string;
  data?: any;
}

interface LoggerConfig {
  globalLevel: LogLevel;
  categoryLevels: Partial<Record<LogCategory, LogLevel>>;
  enabledCategories: Set<LogCategory>;
  fileLogging: {
    enabled: boolean;
    directory: string;
    maxFileSize: number; // bytes
    maxFiles: number;
    filename: string;
  };
  console: {
    enabled: boolean;
    colorize: boolean;
  };
}

class CentralizedLogger {
  private config: LoggerConfig;
  private logBuffer: LogEntry[] = [];
  private flushTimer: NodeJS.Timeout | null = null;
  private store: any = null;
  private storeReady: Promise<void>;

  // Patterns to detect and mask sensitive data
  private sensitivePatterns = [
    /key["\s]*[:=]["\s]*[a-zA-Z0-9_-]{10,}/gi, // API keys
    /token["\s]*[:=]["\s]*[a-zA-Z0-9_.-]{10,}/gi, // Tokens
    /password["\s]*[:=]["\s]*[^\s"',}]{3,}/gi, // Passwords
    /secret["\s]*[:=]["\s]*[a-zA-Z0-9_.-]{10,}/gi, // Secrets
    /credential[s]?["\s]*[:=]["\s]*[^\s"',}]{10,}/gi, // Credentials
    /authorization["\s]*[:=]["\s]*[^\s"',}]{10,}/gi, // Auth headers
    /bearer\s+[a-zA-Z0-9_.-]{10,}/gi, // Bearer tokens
    // Specific API key patterns
    /AIza[0-9A-Za-z_-]{35}/gi, // Google API keys
    /sk-[a-zA-Z0-9]{48}/gi, // OpenAI API keys
    /sk-ant-[a-zA-Z0-9_-]{95}/gi, // Anthropic API keys
  ];

  private urlPatterns = [
    /(\?|&)(key|token|apikey|api_key|access_token)=[^&\s]*/gi
  ];

  // ANSI color codes for console output
  private colors = {
    ERROR: '\x1b[31m',   // Red
    WARN: '\x1b[33m',    // Yellow  
    INFO: '\x1b[36m',    // Cyan
    DEBUG: '\x1b[37m',   // White
    TRACE: '\x1b[90m',   // Gray
    RESET: '\x1b[0m'
  };

  constructor() {
    const isProduction = process.env.NODE_ENV === 'production';
    const logsDir = app ? path.join(app.getPath('logs'), 'app-logs') : './logs';

    // Initialize electron-store for persistence using dynamic import
    this.storeReady = this.initializeStore();

    // Default configuration
    const defaultConfig = {
      globalLevel: isProduction ? LogLevel.WARN : LogLevel.DEBUG,
      categoryLevels: {},
      enabledCategories: new Set<LogCategory>([
        'speech', 'ui', 'ipc', 'auth', 'file', 
        'network', 'window', 'system', 'performance', 'general'
      ]),
      fileLogging: {
        enabled: true,
        directory: logsDir,
        maxFileSize: 10 * 1024 * 1024, // 10MB
        maxFiles: 5,
        filename: 'app.log'
      },
      console: {
        enabled: true,
        colorize: !isProduction
      }
    };

    // Load saved configuration or use defaults
    this.config = defaultConfig;
    this.loadConfigFromStoreAsync(); // Load asynchronously

    // Ensure log directory exists
    this.ensureLogDirectory();

    // Set up periodic log flushing
    this.setupLogFlushing();
  }

  /**
   * Initialize electron-store with dynamic import
   */
  private async initializeStore(): Promise<void> {
    try {
      const Store = (await import('electron-store')).default;
      this.store = new Store({
        name: 'logging-config',
        defaults: {}
      });
    } catch (error) {
      console.error('Failed to initialize electron-store:', error);
      // Continue without store - will use in-memory only
    }
  }

  /**
   * Sanitize sensitive data from any input
   */
  private sanitize(input: any): any {
    if (typeof input === 'string') {
      let sanitized = input;
      
      // Mask sensitive patterns
      this.sensitivePatterns.forEach(pattern => {
        sanitized = sanitized.replace(pattern, (match) => {
          const parts = match.split(/[:=]/);
          if (parts.length >= 2) {
            const key = parts[0];
            const value = parts.slice(1).join(':');
            const masked = value.length > 8 ? 
              `${value.substring(0, 4)}***${value.substring(value.length - 4)}` : 
              '***';
            return `${key}=${masked}`;
          }
          return match.substring(0, 8) + '***';
        });
      });

      // Sanitize URLs
      this.urlPatterns.forEach(pattern => {
        sanitized = sanitized.replace(pattern, '$1$2=***');
      });

      return sanitized;
    }

    if (typeof input === 'object' && input !== null) {
      if (Array.isArray(input)) {
        return input.map(item => this.sanitize(item));
      }

      // Handle Error objects specially
      if (input instanceof Error) {
        return {
          name: input.name,
          message: this.sanitize(input.message),
          stack: input.stack ? this.sanitize(input.stack) : undefined
        };
      }

      const sanitized: any = {};
      for (const [key, value] of Object.entries(input)) {
        // Skip or mask sensitive keys entirely
        const lowerKey = key.toLowerCase();
        if (lowerKey.includes('key') || lowerKey.includes('token') || 
            lowerKey.includes('secret') || lowerKey.includes('password') ||
            lowerKey.includes('credential') || lowerKey.includes('auth')) {
          sanitized[key] = typeof value === 'string' && value.length > 8 ? 
            `${value.substring(0, 4)}***${value.substring(value.length - 4)}` : 
            '***';
        } else {
          sanitized[key] = this.sanitize(value);
        }
      }
      return sanitized;
    }

    return input;
  }

  /**
   * Check if logging is enabled for a category and level
   */
  private shouldLog(category: LogCategory, level: LogLevel): boolean {
    if (!this.config.enabledCategories.has(category)) {
      return false;
    }

    const categoryLevel = this.config.categoryLevels[category] ?? this.config.globalLevel;
    return level <= categoryLevel;
  }

  /**
   * Format log message
   */
  private formatMessage(level: LogLevel, category: LogCategory, message: string, data?: any): string {
    const timestamp = new Date().toISOString();
    const levelName = LogLevel[level];
    const sanitizedData = data ? this.sanitize(data) : undefined;
    
    let formatted = `[${timestamp}] [${levelName}] [${category.toUpperCase()}] ${this.sanitize(message)}`;
    
    if (sanitizedData) {
      formatted += ' ' + (typeof sanitizedData === 'object' ? 
        JSON.stringify(sanitizedData, null, 2) : 
        String(sanitizedData));
    }

    return formatted;
  }

  /**
   * Write to console with optional colorization
   */
  private writeToConsole(level: LogLevel, formatted: string): void {
    if (!this.config.console.enabled) return;

    const levelName = LogLevel[level] as keyof typeof this.colors;
    const color = this.config.console.colorize ? this.colors[levelName] : '';
    const reset = this.config.console.colorize ? this.colors.RESET : '';

    const output = `${color}${formatted}${reset}`;

    // Use appropriate console method with EPIPE protection
    try {
      switch (level) {
        case LogLevel.ERROR:
          console.error(output);
          break;
        case LogLevel.WARN:
          console.warn(output);
          break;
        default:
          console.log(output);
          break;
      }
    } catch (error: any) {
      // Handle EPIPE errors silently
      if (error && error.code === 'EPIPE') {
        // Process communication pipe is closed, ignore
        return;
      }
      // Try stderr as fallback
      try {
        process.stderr.write(`${output}\n`);
      } catch (_) {
        // Last resort, ignore completely
      }
    }
  }

  /**
   * Add log entry to buffer for file writing
   */
  private addToBuffer(level: LogLevel, category: LogCategory, message: string, data?: any): void {
    if (!this.config.fileLogging.enabled) return;

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level: LogLevel[level],
      category,
      message: this.sanitize(message),
      data: data ? this.sanitize(data) : undefined
    };

    this.logBuffer.push(entry);

    // Flush immediately for errors
    if (level === LogLevel.ERROR) {
      this.flushLogs();
    }
  }

  /**
   * Core logging method
   */
  private log(level: LogLevel, category: LogCategory, message: string, data?: any): void {
    if (!this.shouldLog(category, level)) return;

    const formatted = this.formatMessage(level, category, message, data);

    // Write to console
    this.writeToConsole(level, formatted);

    // Add to file buffer
    this.addToBuffer(level, category, message, data);
  }

  /**
   * Category-specific loggers
   */
  public readonly speech = {
    error: (message: string, data?: any) => this.log(LogLevel.ERROR, 'speech', message, data),
    warn: (message: string, data?: any) => this.log(LogLevel.WARN, 'speech', message, data),
    info: (message: string, data?: any) => this.log(LogLevel.INFO, 'speech', message, data),
    debug: (message: string, data?: any) => this.log(LogLevel.DEBUG, 'speech', message, data),
    trace: (message: string, data?: any) => this.log(LogLevel.TRACE, 'speech', message, data),
  };

  public readonly ui = {
    error: (message: string, data?: any) => this.log(LogLevel.ERROR, 'ui', message, data),
    warn: (message: string, data?: any) => this.log(LogLevel.WARN, 'ui', message, data),
    info: (message: string, data?: any) => this.log(LogLevel.INFO, 'ui', message, data),
    debug: (message: string, data?: any) => this.log(LogLevel.DEBUG, 'ui', message, data),
    trace: (message: string, data?: any) => this.log(LogLevel.TRACE, 'ui', message, data),
  };

  public readonly ipc = {
    error: (message: string, data?: any) => this.log(LogLevel.ERROR, 'ipc', message, data),
    warn: (message: string, data?: any) => this.log(LogLevel.WARN, 'ipc', message, data),
    info: (message: string, data?: any) => this.log(LogLevel.INFO, 'ipc', message, data),
    debug: (message: string, data?: any) => this.log(LogLevel.DEBUG, 'ipc', message, data),
    trace: (message: string, data?: any) => this.log(LogLevel.TRACE, 'ipc', message, data),
  };

  public readonly auth = {
    error: (message: string, data?: any) => this.log(LogLevel.ERROR, 'auth', message, data),
    warn: (message: string, data?: any) => this.log(LogLevel.WARN, 'auth', message, data),
    info: (message: string, data?: any) => this.log(LogLevel.INFO, 'auth', message, data),
    debug: (message: string, data?: any) => this.log(LogLevel.DEBUG, 'auth', message, data),
    trace: (message: string, data?: any) => this.log(LogLevel.TRACE, 'auth', message, data),
  };

  public readonly file = {
    error: (message: string, data?: any) => this.log(LogLevel.ERROR, 'file', message, data),
    warn: (message: string, data?: any) => this.log(LogLevel.WARN, 'file', message, data),
    info: (message: string, data?: any) => this.log(LogLevel.INFO, 'file', message, data),
    debug: (message: string, data?: any) => this.log(LogLevel.DEBUG, 'file', message, data),
    trace: (message: string, data?: any) => this.log(LogLevel.TRACE, 'file', message, data),
  };

  public readonly network = {
    error: (message: string, data?: any) => this.log(LogLevel.ERROR, 'network', message, data),
    warn: (message: string, data?: any) => this.log(LogLevel.WARN, 'network', message, data),
    info: (message: string, data?: any) => this.log(LogLevel.INFO, 'network', message, data),
    debug: (message: string, data?: any) => this.log(LogLevel.DEBUG, 'network', message, data),
    trace: (message: string, data?: any) => this.log(LogLevel.TRACE, 'network', message, data),
  };

  public readonly window = {
    error: (message: string, data?: any) => this.log(LogLevel.ERROR, 'window', message, data),
    warn: (message: string, data?: any) => this.log(LogLevel.WARN, 'window', message, data),
    info: (message: string, data?: any) => this.log(LogLevel.INFO, 'window', message, data),
    debug: (message: string, data?: any) => this.log(LogLevel.DEBUG, 'window', message, data),
    trace: (message: string, data?: any) => this.log(LogLevel.TRACE, 'window', message, data),
  };

  public readonly system = {
    error: (message: string, data?: any) => this.log(LogLevel.ERROR, 'system', message, data),
    warn: (message: string, data?: any) => this.log(LogLevel.WARN, 'system', message, data),
    info: (message: string, data?: any) => this.log(LogLevel.INFO, 'system', message, data),
    debug: (message: string, data?: any) => this.log(LogLevel.DEBUG, 'system', message, data),
    trace: (message: string, data?: any) => this.log(LogLevel.TRACE, 'system', message, data),
  };

  public readonly performance = {
    error: (message: string, data?: any) => this.log(LogLevel.ERROR, 'performance', message, data),
    warn: (message: string, data?: any) => this.log(LogLevel.WARN, 'performance', message, data),
    info: (message: string, data?: any) => this.log(LogLevel.INFO, 'performance', message, data),
    debug: (message: string, data?: any) => this.log(LogLevel.DEBUG, 'performance', message, data),
    trace: (message: string, data?: any) => this.log(LogLevel.TRACE, 'performance', message, data),
  };

  public readonly general = {
    error: (message: string, data?: any) => this.log(LogLevel.ERROR, 'general', message, data),
    warn: (message: string, data?: any) => this.log(LogLevel.WARN, 'general', message, data),
    info: (message: string, data?: any) => this.log(LogLevel.INFO, 'general', message, data),
    debug: (message: string, data?: any) => this.log(LogLevel.DEBUG, 'general', message, data),
    trace: (message: string, data?: any) => this.log(LogLevel.TRACE, 'general', message, data),
  };

  /**
   * Generic logging methods (backwards compatible)
   */
  error(message: string, data?: any): void {
    this.log(LogLevel.ERROR, 'general', message, data);
  }

  warn(message: string, data?: any): void {
    this.log(LogLevel.WARN, 'general', message, data);
  }

  info(message: string, data?: any): void {
    this.log(LogLevel.INFO, 'general', message, data);
  }

  debug(message: string, data?: any): void {
    this.log(LogLevel.DEBUG, 'general', message, data);
  }

  trace(message: string, data?: any): void {
    this.log(LogLevel.TRACE, 'general', message, data);
  }

  /**
   * Configuration methods
   */
  setGlobalLevel(level: LogLevel): void {
    this.config.globalLevel = level;
    this.saveConfigToStore().catch(err => console.error('Failed to save config:', err));
  }

  setCategoryLevel(category: LogCategory, level: LogLevel): void {
    this.config.categoryLevels[category] = level;
    this.saveConfigToStore().catch(err => console.error('Failed to save config:', err));
  }

  enableCategory(category: LogCategory): void {
    this.config.enabledCategories.add(category);
    this.saveConfigToStore().catch(err => console.error('Failed to save config:', err));
  }

  disableCategory(category: LogCategory): void {
    this.config.enabledCategories.delete(category);
    this.saveConfigToStore().catch(err => console.error('Failed to save config:', err));
  }

  enableFileLogging(directory?: string): void {
    if (directory) {
      this.config.fileLogging.directory = directory;
      this.ensureLogDirectory();
    }
    this.config.fileLogging.enabled = true;
    this.saveConfigToStore().catch(err => console.error('Failed to save config:', err));
  }

  disableFileLogging(): void {
    this.config.fileLogging.enabled = false;
    this.saveConfigToStore().catch(err => console.error('Failed to save config:', err));
  }

  enableConsoleLogging(): void {
    this.config.console.enabled = true;
    this.saveConfigToStore().catch(err => console.error('Failed to save config:', err));
  }

  disableConsoleLogging(): void {
    this.config.console.enabled = false;
    this.saveConfigToStore().catch(err => console.error('Failed to save config:', err));
  }

  /**
   * Performance timing utility
   */
  time(label: string): void {
    console.time(label);
  }

  timeEnd(label: string): void {
    console.timeEnd(label);
    this.performance.debug(`Timer completed: ${label}`);
  }

  /**
   * Sanitization utility for external use
   */
  sanitizeData(data: any): any {
    return this.sanitize(data);
  }

  /**
   * Load configuration from persistent store asynchronously
   */
  private async loadConfigFromStoreAsync(): Promise<void> {
    try {
      await this.storeReady;
      if (!this.store) return; // Store not available

      const saved = this.store.get('config');
      if (!saved) return; // No saved config

      const loadedConfig = {
        globalLevel: saved.globalLevel ?? LogLevel.DEBUG,
        categoryLevels: saved.categoryLevels ?? {},
        enabledCategories: new Set<LogCategory>(saved.enabledCategories ?? [
          'speech', 'ui', 'ipc', 'auth', 'file', 
          'network', 'window', 'system', 'performance', 'general'
        ]),
        fileLogging: {
          enabled: saved.fileLogging?.enabled ?? true,
          directory: saved.fileLogging?.directory ?? (app ? path.join(app.getPath('logs'), 'app-logs') : './logs'),
          maxFileSize: saved.fileLogging?.maxFileSize ?? 10 * 1024 * 1024,
          maxFiles: saved.fileLogging?.maxFiles ?? 5,
          filename: saved.fileLogging?.filename ?? 'app.log'
        },
        console: {
          enabled: saved.console?.enabled ?? true,
          colorize: saved.console?.colorize ?? (process.env.NODE_ENV !== 'production')
        }
      };

      // Update config with loaded values
      this.config = loadedConfig;
    } catch (error) {
      // If loading fails, continue with defaults
      console.error('Failed to load logging config from store:', error);
    }
  }

  /**
   * Save configuration to persistent store
   */
  private async saveConfigToStore(): Promise<void> {
    try {
      await this.storeReady;
      if (!this.store) return; // Store not available

      const configToSave = {
        globalLevel: this.config.globalLevel,
        categoryLevels: this.config.categoryLevels,
        enabledCategories: Array.from(this.config.enabledCategories),
        fileLogging: this.config.fileLogging,
        console: this.config.console
      };
      this.store.set('config', configToSave);
    } catch (error) {
      // If saving fails, log error but don't throw
      console.error('Failed to save logging config to store:', error);
    }
  }

  /**
   * Get current configuration
   */
  getConfig(): Readonly<LoggerConfig> {
    return { ...this.config };
  }

  /**
   * File logging implementation
   */
  private ensureLogDirectory(): void {
    try {
      if (!fs.existsSync(this.config.fileLogging.directory)) {
        fs.mkdirSync(this.config.fileLogging.directory, { recursive: true });
      }
    } catch (error) {
      // Fallback to console only if directory creation fails
      this.config.fileLogging.enabled = false;
    }
  }

  private setupLogFlushing(): void {
    // Flush logs every 5 seconds
    this.flushTimer = setInterval(() => {
      this.flushLogs();
    }, 5000);

    // Flush on process exit
    process.on('exit', () => {
      this.flushLogs();
    });

    process.on('SIGINT', () => {
      this.flushLogs();
      process.exit(0);
    });

    process.on('SIGTERM', () => {
      this.flushLogs();
      process.exit(0);
    });
  }

  private flushLogs(): void {
    if (!this.config.fileLogging.enabled || this.logBuffer.length === 0) {
      return;
    }

    try {
      const logFile = path.join(this.config.fileLogging.directory, this.config.fileLogging.filename);
      
      // Check if we need to rotate logs
      this.rotateLogsIfNeeded(logFile);

      // Write buffered logs
      const logLines = this.logBuffer.map(entry => {
        let line = `[${entry.timestamp}] [${entry.level}] [${entry.category.toUpperCase()}] ${entry.message}`;
        if (entry.data) {
          line += ' ' + (typeof entry.data === 'object' ? 
            JSON.stringify(entry.data) : 
            String(entry.data));
        }
        return line;
      }).join('\n') + '\n';

      fs.appendFileSync(logFile, logLines);
      
      // Clear buffer
      this.logBuffer = [];
    } catch (error) {
      // If file logging fails, disable it to prevent spam
      this.config.fileLogging.enabled = false;
    }
  }

  private rotateLogsIfNeeded(logFile: string): void {
    try {
      if (!fs.existsSync(logFile)) return;

      const stats = fs.statSync(logFile);
      if (stats.size < this.config.fileLogging.maxFileSize) return;

      // Rotate existing logs
      for (let i = this.config.fileLogging.maxFiles - 1; i >= 1; i--) {
        const oldFile = `${logFile}.${i}`;
        const newFile = `${logFile}.${i + 1}`;
        
        if (fs.existsSync(oldFile)) {
          if (i === this.config.fileLogging.maxFiles - 1) {
            fs.unlinkSync(oldFile); // Delete oldest
          } else {
            fs.renameSync(oldFile, newFile);
          }
        }
      }

      // Move current log to .1
      fs.renameSync(logFile, `${logFile}.1`);
    } catch (error) {
      // If rotation fails, continue with current file
    }
  }
}

// Export singleton instance
export const logger = new CentralizedLogger();

// Backwards compatibility exports for existing safeLog/safeError usage
export const safeLog = (...args: any[]) => {
  const message = args.map(arg => 
    typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
  ).join(' ');
  logger.general.info(message);
};

export const safeError = (...args: any[]) => {
  const message = args.map(arg => 
    typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
  ).join(' ');
  logger.general.error(message);
};

// Legacy compatibility (will be phased out)
export const sanitize = (data: any) => logger.sanitizeData(data);

// Convenient category-based logging API
export const log = {
  // Category-specific loggers
  speech: logger.speech,
  ui: logger.ui,
  ipc: logger.ipc,
  auth: logger.auth,
  file: logger.file,
  network: logger.network,
  window: logger.window,
  system: logger.system,
  performance: logger.performance,
  general: logger.general,

  // Generic methods
  error: (message: string, data?: any) => logger.error(message, data),
  warn: (message: string, data?: any) => logger.warn(message, data),
  info: (message: string, data?: any) => logger.info(message, data),
  debug: (message: string, data?: any) => logger.debug(message, data),
  trace: (message: string, data?: any) => logger.trace(message, data),

  // Configuration
  setGlobalLevel: (level: LogLevel) => logger.setGlobalLevel(level),
  setCategoryLevel: (category: LogCategory, level: LogLevel) => logger.setCategoryLevel(category, level),
  enableCategory: (category: LogCategory) => logger.enableCategory(category),
  disableCategory: (category: LogCategory) => logger.disableCategory(category),
  enableFileLogging: (directory?: string) => logger.enableFileLogging(directory),
  disableFileLogging: () => logger.disableFileLogging(),
  enableConsoleLogging: () => logger.enableConsoleLogging(),
  disableConsoleLogging: () => logger.disableConsoleLogging(),

  // Utilities
  time: (label: string) => logger.time(label),
  timeEnd: (label: string) => logger.timeEnd(label),
  sanitizeData: (data: any) => logger.sanitizeData(data),
  getConfig: () => logger.getConfig()
};