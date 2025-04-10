import { contextBridge, ipcRenderer } from 'electron';

// Expose voice-related IPC functions to the renderer process
contextBridge.exposeInMainWorld('voiceAPI', {
  invoke: (channel: string, ...args: any[]) => {
    const validChannels = ['start-recording', 'stop-recording', 'transcribe-audio'];
    if (validChannels.includes(channel)) {
      return ipcRenderer.invoke(channel, ...args);
    }
    throw new Error(`Unauthorized IPC channel: ${channel}`);
  },
  on: (channel: string, callback: (...args: any[]) => void) => {
    const validChannels = ['recording-status', 'transcription-result'];
    if (validChannels.includes(channel)) {
      const subscription = (_event: any, ...args: any[]) => callback(...args);
      ipcRenderer.on(channel, subscription);
      return () => {
        ipcRenderer.removeListener(channel, subscription);
      };
    }
    throw new Error(`Unauthorized IPC channel: ${channel}`);
  },
  removeAllListeners: (channel: string) => {
    const validChannels = ['recording-status', 'transcription-result'];
    if (validChannels.includes(channel)) {
      ipcRenderer.removeAllListeners(channel);
    }
  }
});