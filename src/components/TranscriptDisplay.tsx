import React, { useState, useEffect, useRef } from 'react';

interface Word {
  word: string;
  startTime: number;
  endTime: number;
}

interface TranscriptEntry {
  speaker: 'user' | 'interviewer';
  text: string;
  timestamp: number;
  words?: Word[];
}

interface TranscriptDisplayProps {
  entries: TranscriptEntry[];
  className?: string;
}

export const TranscriptDisplay: React.FC<TranscriptDisplayProps> = ({ 
  entries,
  className = ''
}) => {
  const [currentTime, setCurrentTime] = useState<number>(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const animationFrameRef = useRef<number | null>(null);
  const startTimeRef = useRef<number>(Date.now());

  // Set up the animation loop
  useEffect(() => {
    const updateTime = () => {
      // Calculate elapsed time since component mounted
      const now = Date.now();
      const elapsed = now - startTimeRef.current;
      setCurrentTime(elapsed);
      
      // Continue the animation loop
      animationFrameRef.current = requestAnimationFrame(updateTime);
    };
    
    // Start the animation loop
    animationFrameRef.current = requestAnimationFrame(updateTime);
    
    // Clean up
    return () => {
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, []);

  // Auto-scroll to bottom when new entries are added
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }

    // Debug logging for entries with words
    entries.forEach((entry, idx) => {
      if (entry.words && entry.words.length > 0) {
        console.log(`Entry ${idx} has ${entry.words.length} words with timing:`, 
          entry.words.slice(0, 3).map(w => `"${w.word}" (${w.startTime}s-${w.endTime}s)`));
      }
    });
  }, [entries]);

  const renderWordWithTiming = (word: Word, entryTime: number, isHighlighted: boolean) => {
    const style: React.CSSProperties = {
      display: 'inline-block',
      padding: '0 2px',
      borderRadius: '3px',
      transition: 'background-color 0.3s',
    };
    
    if (isHighlighted) {
      style.backgroundColor = 'rgba(99, 102, 241, 0.4)'; // Indigo color with transparency
      style.fontWeight = 'bold';
    }
    
    return (
      <span key={`${word.word}-${word.startTime}`} style={style}>
        {word.word}
      </span>
    );
  };

  return (
    <div 
      ref={containerRef}
      className={`overflow-y-auto max-h-96 p-4 ${className}`}
      style={{ background: 'transparent' }}
    >
      {entries.map((entry, index) => {
        const entryStartTime = entry.timestamp;
        const relativeTime = currentTime - entryStartTime;
        
        return (
          <div key={index} className="mb-4">
            <div className="font-medium mb-1 text-gray-200">
              {entry.speaker === 'user' ? 'You' : 'Interviewer'}
            </div>
            
            <div className="text-gray-200 leading-relaxed">
              {entry.words ? (
                <div>
                  {entry.words.map((word, wordIndex) => {
                    // Determine if this word should be highlighted based on timing
                    const isCurrentWord = 
                      relativeTime >= word.startTime && 
                      relativeTime <= word.endTime;
                      
                    return renderWordWithTiming(word, entryStartTime, isCurrentWord);
                  })}
                </div>
              ) : (
                <div>{entry.text}</div>
              )}
            </div>
          </div>
        );
      })}
      
      {entries.length === 0 && (
        <div className="text-gray-400 text-center py-10">
          No transcript available yet. Speak to start recording.
        </div>
      )}
    </div>
  );
}; 