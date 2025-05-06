import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';

interface LogEntry {
  speaker: 'user' | 'interviewer';
  text: string;
  timestamp: number;
  isFinal: boolean;
}

export class TranscriptLogger {
  private logFilePath: string | null = null;
  private writeStream: fs.WriteStream | null = null;

  constructor() {
    console.log('TranscriptLogger initialized.');
  }

  /**
   * Starts logging transcript entries to a specified file.
   * Creates the directory if it doesn't exist.
   * @param filePath The absolute path to the log file.
   */
  public startLogging(filePath: string): void {
    if (this.writeStream) {
      console.warn('Logging is already active. Stopping existing log first.');
      this.stopLogging();
    }

    this.logFilePath = filePath;
    console.log(`Starting transcript logging to: ${this.logFilePath}`);

    try {
      // Ensure directory exists
      const logDir = path.dirname(this.logFilePath);
      if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
        console.log(`Created log directory: ${logDir}`);
      }

      // Create write stream
      this.writeStream = fs.createWriteStream(this.logFilePath, { flags: 'a' }); // 'a' for append

      this.writeStream.on('open', () => {
        console.log(`Log file opened successfully: ${this.logFilePath}`);
        // Optionally write a header or start marker
        this.writeStream?.write(`--- Log Start: ${new Date().toISOString()} ---\n`);
      });

      this.writeStream.on('error', (error) => {
        console.error(`Error writing to log file ${this.logFilePath}:`, error);
        this.stopLogging(); // Stop logging on error
      });

    } catch (error) {
      console.error(`Failed to start logging to ${this.logFilePath}:`, error);
      this.logFilePath = null;
      this.writeStream = null;
    }
  }

  /**
   * Logs a single transcript entry to the file.
   * Only logs final entries by default.
   * @param entry The transcript entry object.
   */
  public logEntry(entry: LogEntry): void {
    if (!this.writeStream || !entry.isFinal) {
      // Only log final entries, and only if the stream is active
      if (!this.writeStream) {
         // console.warn('Attempted to log entry, but writeStream is not active.');
      }
      return;
    }

    // Format the log entry (e.g., JSON or simple text)
    const timestampStr = new Date(entry.timestamp).toISOString();
    // Basic text format: [TIMESTAMP] SPEAKER: TEXT
    const logLine = `[${timestampStr}] ${entry.speaker.toUpperCase()}: ${entry.text}\n`; 
    // Alternative JSON format:
    // const logLine = JSON.stringify(entry) + '\n';

    try {
      this.writeStream.write(logLine);
    } catch (error) {
      console.error(`Error writing log entry to ${this.logFilePath}:`, error);
      // Consider stopping logging or implementing retry logic
    } 
  }

  /**
   * Stops logging and closes the file stream.
   */
  public stopLogging(): void {
    if (!this.writeStream) {
      // console.log('No active log stream to stop.');
      return;
    }

    console.log(`Stopping transcript logging for: ${this.logFilePath}`);
    try {
       this.writeStream.end(() => {
          console.log(`Log file closed: ${this.logFilePath}`);
          this.writeStream = null;
          this.logFilePath = null;
       });
    } catch (error) {
       console.error(`Error closing log file ${this.logFilePath}:`, error);
       // Force set to null even if closing failed
       this.writeStream = null;
       this.logFilePath = null;
    }
  }

  /**
   * Generates a default log file path based on timestamp.
   * Example: /Users/user/Library/Logs/YourAppName/transcript_2023-10-27T10_30_00.log
   * @returns A default log file path.
   */
  public getDefaultLogPath(): string {
    const appName = app.getName(); // Get the app name
    const logsPath = app.getPath('logs'); // Get the standard logs directory
    const timestamp = new Date().toISOString().replace(/[:.]/g, '_'); // Filesystem-safe timestamp
    const fileName = `transcript_${timestamp}.log`;
    return path.join(logsPath, appName, fileName);
  }
} 