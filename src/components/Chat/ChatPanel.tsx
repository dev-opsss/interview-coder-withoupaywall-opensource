import React, { useState, useEffect, useRef } from 'react';
import { Loader2 } from 'lucide-react'; // Import Loader icon

// Define type for chat messages (can be shared if needed)
interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface ChatPanelProps {
  history: ChatMessage[];
  isLoading: boolean;
  onSendMessage: (message: string) => void;
  onClose: () => void;
  isConnected?: boolean; // Connection status for API
  providerName?: string; // Current AI provider name
}

export const ChatPanel: React.FC<ChatPanelProps> = ({ 
  history, 
  isLoading, 
  onSendMessage, 
  onClose,
  isConnected = false,
  providerName = 'AI'
}) => {
  const [inputValue, setInputValue] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Function to handle sending the message
  const handleSend = () => {
    if (inputValue.trim() && !isLoading) {
      onSendMessage(inputValue);
      setInputValue(""); // Clear input after sending
    }
  };

  // Function to handle Enter key press in input
  const handleKeyPress = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault(); // Prevent default newline on Enter
      handleSend();
    }
  };

  // Scroll to bottom when history changes
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [history]);

  return (
    <div className="fixed bottom-16 right-4 w-80 h-96 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 shadow-lg z-40 flex flex-col text-sm font-sans">
      {/* Header */}
      <div className="px-3 py-2 border-b border-gray-200 dark:border-gray-700 flex justify-between items-center bg-gray-50 dark:bg-gray-800">
        <div className="flex items-center gap-2">
          <div 
            className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-500' : 'bg-red-500'}`}
            title={isConnected ? `Connected to ${providerName}` : 'API not connected'}
          ></div>
          <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">AI Chat</h3>
        </div>
        <button 
          onClick={onClose} 
          className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 p-1"
          title="Close (⌘⇧C)"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 6L6 18M6 6L18 18" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
      </div>

      {/* Message List */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2 bg-white dark:bg-gray-900">
        {history.length === 0 && (
          <div className="flex items-center justify-center h-full text-gray-400">
            <div className="text-center">
              <div className="w-8 h-8 mx-auto mb-2 border border-gray-300 rounded-full flex items-center justify-center">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </div>
              <p className="text-xs">Start a conversation</p>
            </div>
          </div>
        )}
        {history.map((msg, index) => (
          <div 
            key={index} 
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div className={`max-w-[85%] px-3 py-2 text-sm ${
              msg.role === 'user' 
                ? 'bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-l-lg rounded-tr-lg' 
                : 'bg-gray-50 dark:bg-gray-800 text-gray-800 dark:text-gray-200 rounded-r-lg rounded-tl-lg border border-gray-200 dark:border-gray-700'
            }`}>
              <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed">{msg.content}</pre>
            </div>
          </div>
        ))}
        {/* Add a dummy div at the end for scrolling */}
        <div ref={messagesEndRef} /> 
      </div>

      {/* Loading Indicator */} 
      {isLoading && (
        <div className="px-3 pb-2 text-gray-500 dark:text-gray-400 text-xs flex items-center justify-center">
          <div className="w-3 h-3 border border-gray-400 border-t-gray-600 rounded-full animate-spin mr-2"></div>
          <span>AI is thinking...</span>
        </div>
      )}

      {/* Input Area */} 
      <div className="p-3 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
        <div className="flex gap-2">
          <input 
            type="text"
            placeholder="Ask anything..."
            className="flex-1 px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-gray-400 focus:border-gray-400"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyPress={handleKeyPress}
            disabled={isLoading}
          />
          <button 
            onClick={handleSend}
            disabled={isLoading || !inputValue.trim()} 
            className="px-3 py-2 bg-gray-700 dark:bg-gray-600 text-white text-sm hover:bg-gray-800 dark:hover:bg-gray-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            title="Send message"
          >
            →
          </button>
        </div>
        <div className="mt-2 text-xs text-gray-400 text-center">
          ⌘J: Toggle Chat • ⌘⌥Q: Force Quit App
        </div>
      </div>
    </div>
  );
}; 