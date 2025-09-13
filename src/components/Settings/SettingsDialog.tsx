import React, { useState, useEffect } from "react";
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "../ui/dialog";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { cn } from "../../lib/utils";
import { Input } from "../ui/input";
import { Button } from "../ui/button";
import { Settings } from "lucide-react";
import { useToast } from "../../contexts/toast";
import { GoogleSpeechService } from '../../services/googleSpeechService';
import { GoogleSpeechSettings } from "../../components/GoogleSpeechSettings";
import MultiMonitorSettings from "./MultiMonitorSettings";

// Custom dialog content without overlay
const DialogContentNoOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, ...props }, ref) => (
  <DialogPrimitive.Portal>
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        "fixed z-[600] top-[50%] left-[50%] -translate-x-1/2 -translate-y-1/2",
        "w-[90vw] max-w-md md:w-full",
        "bg-white p-4 rounded-lg shadow-lg",
        "focus:outline-none focus-visible:ring-0",
        className
      )}
      style={{ maxHeight: '90vh', overflow: 'auto' }}
      {...props}
    >
      {children}
    </DialogPrimitive.Content>
  </DialogPrimitive.Portal>
));
DialogContentNoOverlay.displayName = "DialogContentNoOverlay";

type APIProvider = "openai" | "gemini" | "anthropic";

type AIModel = {
  id: string;
  name: string;
  description: string;
};

type ModelCategory = {
  key: 'extractionModel' | 'solutionModel' | 'debuggingModel';
  title: string;
  description: string;
  openaiModels: AIModel[];
  geminiModels: AIModel[];
  anthropicModels: AIModel[];
};

// Define available models for each category
const modelCategories: ModelCategory[] = [
  {
    key: 'extractionModel',
    title: 'Problem Extraction',
    description: 'Model used to analyze screenshots and extract problem details',
    openaiModels: [
      {
        id: "gpt-4o",
        name: "gpt-4o",
        description: "Best overall performance for problem extraction"
      },
      {
        id: "gpt-4o-mini",
        name: "gpt-4o-mini",
        description: "Faster, more cost-effective option"
      }
    ],
    geminiModels: [
      {
        id: "gemini-1.5-pro",
        name: "Gemini 1.5 Pro",
        description: "Best overall performance for problem extraction"
      },
      {
        id: "gemini-2.0-flash",
        name: "Gemini 2.0 Flash",
        description: "Faster, more cost-effective option"
      }
    ],
    anthropicModels: [
      {
        id: "claude-3-7-sonnet-20250219",
        name: "Claude 3.7 Sonnet",
        description: "Best overall performance for problem extraction"
      },
      {
        id: "claude-3-5-sonnet-20241022",
        name: "Claude 3.5 Sonnet",
        description: "Balanced performance and speed"
      },
      {
        id: "claude-3-opus-20240229",
        name: "Claude 3 Opus",
        description: "Top-level intelligence, fluency, and understanding"
      }
    ]
  },
  {
    key: 'solutionModel',
    title: 'Solution Generation',
    description: 'Model used to generate coding solutions',
    openaiModels: [
      {
        id: "gpt-4o",
        name: "gpt-4o",
        description: "Strong overall performance for coding tasks"
      },
      {
        id: "gpt-4o-mini",
        name: "gpt-4o-mini",
        description: "Faster, more cost-effective option"
      }
    ],
    geminiModels: [
      {
        id: "gemini-1.5-pro",
        name: "Gemini 1.5 Pro",
        description: "Strong overall performance for coding tasks"
      },
      {
        id: "gemini-2.0-flash",
        name: "Gemini 2.0 Flash",
        description: "Faster, more cost-effective option"
      }
    ],
    anthropicModels: [
      {
        id: "claude-3-7-sonnet-20250219",
        name: "Claude 3.7 Sonnet",
        description: "Strong overall performance for coding tasks"
      },
      {
        id: "claude-3-5-sonnet-20241022",
        name: "Claude 3.5 Sonnet",
        description: "Balanced performance and speed"
      },
      {
        id: "claude-3-opus-20240229",
        name: "Claude 3 Opus",
        description: "Top-level intelligence, fluency, and understanding"
      }
    ]
  },
  {
    key: 'debuggingModel',
    title: 'Debugging',
    description: 'Model used to debug and improve solutions',
    openaiModels: [
      {
        id: "gpt-4o",
        name: "gpt-4o",
        description: "Best for analyzing code and error messages"
      },
      {
        id: "gpt-4o-mini",
        name: "gpt-4o-mini",
        description: "Faster, more cost-effective option"
      }
    ],
    geminiModels: [
      {
        id: "gemini-1.5-pro",
        name: "Gemini 1.5 Pro",
        description: "Best for analyzing code and error messages"
      },
      {
        id: "gemini-2.0-flash",
        name: "Gemini 2.0 Flash",
        description: "Faster, more cost-effective option"
      }
    ],
    anthropicModels: [
      {
        id: "claude-3-7-sonnet-20250219",
        name: "Claude 3.7 Sonnet",
        description: "Best for analyzing code and error messages"
      },
      {
        id: "claude-3-5-sonnet-20241022",
        name: "Claude 3.5 Sonnet",
        description: "Balanced performance and speed"
      },
      {
        id: "claude-3-opus-20240229",
        name: "Claude 3 Opus",
        description: "Top-level intelligence, fluency, and understanding"
      }
    ]
  }
];

interface SettingsDialogProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function SettingsDialog({ open: externalOpen, onOpenChange }: SettingsDialogProps) {
  const [open, setOpen] = useState(externalOpen || false);
  const [apiKey, setApiKey] = useState("");
  const [apiProvider, setApiProvider] = useState<APIProvider>("openai");
  
  // Track separate API keys for each provider
  const [openaiApiKey, setOpenaiApiKey] = useState("");
  const [geminiApiKey, setGeminiApiKey] = useState("");
  const [anthropicApiKey, setAnthropicApiKey] = useState("");
  
  const [extractionModel, setExtractionModel] = useState("gpt-4o");
  const [solutionModel, setSolutionModel] = useState("gpt-4o");
  const [debuggingModel, setDebuggingModel] = useState("gpt-4o");
  const [isLoading, setIsLoading] = useState(false);
  const { showToast } = useToast();
  const [googleApiKey, setGoogleApiKey] = useState('');
  const [speechService, setSpeechService] = useState('whisper');
  const [isTestingGoogleKey, setIsTestingGoogleKey] = useState(false);

  // Sync with external open state
  useEffect(() => {
    if (externalOpen !== undefined) {
      setOpen(externalOpen);
    }
  }, [externalOpen]);

  // Handle open state changes
  const handleOpenChange = (newOpen: boolean) => {
    setOpen(newOpen);
    // Only call onOpenChange when there's actually a change
    if (onOpenChange && newOpen !== externalOpen) {
      onOpenChange(newOpen);
    }
  };
  
  // Load current config on dialog open
  useEffect(() => {
    if (open) {
      setIsLoading(true);
      interface Config {
        apiKey?: string;
        apiProvider?: APIProvider;
        extractionModel?: string;
        solutionModel?: string;
        debuggingModel?: string;
      }

      // Load main API config
      window.electronAPI
        .getConfig()
        .then(async (config: Config) => {
          const currentProvider = config.apiProvider || "openai";
          const currentKey = config.apiKey || "";
          
          // Set provider
          setApiProvider(currentProvider);
          
          // Load provider-specific API keys
          try {
            const [openaiKey, geminiKey, anthropicKey] = await Promise.all([
              window.electronAPI.getOpenAIApiKey(),
              window.electronAPI.getGeminiApiKey(),
              window.electronAPI.getAnthropicApiKey()
            ]);
            
            setOpenaiApiKey(openaiKey || "");
            setGeminiApiKey(geminiKey || "");
            setAnthropicApiKey(anthropicKey || "");
            
            // Set current API key based on provider
            if (currentProvider === "openai") {
              setApiKey(openaiKey || currentKey);
            } else if (currentProvider === "gemini") {
              setApiKey(geminiKey || currentKey);
            } else if (currentProvider === "anthropic") {
              setApiKey(anthropicKey || currentKey);
            }
          } catch (error) {
            console.error("Failed to load provider-specific API keys:", error);
            // Fallback to the old method
            setApiKey(currentKey);
            if (currentProvider === "openai") {
              setOpenaiApiKey(currentKey);
            } else if (currentProvider === "gemini") {
              setGeminiApiKey(currentKey);
            } else if (currentProvider === "anthropic") {
              setAnthropicApiKey(currentKey);
            }
          }
          
          // Set models
          setExtractionModel(config.extractionModel || "gpt-4o");
          setSolutionModel(config.solutionModel || "gpt-4o");
          setDebuggingModel(config.debuggingModel || "gpt-4o");
        })
        .catch((error: unknown) => {
          console.error("Failed to load config:", error);
          showToast("Error", "Failed to load settings", "error");
        })
        .finally(() => {
          setIsLoading(false);
        });
        
      // Load speech service config
      loadSpeechSettings();
    }
  }, [open, showToast]);

  // Handle API provider change
  const handleProviderChange = (provider: APIProvider) => {
    setApiProvider(provider);
    
    // Update current API key based on the selected provider
    if (provider === "openai") {
      setApiKey(openaiApiKey);
      setExtractionModel("gpt-4o");
      setSolutionModel("gpt-4o");
      setDebuggingModel("gpt-4o");
    } else if (provider === "gemini") {
      setApiKey(geminiApiKey);
      setExtractionModel("gemini-1.5-pro");
      setSolutionModel("gemini-1.5-pro");
      setDebuggingModel("gemini-1.5-pro");
    } else if (provider === "anthropic") {
      setApiKey(anthropicApiKey);
      setExtractionModel("claude-3-7-sonnet-20250219");
      setSolutionModel("claude-3-7-sonnet-20250219");
      setDebuggingModel("claude-3-7-sonnet-20250219");
    }
  };

  // Handle API key change
  const handleApiKeyChange = (newKey: string) => {
    setApiKey(newKey);
    
    // Update the provider-specific key state
    if (apiProvider === "openai") {
      setOpenaiApiKey(newKey);
    } else if (apiProvider === "gemini") {
      setGeminiApiKey(newKey);
    } else if (apiProvider === "anthropic") {
      setAnthropicApiKey(newKey);
    }
  };

  const handleSave = async () => {
    setIsLoading(true);
    try {
      const result = await window.electronAPI.updateConfig({
        apiKey,
        apiProvider,
        // Save all provider-specific API keys
        openaiApiKey,
        geminiApiKey,
        anthropicApiKey,
        extractionModel,
        solutionModel,
        debuggingModel,
      });
      
      if (result) {
        showToast("Success", "Settings saved successfully", "success");
        handleOpenChange(false);
        
        // Force reload the app to apply the API key
        setTimeout(() => {
          window.location.reload();
        }, 1500);
      }
    } catch (error) {
      console.error("Failed to save settings:", error);
      showToast("Error", "Failed to save settings", "error");
    } finally {
      setIsLoading(false);
    }
  };

  // Mask API key for display
  const maskApiKey = (key: string) => {
    if (!key || key.length < 10) return "";
    return `${key.substring(0, 4)}...${key.substring(key.length - 4)}`;
  };

  // Open external link handler
  const openExternalLink = (url: string) => {
    window.electronAPI.openLink(url);
  };

  // Test Google Speech API key
  const testGoogleSpeechApiKey = async () => {
    try {
      setIsTestingGoogleKey(true);
      // First save the key to ensure we're testing the current input value
      await window.electronAPI.setGoogleSpeechApiKey(googleApiKey);
      
      // Use the proper method
      const result = await window.electronAPI.testGoogleSpeechApiKey();
      
      if (result && result.valid) {
        showToast("Success", "Google Speech API key is valid", "success");
      } else {
        const errorMessage = result?.error || "Google Speech API key is invalid";
        showToast("Error", errorMessage, "error");
      }
    } catch (error) {
      console.error("Error testing Google Speech API key:", error);
      showToast("Error", "Failed to test Google Speech API key", "error");
    } finally {
      setIsTestingGoogleKey(false);
    }
  };

  
  // Load speech service settings
  const loadSpeechSettings = async () => {
      try {
      const googleApiKey = await window.electronAPI.getGoogleSpeechApiKey();
      const speechService = await window.electronAPI.getSpeechService();
        
      setGoogleApiKey(googleApiKey || '');
      setSpeechService(speechService || 'whisper');
      } catch (error) {
      console.error("Failed to load speech settings:", error);
    }
  };

  // Save speech service settings
  const handleSaveSpeechSettings = async () => {
    try {
      // Trim the API key to remove any accidental whitespace
      const trimmedGoogleApiKey = googleApiKey.trim();
      
      console.log(`Saving speech service: ${speechService}`);
      console.log(`Saving Google Speech API key: ${trimmedGoogleApiKey ? 'Yes (length: ' + trimmedGoogleApiKey.length + ')' : 'No'}`);
      
      // If user selected Google Speech but provided no API key, show warning
      if (speechService === 'google' && !trimmedGoogleApiKey) {
        showToast('Warning', 'You selected Google Speech but provided no API key. Speech-to-text will not work.', 'error');
        // Still save the selection though
      }
      
      // Additional validation for Google API key format if provided
      if (speechService === 'google' && trimmedGoogleApiKey) {
        if (trimmedGoogleApiKey.length < 20) {
          showToast('Warning', 'Google API key appears too short. Please verify your key.', 'error');
          return;
        }
        
        if (!trimmedGoogleApiKey.match(/^[A-Za-z0-9_-]+$/)) {
          showToast('Warning', 'Google API key contains invalid characters. Please verify your key.', 'error');
          return;
        }
      }
      
      // Save settings
      await window.electronAPI.setGoogleSpeechApiKey(trimmedGoogleApiKey);
      await window.electronAPI.setSpeechService(speechService);
      
      showToast('Success', 'Speech settings saved', 'success');
      
      // Give feedback about next steps
      if (speechService === 'google' && trimmedGoogleApiKey) {
        showToast('Note', 'Please ensure the Speech-to-Text API is enabled in your Google Cloud project', 'neutral');
      } else if (speechService === 'whisper') {
        // Remind users that Whisper requires an OpenAI API key
        const openAIKey = apiProvider === 'openai' ? apiKey : openaiApiKey;
        if (!openAIKey) {
          showToast('Warning', 'Whisper requires an OpenAI API key to be configured', 'error');
        }
      }
    } catch (error) {
      console.error('Failed to save speech settings:', error);
      showToast('Error', 'Failed to save speech settings', 'error');
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContentNoOverlay 
        className="sm:max-w-md bg-black border border-white/10 text-white settings-dialog custom-scrollbar"
        style={{
          position: 'fixed',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          width: 'min(480px, 95vw)',
          height: 'auto',
          minHeight: '400px',
          maxHeight: '85vh',
          overflowY: 'auto',
          zIndex: 9999,
          margin: 0,
          padding: '24px',
          transition: 'opacity 0.25s ease, transform 0.25s ease',
          animation: 'fadeIn 0.25s ease forwards',
          opacity: 0.98,
          scrollbarWidth: 'none', /* Firefox */
          msOverflowStyle: 'none' /* IE/Edge */
        }}
      >        
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription className="text-white/70">
            Configure API keys, model preferences, and speech settings for Interview Coder.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-3">
          {/* API Provider Selection */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-white">API Provider</label>
            <div className="flex gap-2">
              <div
                className={`flex-1 p-2 rounded-lg cursor-pointer transition-colors ${
                  apiProvider === "openai"
                    ? "bg-white/10 border border-white/20"
                    : "bg-black/30 border border-white/5 hover:bg-white/5"
                }`}
                onClick={() => handleProviderChange("openai")}
              >
                <div className="flex items-center gap-2">
                  <div
                    className={`w-3 h-3 rounded-full ${
                      apiProvider === "openai" ? "bg-white" : "bg-white/20"
                    }`}
                  />
                  <div className="flex flex-col">
                    <p className="font-medium text-white text-sm">OpenAI</p>
                    <p className="text-xs text-white/60">GPT-4o models</p>
                  </div>
                </div>
              </div>
              <div
                className={`flex-1 p-2 rounded-lg cursor-pointer transition-colors ${
                  apiProvider === "gemini"
                    ? "bg-white/10 border border-white/20"
                    : "bg-black/30 border border-white/5 hover:bg-white/5"
                }`}
                onClick={() => handleProviderChange("gemini")}
              >
                <div className="flex items-center gap-2">
                  <div
                    className={`w-3 h-3 rounded-full ${
                      apiProvider === "gemini" ? "bg-white" : "bg-white/20"
                    }`}
                  />
                  <div className="flex flex-col">
                    <p className="font-medium text-white text-sm">Gemini</p>
                    <p className="text-xs text-white/60">Gemini 1.5 models</p>
                  </div>
                </div>
              </div>
              <div
                className={`flex-1 p-2 rounded-lg cursor-pointer transition-colors ${
                  apiProvider === "anthropic"
                    ? "bg-white/10 border border-white/20"
                    : "bg-black/30 border border-white/5 hover:bg-white/5"
                }`}
                onClick={() => handleProviderChange("anthropic")}
              >
                <div className="flex items-center gap-2">
                  <div
                    className={`w-3 h-3 rounded-full ${
                      apiProvider === "anthropic" ? "bg-white" : "bg-white/20"
                    }`}
                  />
                  <div className="flex flex-col">
                    <p className="font-medium text-white text-sm">Claude</p>
                    <p className="text-xs text-white/60">Claude 3 models</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
          
          <div className="space-y-2">
            <label className="text-sm font-medium text-white" htmlFor="apiKey">
            {apiProvider === "openai" ? "OpenAI API Key" : 
             apiProvider === "gemini" ? "Gemini API Key" : 
             "Anthropic API Key"}
            </label>
            <Input
              id="apiKey"
              type="password"
              value={apiKey}
              onChange={(e) => handleApiKeyChange(e.target.value)}
              placeholder={
                apiProvider === "openai" ? "sk-..." : 
                apiProvider === "gemini" ? "Enter your Gemini API key" :
                "sk-ant-..."
              }
              className="bg-black/50 border-white/10 text-white"
            />
            {/* Display appropriate label and masked key for each provider */}
            {apiProvider === "openai" && openaiApiKey && (
              <p className="text-xs text-white/50 flex items-center">
                <span className="bg-white/20 text-white/80 px-2 py-0.5 rounded-full text-[10px] mr-2">
                  OpenAI
                </span>
                {maskApiKey(openaiApiKey)}
              </p>
            )}
            {apiProvider === "gemini" && geminiApiKey && (
              <p className="text-xs text-white/50 flex items-center">
                <span className="bg-white/20 text-white/80 px-2 py-0.5 rounded-full text-[10px] mr-2">
                  Gemini
                </span>
                {maskApiKey(geminiApiKey)}
              </p>
            )}
            {apiProvider === "anthropic" && anthropicApiKey && (
              <p className="text-xs text-white/50 flex items-center">
                <span className="bg-white/20 text-white/80 px-2 py-0.5 rounded-full text-[10px] mr-2">
                  Claude
                </span>
                {maskApiKey(anthropicApiKey)}
              </p>
            )}
            <p className="text-xs text-white/50">
              Your API key is stored locally and never sent to any server except {apiProvider === "openai" ? "OpenAI" : 
              apiProvider === "gemini" ? "Google" : 
              "Anthropic"}
            </p>
            <div className="mt-2 p-2 rounded-md bg-white/5 border border-white/10">
              <p className="text-xs text-white/80 mb-1">Don't have an API key?</p>
              {apiProvider === "openai" ? (
                <>
                  <p className="text-xs text-white/60 mb-1">1. Create an account at <button 
                    onClick={() => openExternalLink('https://platform.openai.com/signup')} 
                    className="text-blue-400 hover:underline cursor-pointer">OpenAI</button>
                  </p>
                  <p className="text-xs text-white/60 mb-1">2. Go to <button 
                    onClick={() => openExternalLink('https://platform.openai.com/api-keys')} 
                    className="text-blue-400 hover:underline cursor-pointer">API Keys</button> section
                  </p>
                  <p className="text-xs text-white/60">3. Create a new secret key and paste it here</p>
                </>
              ) : apiProvider === "gemini" ?  (
                <>
                  <p className="text-xs text-white/60 mb-1">1. Create an account at <button 
                    onClick={() => openExternalLink('https://aistudio.google.com/')} 
                    className="text-blue-400 hover:underline cursor-pointer">Google AI Studio</button>
                  </p>
                  <p className="text-xs text-white/60 mb-1">2. Go to the <button 
                    onClick={() => openExternalLink('https://aistudio.google.com/app/apikey')} 
                    className="text-blue-400 hover:underline cursor-pointer">API Keys</button> section
                  </p>
                  <p className="text-xs text-white/60">3. Create a new API key and paste it here</p>
                </>
              ) : (
                <>
                  <p className="text-xs text-white/60 mb-1">1. Create an account at <button 
                    onClick={() => openExternalLink('https://console.anthropic.com/signup')} 
                    className="text-blue-400 hover:underline cursor-pointer">Anthropic</button>
                  </p>
                  <p className="text-xs text-white/60 mb-1">2. Go to the <button 
                    onClick={() => openExternalLink('https://console.anthropic.com/settings/keys')} 
                    className="text-blue-400 hover:underline cursor-pointer">API Keys</button> section
                  </p>
                  <p className="text-xs text-white/60">3. Create a new API key and paste it here</p>
                </>
              )}
            </div>
          </div>
          
          <div className="space-y-2">
            <label className="text-sm font-medium text-white">Keyboard Shortcuts</label>
            <div className="bg-black/30 border border-white/10 rounded-lg p-2">
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                <div className="text-white/70">Toggle Visibility</div>
                <div className="text-white/90 font-mono text-right">⌘B</div>
                
                <div className="text-white/70">Take Screenshot</div>
                <div className="text-white/90 font-mono text-right">⌘H</div>
                
                <div className="text-white/70">Process Screenshots</div>
                <div className="text-white/90 font-mono text-right">⌘⏎</div>
                
                <div className="text-white/70">Delete Last</div>
                <div className="text-white/90 font-mono text-right">⌘L</div>
                
                <div className="text-white/70">Reset View</div>
                <div className="text-white/90 font-mono text-right">⌘R</div>
                
                <div className="text-white/70">Quit App</div>
                <div className="text-white/90 font-mono text-right">⌘Q</div>
              </div>
            </div>
          </div>

          
          <div className="space-y-3">
            <label className="text-sm font-medium text-white">AI Model Selection</label>
            <p className="text-xs text-white/60 -mt-2 mb-1">
              Select models for each processing stage
            </p>
            
            {modelCategories.map((category) => {
              // Get the appropriate model list based on selected provider
              const models = 
                apiProvider === "openai" ? category.openaiModels : 
                apiProvider === "gemini" ? category.geminiModels :
                category.anthropicModels;
              
              return (
                <div key={category.key} className="mb-2">
                  <label className="text-xs font-medium text-white mb-1 block">
                    {category.title}
                  </label>
                  <p className="text-xs text-white/50 mb-1">{category.description}</p>
                  
                  <div className="space-y-1">
                    {models.map((m) => {
                      // Determine which state to use based on category key
                      const currentValue = 
                        category.key === 'extractionModel' ? extractionModel :
                        category.key === 'solutionModel' ? solutionModel :
                        debuggingModel;
                      
                      // Determine which setter function to use
                      const setValue = 
                        category.key === 'extractionModel' ? setExtractionModel :
                        category.key === 'solutionModel' ? setSolutionModel :
                        setDebuggingModel;
                        
                      return (
                        <div
                          key={m.id}
                          className={`p-1.5 rounded-lg cursor-pointer transition-colors ${
                            currentValue === m.id
                              ? "bg-white/10 border border-white/20"
                              : "bg-black/30 border border-white/5 hover:bg-white/5"
                          }`}
                          onClick={() => setValue(m.id)}
                        >
                          <div className="flex items-center gap-2">
                            <div
                              className={`w-2 h-2 rounded-full ${
                                currentValue === m.id ? "bg-white" : "bg-white/20"
                              }`}
                            />
                            <div className="flex-1">
                              <p className="font-medium text-white text-xs">{m.name}</p>
                              <p className="text-xs text-white/50 leading-tight">{m.description}</p>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        <div className="space-y-3 pt-3 border-t border-white/10">
          <h3 className="text-sm font-medium text-white">Speech-to-Text Settings</h3>
          
          <div className="space-y-2">
            <div className="space-y-2">
              <label className="text-xs font-medium text-white">
                Speech Service
              </label>
              <div className="flex gap-2">
                <div
                  className={`flex-1 p-1.5 rounded-lg cursor-pointer transition-colors ${
                    speechService === "whisper"
                      ? "bg-white/10 border border-white/20"
                      : "bg-black/30 border border-white/5 hover:bg-white/5"
                  }`}
                  onClick={() => setSpeechService("whisper")}
                >
                  <div className="flex items-center gap-2">
                    <div
                      className={`w-2 h-2 rounded-full ${
                        speechService === "whisper" ? "bg-white" : "bg-white/20"
                      }`}
                    />
                    <div className="flex flex-col">
                      <p className="font-medium text-white text-xs">OpenAI Whisper</p>
                      <p className="text-xs text-white/50">Uses OpenAI key</p>
                    </div>
                  </div>
                </div>
                <div
                  className={`flex-1 p-1.5 rounded-lg cursor-pointer transition-colors ${
                    speechService === "google"
                      ? "bg-white/10 border border-white/20"
                      : "bg-black/30 border border-white/5 hover:bg-white/5"
                  }`}
                  onClick={() => setSpeechService("google")}
                >
                  <div className="flex items-center gap-2">
                    <div
                      className={`w-2 h-2 rounded-full ${
                        speechService === "google" ? "bg-white" : "bg-white/20"
                      }`}
                    />
                    <div className="flex flex-col">
                      <p className="font-medium text-white text-xs">Google Speech</p>
                      <p className="text-xs text-white/50">Separate API key</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            
            {speechService === 'google' && (
              <div>
                <GoogleSpeechSettings 
                  onSettingsChanged={() => {
                    // Refresh settings after change
                    loadSpeechSettings();
                    showToast("Settings updated", "Speech settings have been updated", "success");
                  }}
                />
              </div>
            )}
          </div>
          
          {/* Speech section buttons */}
          <div className="flex justify-end space-x-2 mt-2">
            {/* Test Google API Key button */}
            {speechService === 'google' && googleApiKey && (
              <Button
                onClick={testGoogleSpeechApiKey}
                className="px-3 py-1 bg-white/10 text-white hover:bg-white/20 border border-white/10 rounded-lg font-medium text-xs"
                disabled={isTestingGoogleKey || !googleApiKey}
              >
                {isTestingGoogleKey ? "Testing..." : "Test Key"}
              </Button>
            )}
            
            {/* Save Speech Settings button */}
            <Button
              onClick={handleSaveSpeechSettings}
              className="px-3 py-1 bg-white/10 text-white hover:bg-white/20 border border-white/10 rounded-lg font-medium text-xs"
              disabled={isLoading}
            >
              Save Speech
            </Button>
          </div>
        </div>

        {/* Multi-Monitor Settings Section */}
        <div className="space-y-3 py-3 border-t border-white/10">
          <div className="flex items-center gap-2">
            <Settings className="w-4 h-4 text-white" />
            <label className="text-sm font-medium text-white">Multi-Monitor Support</label>
          </div>
          <div className="bg-black/30 rounded-lg p-3">
            <MultiMonitorSettings className="text-white" />
          </div>
        </div>

        <DialogFooter className="flex justify-between sm:justify-between">
          <Button
            onClick={() => handleOpenChange(false)}
            className="px-4 py-2 bg-white/10 text-white hover:bg-white/20 border border-white/10 rounded-xl font-medium"
          >
            Cancel
          </Button>
          <Button
            className="px-4 py-2 bg-white text-black rounded-xl font-medium hover:bg-white/90 transition-colors"
            onClick={handleSave}
            disabled={isLoading || !apiKey}
          >
            {isLoading ? "Saving..." : "Save Settings"}
          </Button>
        </DialogFooter>
      </DialogContentNoOverlay>
    </Dialog>
  );
}
