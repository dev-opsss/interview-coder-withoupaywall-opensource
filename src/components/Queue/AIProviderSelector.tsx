import React, { useState, useRef, useEffect } from "react";

type AIProviderSelectorProps = {
  currentProvider: 'openai' | 'gemini' | 'anthropic';
  onProviderChange: (provider: 'openai' | 'gemini' | 'anthropic') => void;
  isConnected?: boolean;
};

const AIProviderSelector: React.FC<AIProviderSelectorProps> = ({ 
  currentProvider, 
  onProviderChange, 
  isConnected = false 
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  
  const providers: { key: 'openai' | 'gemini' | 'anthropic'; name: string; shortName: string; icon: string }[] = [
    { key: 'openai', name: 'OpenAI', shortName: 'GPT', icon: '🤖' },
    { key: 'gemini', name: 'Gemini', shortName: 'GEM', icon: '✨' },
    { key: 'anthropic', name: 'Claude', shortName: 'CLD', icon: '🧠' }
  ];
  
  const currentProviderData = providers.find(p => p.key === currentProvider) || providers[0];

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      // Auto-close after 3 seconds of inactivity
      const autoCloseTimer = setTimeout(() => setIsOpen(false), 3000);
      
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
        clearTimeout(autoCloseTimer);
      };
    }
  }, [isOpen]);

  const handleToggle = () => {
    setIsOpen(!isOpen);
  };

  const handleSelect = (provider: 'openai' | 'gemini' | 'anthropic') => {
    onProviderChange(provider);
    setIsOpen(false);
  };

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Main Button - Compact */}
      <div 
        className="flex items-center gap-1 cursor-pointer rounded px-1.5 py-1.5 transition-colors hover:bg-white/10 text-white/70"
        onClick={handleToggle}
        title={`Current: ${currentProviderData.name} - Click to change provider`}
      >
        <div 
          className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-500' : 'bg-red-500'}`}
          title={isConnected ? `Connected to ${currentProviderData.name}` : 'API not connected'}
        />
        <span className="text-[10px] leading-none font-mono">
          {currentProviderData.shortName}
        </span>
        <svg 
          width="8" 
          height="8" 
          viewBox="0 0 24 24" 
          fill="none" 
          xmlns="http://www.w3.org/2000/svg" 
          className={`pointer-events-none transition-transform ${isOpen ? 'rotate-180' : ''}`}
        >
          <path d="M7 10l5 5 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </div>

      {/* Custom Dropdown - Compact */}
      {isOpen && (
        <div className="absolute top-full left-0 mt-1 bg-black/90 backdrop-blur-md border border-white/20 rounded-lg shadow-lg z-50 min-w-[100px]">
          {providers.map((provider) => (
            <div
              key={provider.key}
              className={`flex items-center gap-1.5 px-2 py-1.5 text-[10px] cursor-pointer transition-colors ${
                provider.key === currentProvider 
                  ? 'bg-white/20 text-white' 
                  : 'text-white/80 hover:bg-white/10 hover:text-white'
              }`}
              onClick={() => handleSelect(provider.key)}
            >
              <span className="text-[10px]">{provider.icon}</span>
              <span className="flex-1">{provider.name}</span>
              {provider.key === currentProvider && (
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M20 6L9 17l-5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default AIProviderSelector;
