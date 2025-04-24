import React from "react";

type VoiceButtonProps = {
  isActive: boolean;
  onToggle: () => void;
};

const VoiceButton: React.FC<VoiceButtonProps> = ({ isActive, onToggle }) => {
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
          <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
          <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
          <line x1="12" y1="19" x2="12" y2="22" />
        </svg>
      </div>
      <span className="text-[11px] leading-none">Voice</span>
    </div>
  );
};

export default VoiceButton; 