import { useState, useEffect } from "react";
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Button } from "../ui/button";
import { Settings } from "lucide-react";
import { useToast } from "../../contexts/toast";
import { GoogleSpeechService } from '../../services/googleSpeechService';

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
        .then((config: Config) => {
          const currentProvider = config.apiProvider || "openai";
          const currentKey = config.apiKey || "";
          
          // Set provider
          setApiProvider(currentProvider);
          
          // Store the key in the appropriate state variable based on provider
          if (currentProvider === "openai") {
            setOpenaiApiKey(currentKey);
          } else if (currentProvider === "gemini") {
            setGeminiApiKey(currentKey);
          } else if (currentProvider === "anthropic") {
            setAnthropicApiKey(currentKey);
          }
          
          // Set current API key
          setApiKey(currentKey);
          
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
      await window.electronAPI.saveGoogleSpeechApiKey(googleApiKey);
      
      // Use invoke with the correct channel name
      const result = await window.electronAPI.invoke('testGoogleSpeechApiKey');
      
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
      await window.electronAPI.saveGoogleSpeechApiKey(trimmedGoogleApiKey);
      await window.electronAPI.saveSpeechService(speechService);
      
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
      <DialogContent 
        className="sm:max-w-md bg-black border border-white/10 text-white settings-dialog"
        style={{
          position: 'fixed',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          width: 'min(450px, 90vw)',
          height: 'auto',
          minHeight: '400px',
          maxHeight: '90vh',
          overflowY: 'auto',
          zIndex: 9999,
          margin: 0,
          padding: '20px',
          transition: 'opacity 0.25s ease, transform 0.25s ease',
          animation: 'fadeIn 0.25s ease forwards',
          opacity: 0.98
        }}
      >        
        <DialogHeader>
          <DialogTitle>API Settings</DialogTitle>
          <DialogDescription className="text-white/70">
            Configure your API key and model preferences. You'll need your own API key to use this application.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
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
          
          <div className="space-y-2 mt-4">
            <label className="text-sm font-medium text-white mb-2 block">Keyboard Shortcuts</label>
            <div className="bg-black/30 border border-white/10 rounded-lg p-3">
              <div className="grid grid-cols-2 gap-y-2 text-xs">
                <div className="text-white/70">Toggle Visibility</div>
                <div className="text-white/90 font-mono">Ctrl+B / Cmd+B</div>
                
                <div className="text-white/70">Take Screenshot</div>
                <div className="text-white/90 font-mono">Ctrl+H / Cmd+H</div>
                
                <div className="text-white/70">Process Screenshots</div>
                <div className="text-white/90 font-mono">Ctrl+Enter / Cmd+Enter</div>
                
                <div className="text-white/70">Delete Last Screenshot</div>
                <div className="text-white/90 font-mono">Ctrl+L / Cmd+L</div>
                
                <div className="text-white/70">Reset View</div>
                <div className="text-white/90 font-mono">Ctrl+R / Cmd+R</div>
                
                <div className="text-white/70">Quit Application</div>
                <div className="text-white/90 font-mono">Ctrl+Q / Cmd+Q</div>
                
                <div className="text-white/70">Move Window</div>
                <div className="text-white/90 font-mono">Ctrl+Arrow Keys</div>
                
                <div className="text-white/70">Decrease Opacity</div>
                <div className="text-white/90 font-mono">Ctrl+[ / Cmd+[</div>
                
                <div className="text-white/70">Increase Opacity</div>
                <div className="text-white/90 font-mono">Ctrl+] / Cmd+]</div>
                
                <div className="text-white/70">Zoom Out</div>
                <div className="text-white/90 font-mono">Ctrl+- / Cmd+-</div>
                
                <div className="text-white/70">Reset Zoom</div>
                <div className="text-white/90 font-mono">Ctrl+0 / Cmd+0</div>
                
                <div className="text-white/70">Zoom In</div>
                <div className="text-white/90 font-mono">Ctrl+= / Cmd+=</div>
              </div>
            </div>
          </div>
          
          <div className="space-y-4 mt-4">
            <label className="text-sm font-medium text-white">AI Model Selection</label>
            <p className="text-xs text-white/60 -mt-3 mb-2">
              Select which models to use for each stage of the process
            </p>
            
            {modelCategories.map((category) => {
              // Get the appropriate model list based on selected provider
              const models = 
                apiProvider === "openai" ? category.openaiModels : 
                apiProvider === "gemini" ? category.geminiModels :
                category.anthropicModels;
              
              return (
                <div key={category.key} className="mb-4">
                  <label className="text-sm font-medium text-white mb-1 block">
                    {category.title}
                  </label>
                  <p className="text-xs text-white/60 mb-2">{category.description}</p>
                  
                  <div className="space-y-2">
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
                          className={`p-2 rounded-lg cursor-pointer transition-colors ${
                            currentValue === m.id
                              ? "bg-white/10 border border-white/20"
                              : "bg-black/30 border border-white/5 hover:bg-white/5"
                          }`}
                          onClick={() => setValue(m.id)}
                        >
                          <div className="flex items-center gap-2">
                            <div
                              className={`w-3 h-3 rounded-full ${
                                currentValue === m.id ? "bg-white" : "bg-white/20"
                              }`}
                            />
                            <div>
                              <p className="font-medium text-white text-xs">{m.name}</p>
                              <p className="text-xs text-white/60">{m.description}</p>
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
        <div className="space-y-4 pt-4 border-t border-white/10">
          <h3 className="text-lg font-medium text-white">Speech-to-Text Settings</h3>
          
          <div className="space-y-3">
            <div className="space-y-2">
              <label className="text-sm font-medium text-white">
                Speech Service
              </label>
              <div className="flex gap-2">
                <div
                  className={`flex-1 p-2 rounded-lg cursor-pointer transition-colors ${
                    speechService === "whisper"
                      ? "bg-white/10 border border-white/20"
                      : "bg-black/30 border border-white/5 hover:bg-white/5"
                  }`}
                  onClick={() => setSpeechService("whisper")}
                >
                  <div className="flex items-center gap-2">
                    <div
                      className={`w-3 h-3 rounded-full ${
                        speechService === "whisper" ? "bg-white" : "bg-white/20"
                      }`}
                    />
                    <div className="flex flex-col">
                      <p className="font-medium text-white text-sm">OpenAI Whisper</p>
                      <p className="text-xs text-white/60">Uses your OpenAI API key</p>
                    </div>
                  </div>
                </div>
                <div
                  className={`flex-1 p-2 rounded-lg cursor-pointer transition-colors ${
                    speechService === "google"
                      ? "bg-white/10 border border-white/20"
                      : "bg-black/30 border border-white/5 hover:bg-white/5"
                  }`}
                  onClick={() => setSpeechService("google")}
                >
                  <div className="flex items-center gap-2">
                    <div
                      className={`w-3 h-3 rounded-full ${
                        speechService === "google" ? "bg-white" : "bg-white/20"
                      }`}
                    />
                    <div className="flex flex-col">
                      <p className="font-medium text-white text-sm">Google Speech</p>
                      <p className="text-xs text-white/60">Requires separate API key</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            
            {speechService === 'google' && (
              <div>
                <label className="text-sm font-medium text-white mb-1">
                  Google Cloud Speech-to-Text API Key
                </label>
                <Input
                  type="password"
                  placeholder="Enter your Google Cloud API Key"
                  className="bg-black/50 border-white/10 text-white"
                  value={googleApiKey}
                  onChange={(e) => setGoogleApiKey(e.target.value)}
                  disabled={isLoading}
                />
                {googleApiKey && (
                  <p className="text-xs text-white/50 flex items-center mt-1">
                    <span className="bg-white/20 text-white/80 px-2 py-0.5 rounded-full text-[10px] mr-2">
                      Google Speech
                    </span>
                    {maskApiKey(googleApiKey)}
                  </p>
                )}
                
                <div className="mt-3 p-2 rounded-md bg-white/5 border border-white/10">
                  <p className="text-xs text-white/80 mb-1">Setting up Google Speech-to-Text:</p>
                  <ol className="text-xs text-white/60 ml-4 space-y-1 list-decimal">
                    <li>
                      Create a Google Cloud account if you don't have one
                      <button 
                        onClick={() => window.electronAPI.openLink('https://console.cloud.google.com/freetrial')}
                        className="text-blue-400 hover:underline ml-1"
                      >
                        Sign Up
                      </button>
                    </li>
                    <li>
                      Create a new project in Google Cloud Console
                      <button 
                        onClick={() => window.electronAPI.openLink('https://console.cloud.google.com/projectcreate')}
                        className="text-blue-400 hover:underline ml-1"
                      >
                        Create Project
                      </button>
                    </li>
                    <li>
                      Enable the Speech-to-Text API for your project
                      <button 
                        onClick={() => window.electronAPI.openLink('https://console.cloud.google.com/apis/library/speech.googleapis.com')}
                        className="text-blue-400 hover:underline ml-1"
                      >
                        Enable API
                      </button>
                    </li>
                    <li>
                      Create an API key and paste it here
                      <button 
                        onClick={() => window.electronAPI.openLink('https://console.cloud.google.com/apis/credentials')}
                        className="text-blue-400 hover:underline ml-1"
                      >
                        Create Key
                      </button>
                    </li>
                  </ol>
                  <p className="text-xs text-white/60 mt-2">
                    <span className="text-yellow-400">Important:</span> Google Cloud offers a free tier with $300 credit for new accounts. Standard Speech-to-Text usage is 
                    <a 
                      href="https://cloud.google.com/speech-to-text/pricing" 
                      className="text-blue-400 hover:underline mx-1"
                      onClick={(e) => {
                        e.preventDefault();
                        window.electronAPI.openLink('https://cloud.google.com/speech-to-text/pricing');
                      }}
                    >
                      $0.006 per 15 seconds
                    </a>
                    of audio.
                  </p>
                </div>
                
                <div className="flex justify-end items-center mt-2">
                  <button
                    onClick={() => window.electronAPI.openLink('https://cloud.google.com/speech-to-text/docs/quickstart')}
                    className="text-blue-400 hover:underline text-xs"
                  >
                    View Documentation
                  </button>
                </div>
              </div>
            )}
          </div>
          
          {/* Speech section buttons */}
          <div className="flex justify-end space-x-2 mt-4">
            {/* Test Google API Key button */}
            {speechService === 'google' && googleApiKey && (
              <Button
                onClick={testGoogleSpeechApiKey}
                className="px-4 py-2 bg-white/10 text-white hover:bg-white/20 border border-white/10 rounded-xl font-medium"
                disabled={isTestingGoogleKey || !googleApiKey}
              >
                {isTestingGoogleKey ? "Testing..." : "Test Google API Key"}
              </Button>
            )}
            
            {/* Save Speech Settings button */}
            <Button
              onClick={handleSaveSpeechSettings}
              className="px-4 py-2 bg-white/10 text-white hover:bg-white/20 border border-white/10 rounded-xl font-medium"
              disabled={isLoading}
            >
              Save Speech Settings
            </Button>
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
      </DialogContent>
    </Dialog>
  );
}
