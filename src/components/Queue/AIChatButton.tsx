import React from "react";

type AIChatButtonProps = {
  isActive: boolean;
  onToggle: () => void;
};

const AIChatButton: React.FC<AIChatButtonProps> = ({ isActive, onToggle }) => {
  return (
    <div
      className={`flex items-center gap-1.5 cursor-pointer rounded px-2 py-1.5 transition-colors ${
        isActive 
          ? "bg-green-500 text-white" 
          : "hover:bg-white/10"
      }`}
      onClick={onToggle}
    >
      <div className="w-4 h-4 flex items-center justify-center">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="w-3.5 h-3.5"
        >
          <rect width="18" height="18" x="3" y="3" rx="2" />
          <path d="M7 9h6" />
          <path d="M8 13h4" />
          <path d="M7 17h3" />
          <path d="M15 9h2" />
          <path d="M15 13h2" />
          <path d="M15 17h2" />
        </svg>
      </div>
      <span className="text-[11px] leading-none">AI Chat</span>
    </div>
  );
};

export default AIChatButton; 