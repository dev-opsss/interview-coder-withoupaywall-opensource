import React from "react";

type AssistButtonProps = { // Rename prop type
  isActive: boolean;
  onToggle: () => void;
};

const AssistButton: React.FC<AssistButtonProps> = ({ isActive, onToggle }) => { // Rename component
  return (
    <div
      className={`flex items-center gap-1.5 cursor-pointer rounded px-2 py-1.5 transition-colors ${
        isActive 
          ? "bg-indigo-600 text-white" // Changed color to indicate active assistant
          : "hover:bg-white/10 text-white/70" // Adjusted default state text color
      }`}
      onClick={onToggle}
      title={isActive ? "Deactivate Live Assistant" : "Activate Live Assistant"} // Add tooltip
    >
      <div className="w-4 h-4 flex items-center justify-center">
        {/* Using a different icon - e.g., brain or spark */}
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M9.75 17L8.25 14L12 10.5L15.75 14L14.25 17" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          <path d="M12 10.5V7.5M12 7.5C12 6.80294 12.2015 6.13752 12.5606 5.56062M12 7.5C11.1716 7.5 10.5 6.82843 10.5 6C10.5 5.17157 11.1716 4.5 12 4.5C12.8284 4.5 13.5 5.17157 13.5 6C13.5 6.27469 13.4265 6.53128 13.3019 6.7589M17.25 11.5C17.25 12.3284 16.5784 13 15.75 13C14.9216 13 14.25 12.3284 14.25 11.5C14.25 10.6716 14.9216 10 15.75 10C16.5784 10 17.25 10.6716 17.25 11.5ZM8.25 11.5C8.25 12.3284 7.57843 13 6.75 13C5.92157 13 5.25 12.3284 5.25 11.5C5.25 10.6716 5.92157 10 6.75 10C7.57843 10 8.25 10.6716 8.25 11.5Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          <path d="M12 21C7.85786 21 4.5 17.6421 4.5 13.5C4.5 9.35786 7.85786 6 12 6C16.1421 6 19.5 9.35786 19.5 13.5C19.5 17.6421 16.1421 21 12 21Z" stroke="currentColor" strokeWidth="1.5"/>
        </svg>
      </div>
      <span className="text-[11px] leading-none">Assist</span> {/* Rename label */}
    </div>
  );
};

export default AssistButton; // Export renamed component 