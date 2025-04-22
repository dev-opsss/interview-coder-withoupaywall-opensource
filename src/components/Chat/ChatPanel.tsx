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
}

export const ChatPanel: React.FC<ChatPanelProps> = ({ 
  history, 
  isLoading, 
  onSendMessage, 
  onClose 
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
    <div className="fixed bottom-16 right-4 w-80 h-96 bg-gray-900 border border-gray-700 rounded-lg shadow-xl z-40 flex flex-col text-sm font-sans">
      {/* Header */}
      <div className="p-2 border-b border-gray-600 flex justify-between items-center flex-shrink-0">
        <h3 className="text-white font-semibold text-sm">AI Chat</h3>
        <button 
          onClick={onClose} 
          className="text-gray-400 hover:text-white p-1 rounded hover:bg-gray-700"
          title="Close Chat"
        >
          {/* Simple close icon using text X */}
          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Message List */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {history.map((msg, index) => (
          <div 
            key={index} 
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div 
              className={`max-w-[80%] px-3 py-1.5 rounded-lg ${ 
                msg.role === 'user' 
                  ? 'bg-blue-600 text-white' 
                  : 'bg-gray-700 text-white/90'
              }`}
            >
              {/* Render message content, handling newlines */} 
              <pre className="whitespace-pre-wrap break-words font-sans text-sm">
                {msg.content}
              </pre>
            </div>
          </div>
        ))}
        {/* Add a dummy div at the end for scrolling */}
        <div ref={messagesEndRef} /> 
      </div>

      {/* Loading Indicator */} 
      {isLoading && (
        <div className="px-3 pb-2 text-white/60 text-xs flex items-center justify-center">
          <Loader2 className="h-4 w-4 mr-1 animate-spin" />
          <span>AI is thinking...</span>
        </div>
      )}

      {/* Input Area */} 
      <div className="p-2 border-t border-gray-600 flex items-center flex-shrink-0">
        <input 
          type="text"
          placeholder="Ask anything..."
          className="flex-1 bg-gray-700 text-white px-2 py-1.5 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyPress={handleKeyPress}
          disabled={isLoading}
        />
        <button 
          onClick={handleSend}
          disabled={isLoading || !inputValue.trim()} 
          className="ml-2 bg-blue-500 hover:bg-blue-600 text-white px-3 py-1.5 rounded-md text-sm disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Send
        </button>
      </div>
    </div>
  );
}; 