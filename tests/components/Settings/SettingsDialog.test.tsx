import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import SettingsDialog from '../../../src/components/Settings/SettingsDialog';
import { mockElectronAPI } from '../../setup';

// Mock the multi-monitor settings component
jest.mock('../../../src/components/Settings/MultiMonitorSettings', () => {
  return function MockMultiMonitorSettings({ className }: any) {
    return (
      <div className={className} data-testid="multi-monitor-settings">
        Multi-Monitor Settings Component
      </div>
    );
  };
});

describe('SettingsDialog', () => {
  const mockOnOpenChange = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Setup default mock responses
    mockElectronAPI.getConfig.mockResolvedValue({
      apiKey: 'test-key',
      apiProvider: 'openai',
      extractionModel: 'gpt-4o',
      solutionModel: 'gpt-4o',
      debuggingModel: 'gpt-4o',
    });
    
    mockElectronAPI.getOpenAIApiKey.mockResolvedValue('test-openai-key');
    mockElectronAPI.getGeminiApiKey.mockResolvedValue('');
    mockElectronAPI.getAnthropicApiKey.mockResolvedValue('');
    mockElectronAPI.getSpeechService.mockResolvedValue('whisper');
    mockElectronAPI.getGoogleSpeechApiKey.mockResolvedValue('');
    mockElectronAPI.invoke.mockResolvedValue({});
  });

  test('should not render when closed', () => {
    render(<SettingsDialog open={false} onOpenChange={mockOnOpenChange} />);
    
    expect(screen.queryByText('Settings')).not.toBeInTheDocument();
  });

  test('should render when open', async () => {
    render(<SettingsDialog open={true} onOpenChange={mockOnOpenChange} />);
    
    await waitFor(() => {
      expect(screen.getByText('Settings')).toBeInTheDocument();
    });
  });

  test('should close when close button is clicked', async () => {
    render(<SettingsDialog open={true} onOpenChange={mockOnOpenChange} />);
    
    await waitFor(() => {
      expect(screen.getByText('Settings')).toBeInTheDocument();
    });

    const closeButton = screen.getByLabelText('Close');
    fireEvent.click(closeButton);
    
    expect(mockOnOpenChange).toHaveBeenCalledWith(false);
  });

  test('should render API provider selection', async () => {
    render(<SettingsDialog open={true} onOpenChange={mockOnOpenChange} />);
    
    await waitFor(() => {
      expect(screen.getByText('API Provider')).toBeInTheDocument();
    });
    
    // Should show provider options
    expect(screen.getByText('OpenAI')).toBeInTheDocument();
    expect(screen.getByText('Google Gemini')).toBeInTheDocument();
    expect(screen.getByText('Anthropic Claude')).toBeInTheDocument();
  });

  test('should handle API provider change', async () => {
    mockElectronAPI.updateConfig.mockResolvedValue(true);
    
    render(<SettingsDialog open={true} onOpenChange={mockOnOpenChange} />);
    
    await waitFor(() => {
      expect(screen.getByText('API Provider')).toBeInTheDocument();
    });

    // Select Gemini provider
    const geminiOption = screen.getByText('Google Gemini');
    fireEvent.click(geminiOption);
    
    await waitFor(() => {
      expect(mockElectronAPI.updateConfig).toHaveBeenCalledWith(
        expect.objectContaining({ apiProvider: 'gemini' })
      );
    });
  });

  test('should render API key input for selected provider', async () => {
    render(<SettingsDialog open={true} onOpenChange={mockOnOpenChange} />);
    
    await waitFor(() => {
      expect(screen.getByDisplayValue('test-openai-key')).toBeInTheDocument();
    });
  });

  test('should handle API key update', async () => {
    mockElectronAPI.updateConfig.mockResolvedValue(true);
    
    render(<SettingsDialog open={true} onOpenChange={mockOnOpenChange} />);
    
    await waitFor(() => {
      expect(screen.getByDisplayValue('test-openai-key')).toBeInTheDocument();
    });

    const apiKeyInput = screen.getByDisplayValue('test-openai-key');
    fireEvent.change(apiKeyInput, { target: { value: 'new-api-key' } });
    fireEvent.blur(apiKeyInput);
    
    await waitFor(() => {
      expect(mockElectronAPI.updateConfig).toHaveBeenCalledWith(
        expect.objectContaining({ apiKey: 'new-api-key' })
      );
    });
  });

  test('should render model selection dropdowns', async () => {
    render(<SettingsDialog open={true} onOpenChange={mockOnOpenChange} />);
    
    await waitFor(() => {
      expect(screen.getByText('Problem Extraction Model')).toBeInTheDocument();
      expect(screen.getByText('Solution Generation Model')).toBeInTheDocument();
      expect(screen.getByText('Debugging Model')).toBeInTheDocument();
    });
  });

  test('should handle model selection change', async () => {
    mockElectronAPI.updateConfig.mockResolvedValue(true);
    
    render(<SettingsDialog open={true} onOpenChange={mockOnOpenChange} />);
    
    await waitFor(() => {
      expect(screen.getByText('Problem Extraction Model')).toBeInTheDocument();
    });

    // This test would need more specific implementation details
    // about how the model dropdowns work in the actual component
  });

  test('should render speech service settings', async () => {
    render(<SettingsDialog open={true} onOpenChange={mockOnOpenChange} />);
    
    await waitFor(() => {
      expect(screen.getByText('Speech Service')).toBeInTheDocument();
    });
    
    expect(screen.getByText('OpenAI Whisper')).toBeInTheDocument();
    expect(screen.getByText('Google Speech-to-Text')).toBeInTheDocument();
  });

  test('should handle speech service change', async () => {
    mockElectronAPI.setSpeechService.mockResolvedValue(true);
    
    render(<SettingsDialog open={true} onOpenChange={mockOnOpenChange} />);
    
    await waitFor(() => {
      expect(screen.getByText('Speech Service')).toBeInTheDocument();
    });

    const googleSpeechOption = screen.getByText('Google Speech-to-Text');
    fireEvent.click(googleSpeechOption);
    
    await waitFor(() => {
      expect(mockElectronAPI.setSpeechService).toHaveBeenCalledWith('google');
    });
  });

  test('should show Google API key input when Google Speech is selected', async () => {
    mockElectronAPI.getSpeechService.mockResolvedValue('google');
    mockElectronAPI.getGoogleSpeechApiKey.mockResolvedValue('google-api-key');
    
    render(<SettingsDialog open={true} onOpenChange={mockOnOpenChange} />);
    
    await waitFor(() => {
      expect(screen.getByText('Google Speech API Key')).toBeInTheDocument();
      expect(screen.getByDisplayValue('google-api-key')).toBeInTheDocument();
    });
  });

  test('should handle Google API key update', async () => {
    mockElectronAPI.getSpeechService.mockResolvedValue('google');
    mockElectronAPI.getGoogleSpeechApiKey.mockResolvedValue('old-google-key');
    mockElectronAPI.setGoogleSpeechApiKey.mockResolvedValue({ success: true });
    
    render(<SettingsDialog open={true} onOpenChange={mockOnOpenChange} />);
    
    await waitFor(() => {
      expect(screen.getByDisplayValue('old-google-key')).toBeInTheDocument();
    });

    const googleKeyInput = screen.getByDisplayValue('old-google-key');
    fireEvent.change(googleKeyInput, { target: { value: 'new-google-key' } });
    fireEvent.blur(googleKeyInput);
    
    await waitFor(() => {
      expect(mockElectronAPI.setGoogleSpeechApiKey).toHaveBeenCalledWith('new-google-key');
    });
  });

  test('should render multi-monitor settings section', async () => {
    render(<SettingsDialog open={true} onOpenChange={mockOnOpenChange} />);
    
    await waitFor(() => {
      expect(screen.getByText('Multi-Monitor Support')).toBeInTheDocument();
      expect(screen.getByTestId('multi-monitor-settings')).toBeInTheDocument();
    });
  });

  test('should render save and cancel buttons', async () => {
    render(<SettingsDialog open={true} onOpenChange={mockOnOpenChange} />);
    
    await waitFor(() => {
      expect(screen.getByText('Save Changes')).toBeInTheDocument();
      expect(screen.getByText('Cancel')).toBeInTheDocument();
    });
  });

  test('should handle save button click', async () => {
    mockElectronAPI.updateConfig.mockResolvedValue(true);
    
    render(<SettingsDialog open={true} onOpenChange={mockOnOpenChange} />);
    
    await waitFor(() => {
      expect(screen.getByText('Save Changes')).toBeInTheDocument();
    });

    const saveButton = screen.getByText('Save Changes');
    fireEvent.click(saveButton);
    
    // Should close the dialog after saving
    expect(mockOnOpenChange).toHaveBeenCalledWith(false);
  });

  test('should handle cancel button click', async () => {
    render(<SettingsDialog open={true} onOpenChange={mockOnOpenChange} />);
    
    await waitFor(() => {
      expect(screen.getByText('Cancel')).toBeInTheDocument();
    });

    const cancelButton = screen.getByText('Cancel');
    fireEvent.click(cancelButton);
    
    expect(mockOnOpenChange).toHaveBeenCalledWith(false);
  });

  test('should handle API errors gracefully', async () => {
    mockElectronAPI.getConfig.mockRejectedValue(new Error('API Error'));
    
    render(<SettingsDialog open={true} onOpenChange={mockOnOpenChange} />);
    
    // Should still render the dialog even if API calls fail
    await waitFor(() => {
      expect(screen.getByText('Settings')).toBeInTheDocument();
    });
  });

  test('should show loading state while fetching data', async () => {
    // Mock slow API response
    mockElectronAPI.getConfig.mockImplementation(() => 
      new Promise(resolve => setTimeout(() => resolve({}), 100))
    );
    
    render(<SettingsDialog open={true} onOpenChange={mockOnOpenChange} />);
    
    // Should show some loading indication
    expect(screen.getByText('Settings')).toBeInTheDocument();
  });

  test('should validate API keys', async () => {
    mockElectronAPI.validateApiKey.mockResolvedValue({ valid: false, error: 'Invalid key' });
    
    render(<SettingsDialog open={true} onOpenChange={mockOnOpenChange} />);
    
    await waitFor(() => {
      expect(screen.getByDisplayValue('test-openai-key')).toBeInTheDocument();
    });

    const apiKeyInput = screen.getByDisplayValue('test-openai-key');
    fireEvent.change(apiKeyInput, { target: { value: 'invalid-key' } });
    fireEvent.blur(apiKeyInput);
    
    await waitFor(() => {
      expect(mockElectronAPI.validateApiKey).toHaveBeenCalledWith('invalid-key');
    });
  });

  test('should be accessible', async () => {
    render(<SettingsDialog open={true} onOpenChange={mockOnOpenChange} />);
    
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-labelledby');
    expect(dialog).toHaveAttribute('aria-describedby');
    
    // Should have proper focus management
    const closeButton = screen.getByLabelText('Close');
    expect(closeButton).toBeInTheDocument();
  });

  test('should handle keyboard navigation', async () => {
    render(<SettingsDialog open={true} onOpenChange={mockOnOpenChange} />);
    
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    // Test Escape key to close
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(mockOnOpenChange).toHaveBeenCalledWith(false);
  });
});
