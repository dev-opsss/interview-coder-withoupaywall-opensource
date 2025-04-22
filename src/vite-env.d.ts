/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string

  readonly VITE_SUPABASE_ANON_KEY: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

// Add global type declarations here if needed
declare global {
    interface Window {
      // Add any custom global properties you might attach to the window object
      electronAPI: any; // Assuming electronAPI is exposed via preload
      __CREDITS__: number;
      __LANGUAGE__: string;
      __IS_INITIALIZED__: boolean;
    }
  }
  
  // Export an empty object to make this a module file
  export {};
