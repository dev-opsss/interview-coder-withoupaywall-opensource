import React, { useState, useRef, useEffect } from 'react'
import { PROGRAMMING_LANGUAGES } from '../../constants/languages'

interface LanguageSelectorProps {
  currentLanguage: string
  setLanguage: (language: string) => void
  compact?: boolean // Optional prop for compact mode (like in QueueCommands)
}

export const LanguageSelector: React.FC<LanguageSelectorProps> = ({
  currentLanguage,
  setLanguage,
  compact = false
}) => {
  const [isOpen, setIsOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  const currentLangObj = PROGRAMMING_LANGUAGES.find(lang => lang.value === currentLanguage) || PROGRAMMING_LANGUAGES[0]

  // Handle click outside to close dropdown
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Render text to canvas for screenshot protection
  useEffect(() => {
    if (canvasRef.current && isOpen) {
      const canvas = canvasRef.current
      const ctx = canvas.getContext('2d')
      if (ctx) {
        // Clear canvas
        ctx.clearRect(0, 0, canvas.width, canvas.height)
        
        // Set up text rendering with anti-screenshot properties
        ctx.font = compact ? '9px system-ui' : '12px system-ui'
        ctx.fillStyle = '#ffffff'
        ctx.textBaseline = 'middle'
        
        // Render each language option
        PROGRAMMING_LANGUAGES.forEach((lang, index) => {
          const y = 15 + (index * (compact ? 20 : 24))
          
          // Add subtle noise to text rendering
          ctx.save()
          ctx.globalAlpha = 0.9999
          ctx.filter = 'contrast(1.001) brightness(0.999)'
          
          // Render text with micro-positioning variations
          ctx.fillText(lang.label, 10 + Math.sin(index) * 0.01, y + Math.cos(index) * 0.01)
          
          ctx.restore()
        })
      }
    }
  }, [isOpen, compact])

  const handleLanguageSelect = async (langValue: string) => {
    setLanguage(langValue)
    setIsOpen(false)
    
    try {
      // Save language preference to electron store
      await window.electronAPI.updateConfig({ language: langValue })
      
      // Update global language variable
      window.__LANGUAGE__ = langValue
      
      console.log(`Language changed to ${langValue}`)
    } catch (error) {
      console.error('Error updating language:', error)
    }
  }

  // Legacy select mode (fallback for compatibility)
  const handleLegacyChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newLanguage = e.target.value
    await handleLanguageSelect(newLanguage)
  }

  if (compact) {
    // Compact mode for QueueCommands
    return (
      <div className="relative" ref={dropdownRef}>
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="flex items-center justify-between bg-black/80 text-white/90 rounded px-1 py-0.5 text-[9px] outline-none border border-white/10 focus:border-white/20 min-w-[60px] hover:bg-black/90 transition-colors"
          style={{
            filter: 'contrast(1.001)',
            transform: 'translateZ(0)',
          }}
        >
          <span>{currentLangObj.label}</span>
          <svg 
            className={`w-2 h-2 ml-1 transition-transform ${isOpen ? 'rotate-180' : ''}`} 
            fill="none" 
            stroke="currentColor" 
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {isOpen && (
          <div className="absolute z-50 mt-1 w-full">
            {/* Canvas-based rendering for screenshot protection */}
            <canvas
              ref={canvasRef}
              width={120}
              height={PROGRAMMING_LANGUAGES.length * 20 + 10}
              className="absolute inset-0 pointer-events-none screenshare-hidden"
              style={{
                background: 'rgba(0,0,0,0.9)',
                borderRadius: '4px',
                border: '1px solid rgba(255,255,255,0.1)',
                mask: 'linear-gradient(45deg, transparent 0%, black 0.1%, black 99.9%, transparent 100%)',
                WebkitMask: 'linear-gradient(45deg, transparent 0%, black 0.1%, black 99.9%, transparent 100%)',
                filter: 'contrast(1.01) brightness(0.99) blur(0.001px)',
                transform: 'perspective(1000px) rotateX(0.001deg) rotateY(0.001deg) translateZ(0.001px)',
                mixBlendMode: 'normal',
                isolation: 'isolate',
                contain: 'layout style paint',
                willChange: 'transform',
              }}
              data-screenshare-ignore="true"
              data-capture-ignore="true"
              data-no-capture="true"
            />
            
            {/* Invisible clickable overlay */}
            <div className="relative bg-transparent rounded border-none">
              {PROGRAMMING_LANGUAGES.map((lang) => (
                <button
                  key={lang.value}
                  onClick={() => handleLanguageSelect(lang.value)}
                  className={`block w-full text-left px-2 py-1 text-[9px] hover:bg-white/5 transition-colors ${
                    currentLanguage === lang.value ? 'bg-white/10 text-white' : 'text-transparent'
                  }`}
                  style={{
                    color: 'transparent',
                    background: currentLanguage === lang.value ? 'rgba(255,255,255,0.1)' : 'transparent',
                    height: '20px',
                    opacity: 0.0001,
                    transform: 'translateZ(1px)',
                    pointerEvents: 'auto',
                  }}
                  data-screenshare-ignore="true"
                  data-capture-ignore="true"
                  data-no-capture="true"
                >
                  {lang.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    )
  }

  // Regular mode for other components
  return (
    <div className="mb-3 px-2 space-y-1">
      <div className="flex items-center justify-between text-[13px] font-medium text-white/90">
        <span>Language</span>
        <div className="relative" ref={dropdownRef}>
          <button
            onClick={() => setIsOpen(!isOpen)}
            className="flex items-center justify-between bg-black/80 text-white/90 rounded px-2 py-1 text-sm outline-none border border-white/10 focus:border-white/20 min-w-[80px] hover:bg-black/90 transition-colors"
            style={{
              filter: 'contrast(1.001)',
              transform: 'translateZ(0)',
            }}
          >
            <span>{currentLangObj.label}</span>
            <svg 
              className={`w-3 h-3 ml-1 transition-transform ${isOpen ? 'rotate-180' : ''}`} 
              fill="none" 
              stroke="currentColor" 
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {isOpen && (
            <div className="absolute z-50 mt-1 w-full">
              {/* Canvas-based rendering for screenshot protection */}
              <canvas
                ref={canvasRef}
                width={140}
                height={PROGRAMMING_LANGUAGES.length * 24 + 10}
                className="absolute inset-0 pointer-events-none screenshare-hidden"
                style={{
                  background: 'rgba(0,0,0,0.9)',
                  borderRadius: '4px',
                  border: '1px solid rgba(255,255,255,0.1)',
                  mask: 'linear-gradient(45deg, transparent 0%, black 0.1%, black 99.9%, transparent 100%)',
                  WebkitMask: 'linear-gradient(45deg, transparent 0%, black 0.1%, black 99.9%, transparent 100%)',
                  filter: 'contrast(1.01) brightness(0.99) blur(0.001px)',
                  transform: 'perspective(1000px) rotateX(0.001deg) rotateY(0.001deg) translateZ(0.001px)',
                  mixBlendMode: 'normal',
                  isolation: 'isolate',
                  contain: 'layout style paint',
                  willChange: 'transform',
                }}
                data-screenshare-ignore="true"
                data-capture-ignore="true"
                data-no-capture="true"
              />
              
              {/* Invisible clickable overlay */}
              <div className="relative bg-transparent rounded border-none">
                {PROGRAMMING_LANGUAGES.map((lang) => (
                  <button
                    key={lang.value}
                    onClick={() => handleLanguageSelect(lang.value)}
                    className={`block w-full text-left px-2 py-1 text-sm hover:bg-white/5 transition-colors ${
                      currentLanguage === lang.value ? 'bg-white/10 text-white' : 'text-transparent'
                    }`}
                    style={{
                      color: 'transparent',
                      background: currentLanguage === lang.value ? 'rgba(255,255,255,0.1)' : 'transparent',
                      height: '24px',
                      opacity: 0.0001,
                      transform: 'translateZ(1px)',
                      pointerEvents: 'auto',
                    }}
                    data-screenshare-ignore="true"
                    data-capture-ignore="true"
                    data-no-capture="true"
                  >
                    {lang.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
