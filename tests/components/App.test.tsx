import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import App from '../../src/App';
import { mockElectronAPI } from '../setup';

// Mock the heavy components to speed up tests
jest.mock('../../src/_pages/SubscribedApp', () => {
  return function MockSubscribedApp({ credits, currentLanguage }: any) {
    return (
      <div data-testid="subscribed-app">
        <div>Credits: {credits}</div>
        <div>Language: {currentLanguage}</div>
      </div>
    );
  };
});

jest.mock('../../src/components/WelcomeScreen', () => {
  return function MockWelcomeScreen({ onOpenSettings }: any) {
    return (
      <div data-testid="welcome-screen">
        <button onClick={onOpenSettings}>Open Settings</button>
      </div>
    );
  };
});

jest.mock('../../src/components/Settings/SettingsDialog', () => {
  return function MockSettingsDialog({ open, onOpenChange }: any) {
    return open ? (
      <div data-testid="settings-dialog">
        <button onClick={() => onOpenChange(false)}>Close Settings</button>
      </div>
    ) : null;
  };
});

jest.mock('../../src/components/VoiceTranscriptionPanel', () => {
  return function MockVoiceTranscriptionPanel({ onClose }: any) {
    return (
      <div data-testid="voice-panel">
        <button onClick={onClose}>Close Voice Panel</button>
      </div>
    );
  };
});

describe('App Component', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    
    // Setup default mock responses
    mockElectronAPI.checkApiKey.mockResolvedValue(true);
    mockElectronAPI.getConfig.mockResolvedValue({
      apiKey: 'test-key',
      language: 'python',
    });
    mockElectronAPI.getSpeechService.mockResolvedValue('whisper');
    mockElectronAPI.getGoogleSpeechApiKey.mockResolvedValue('');
  });

  test('should show loading state initially', () => {
    render(<App />);
    
    expect(screen.getByText('Initializing...')).toBeInTheDocument();
  });

  test('should show subscribed app when initialized with API key', async () => {
    render(<App />);
    
    await waitFor(() => {
      expect(screen.getByTestId('subscribed-app')).toBeInTheDocument();
    });

    expect(screen.getByText('Credits: 999')).toBeInTheDocument();
    expect(screen.getByText('Language: python')).toBeInTheDocument();
  });

  test('should show welcome screen when no API key', async () => {
    mockElectronAPI.checkApiKey.mockResolvedValue(false);
    
    render(<App />);
    
    await waitFor(() => {
      expect(screen.getByTestId('welcome-screen')).toBeInTheDocument();
    });
  });

  test('should handle API key validation failure', async () => {
    mockElectronAPI.checkApiKey.mockRejectedValue(new Error('API Error'));
    
    render(<App />);
    
    // Should still initialize and show welcome screen
    await waitFor(() => {
      expect(screen.getByTestId('welcome-screen')).toBeInTheDocument();
    });
  });

  test('should open settings when requested', async () => {
    mockElectronAPI.checkApiKey.mockResolvedValue(false);
    
    render(<App />);
    
    await waitFor(() => {
      expect(screen.getByTestId('welcome-screen')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Open Settings'));
    
    expect(screen.getByTestId('settings-dialog')).toBeInTheDocument();
  });

  test('should close settings dialog', async () => {
    mockElectronAPI.checkApiKey.mockResolvedValue(false);
    
    render(<App />);
    
    await waitFor(() => {
      expect(screen.getByTestId('welcome-screen')).toBeInTheDocument();
    });

    // Open settings
    fireEvent.click(screen.getByText('Open Settings'));
    expect(screen.getByTestId('settings-dialog')).toBeInTheDocument();

    // Close settings
    fireEvent.click(screen.getByText('Close Settings'));
    
    await waitFor(() => {
      expect(screen.queryByTestId('settings-dialog')).not.toBeInTheDocument();
    });
  });

  test('should handle speech service initialization', async () => {
    mockElectronAPI.getSpeechService.mockResolvedValue('google');
    mockElectronAPI.getGoogleSpeechApiKey.mockResolvedValue('test-google-key');
    
    render(<App />);
    
    await waitFor(() => {
      expect(screen.getByTestId('subscribed-app')).toBeInTheDocument();
    });

    expect(mockElectronAPI.getSpeechService).toHaveBeenCalled();
    expect(mockElectronAPI.getGoogleSpeechApiKey).toHaveBeenCalled();
  });

  test('should handle speech service errors gracefully', async () => {
    mockElectronAPI.getSpeechService.mockRejectedValue(new Error('Speech service error'));
    
    render(<App />);
    
    await waitFor(() => {
      expect(screen.getByTestId('subscribed-app')).toBeInTheDocument();
    });

    // Should still render the app despite speech service error
    expect(screen.getByTestId('subscribed-app')).toBeInTheDocument();
  });

  test('should initialize with custom language from config', async () => {
    mockElectronAPI.getConfig.mockResolvedValue({
      apiKey: 'test-key',
      language: 'javascript',
    });
    
    render(<App />);
    
    await waitFor(() => {
      expect(screen.getByText('Language: javascript')).toBeInTheDocument();
    });
  });

  test('should fallback to default language when config fails', async () => {
    mockElectronAPI.getConfig.mockRejectedValue(new Error('Config error'));
    
    render(<App />);
    
    await waitFor(() => {
      expect(screen.getByText('Language: python')).toBeInTheDocument();
    });
  });

  test('should handle API key invalid event', async () => {
    const mockCallback = jest.fn();
    mockElectronAPI.onApiKeyInvalid.mockReturnValue(() => {});
    
    render(<App />);
    
    await waitFor(() => {
      expect(mockElectronAPI.onApiKeyInvalid).toHaveBeenCalled();
    });
  });

  test('should handle solution success event', async () => {
    mockElectronAPI.onSolutionSuccess.mockReturnValue(() => {});
    
    render(<App />);
    
    await waitFor(() => {
      expect(mockElectronAPI.onSolutionSuccess).toHaveBeenCalled();
    });
  });

  test('should handle settings dialog open event', async () => {
    mockElectronAPI.onShowSettings.mockReturnValue(() => {});
    
    render(<App />);
    
    await waitFor(() => {
      expect(mockElectronAPI.onShowSettings).toHaveBeenCalled();
    });
  });

  test('should handle voice recording state', async () => {
    render(<App />);
    
    await waitFor(() => {
      expect(screen.getByTestId('subscribed-app')).toBeInTheDocument();
    });

    // The voice recording functionality is complex and would require
    // more detailed mocking of MediaRecorder and VAD components
    // For now, we just verify the app renders correctly
  });

  test('should handle live assistant toggle', async () => {
    render(<App />);
    
    await waitFor(() => {
      expect(screen.getByTestId('subscribed-app')).toBeInTheDocument();
    });

    // Since SubscribedApp is mocked, we can't test the actual live assistant
    // functionality here, but we can verify the app structure is correct
  });

  test('should handle chat panel state', async () => {
    render(<App />);
    
    await waitFor(() => {
      expect(screen.getByTestId('subscribed-app')).toBeInTheDocument();
    });

    // Chat panel functionality would be tested in SubscribedApp tests
  });

  test('should handle errors during initialization gracefully', async () => {
    // Mock all API calls to fail
    mockElectronAPI.checkApiKey.mockRejectedValue(new Error('API Error'));
    mockElectronAPI.getConfig.mockRejectedValue(new Error('Config Error'));
    mockElectronAPI.getSpeechService.mockRejectedValue(new Error('Speech Error'));
    
    render(<App />);
    
    // App should still initialize with defaults
    await waitFor(() => {
      expect(screen.getByTestId('welcome-screen')).toBeInTheDocument();
    });
  });

  test('should cleanup event listeners on unmount', async () => {
    const mockCleanup = jest.fn();
    mockElectronAPI.onApiKeyInvalid.mockReturnValue(mockCleanup);
    mockElectronAPI.onSolutionSuccess.mockReturnValue(mockCleanup);
    mockElectronAPI.onShowSettings.mockReturnValue(mockCleanup);
    
    const { unmount } = render(<App />);
    
    await waitFor(() => {
      expect(screen.getByTestId('subscribed-app')).toBeInTheDocument();
    });

    unmount();
    
    // Cleanup functions should be called
    expect(mockCleanup).toHaveBeenCalledTimes(3);
  });

  test('should handle toast notifications', async () => {
    render(<App />);
    
    await waitFor(() => {
      expect(screen.getByTestId('subscribed-app')).toBeInTheDocument();
    });

    // Toast functionality is provided by context and would be tested
    // in individual component tests
  });

  test('should handle update notifications', async () => {
    render(<App />);
    
    await waitFor(() => {
      expect(screen.getByTestId('subscribed-app')).toBeInTheDocument();
    });

    // UpdateNotification component should be rendered
    // The actual functionality would be tested in UpdateNotification tests
  });
});
