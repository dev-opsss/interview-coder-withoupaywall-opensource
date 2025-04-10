// ipcHandlers.ts

import { ipcMain, shell, dialog } from "electron"
import { randomBytes } from "crypto"
import { IIpcHandlerDeps } from "./main"
import { configHelper } from "./ConfigHelper"

export function initializeIpcHandlers(deps: IIpcHandlerDeps): void {
  console.log("Initializing IPC handlers")

  // Configuration handlers
  // Use a try-catch block to handle the case where the handler is already registered
  try {
    ipcMain.handle('get-config', async () => {
      return configHelper.loadConfig();
    })
  } catch (error) {
    console.log('Handler for get-config already registered, skipping')
  }

  try {
    ipcMain.handle("update-config", (_event, updates) => {
      return configHelper.updateConfig(updates);
    })
  } catch (error) {
    console.log('Handler for update-config already registered, skipping')
  }

  // Rest of your handlers with similar try-catch blocks
  // ...
}
