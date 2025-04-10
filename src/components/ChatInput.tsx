import React, { useState, useRef, useEffect } from 'react';
import { VoiceRecorder } from './VoiceRecorder';
import '../styles/voiceRecorder.css';

interface ChatInputProps {
  onSendMessage: (message: string) => void;
  placeholder?: string;
  disabled?: boolean;
}

export const ChatInput: React.FC<ChatInputProps> = ({
  onSendMessage,
  placeholder = 'Type a message...',
  disabled = false
}) => {
  const [message, setMessage] = useState('');
  const [useAutoPrompt, setUseAutoPrompt] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
    }
  }, [message]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (message.trim() && !disabled) {
      onSendMessage(message);
      setMessage('');
    }
  };

  const handleTranscription = (text: string) => {
    // If there's existing text, add a space before the transcription
    const newMessage = message ? `${message} ${text}` : text;
    setMessage(newMessage);
    
    // If auto-prompt is enabled, send the message immediately
    if (useAutoPrompt) {
      onSendMessage(newMessage);
      setMessage('');
    }
  };

  return (
    <form onSubmit={handleSubmit} className="chat-input-container">
      <div className="chat-input-wrapper">
        <textarea
          ref={textareaRef}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder={placeholder}
          disabled={disabled}
          rows={1}
          className="chat-input"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSubmit(e);
            }
          }}
        />
        
        <div className="chat-input-actions">
          <VoiceRecorder 
            onTranscription={handleTranscription} 
            autoPrompt={useAutoPrompt}
          />
          
          <button
            type="submit"
            disabled={!message.trim() || disabled}
            className="send-button"
          >
            Send
          </button>
        </div>
      </div>
      
      <div className="chat-input-settings">
        <label className="auto-prompt-toggle">
          <input
            type="checkbox"
            checked={useAutoPrompt}
            onChange={() => setUseAutoPrompt(!useAutoPrompt)}
          />
          <span>Auto-send voice messages</span>
        </label>
      </div>
    </form>
  );
};