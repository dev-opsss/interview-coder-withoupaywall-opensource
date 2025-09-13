import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import MonitorSelector from '../../../src/components/MultiMonitor/MonitorSelector';
import { mockElectronAPI } from '../../setup';

const mockMonitors = [
  {
    id: 'monitor-1',
    displayId: 1,
    name: 'Built-in Display',
    bounds: { x: 0, y: 0, width: 1920, height: 1080 },
    workArea: { x: 0, y: 25, width: 1920, height: 1055 },
    scaleFactor: 1,
    isPrimary: true,
    isInternal: true,
  },
  {
    id: 'monitor-2',
    displayId: 2,
    name: 'External Monitor 1',
    bounds: { x: 1920, y: 0, width: 2560, height: 1440 },
    workArea: { x: 1920, y: 0, width: 2560, height: 1440 },
    scaleFactor: 1,
    isPrimary: false,
    isInternal: false,
  },
];

describe('MonitorSelector', () => {
  const mockOnMonitorSelect = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    mockElectronAPI.invoke.mockImplementation((channel: string) => {
      switch (channel) {
        case 'get-monitors':
          return Promise.resolve(mockMonitors);
        case 'get-current-monitor':
          return Promise.resolve(mockMonitors[0]);
        default:
          return Promise.resolve(null);
      }
    });
  });

  test('should render loading state initially', () => {
    render(<MonitorSelector onMonitorSelect={mockOnMonitorSelect} />);
    
    expect(screen.getByText('Loading monitors...')).toBeInTheDocument();
  });

  test('should render monitor selector after loading', async () => {
    render(<MonitorSelector onMonitorSelect={mockOnMonitorSelect} />);
    
    await waitFor(() => {
      expect(screen.getByText('Built-in Display (Primary) - 1920×1080')).toBeInTheDocument();
    });
  });

  test('should show single monitor message when only one monitor', async () => {
    mockElectronAPI.invoke.mockImplementation((channel: string) => {
      switch (channel) {
        case 'get-monitors':
          return Promise.resolve([mockMonitors[0]]);
        case 'get-current-monitor':
          return Promise.resolve(mockMonitors[0]);
        default:
          return Promise.resolve(null);
      }
    });

    render(<MonitorSelector onMonitorSelect={mockOnMonitorSelect} />);
    
    await waitFor(() => {
      expect(screen.getByText('Single monitor detected')).toBeInTheDocument();
    });
  });

  test('should open dropdown when clicked', async () => {
    render(<MonitorSelector onMonitorSelect={mockOnMonitorSelect} />);
    
    await waitFor(() => {
      expect(screen.getByText('Built-in Display (Primary) - 1920×1080')).toBeInTheDocument();
    });

    const dropdownButton = screen.getByRole('button', { name: /select monitor/i });
    fireEvent.click(dropdownButton);

    expect(screen.getByText('External Monitor 1 - 2560×1440')).toBeInTheDocument();
  });

  test('should call onMonitorSelect when monitor is selected', async () => {
    render(<MonitorSelector onMonitorSelect={mockOnMonitorSelect} />);
    
    await waitFor(() => {
      expect(screen.getByText('Built-in Display (Primary) - 1920×1080')).toBeInTheDocument();
    });

    // Open dropdown
    const dropdownButton = screen.getByRole('button', { name: /select monitor/i });
    fireEvent.click(dropdownButton);

    // Select second monitor
    const monitor2Option = screen.getByText('External Monitor 1 - 2560×1440');
    fireEvent.click(monitor2Option);

    expect(mockOnMonitorSelect).toHaveBeenCalledWith('monitor-2', 'center');
  });

  test('should close dropdown when clicking outside', async () => {
    render(<MonitorSelector onMonitorSelect={mockOnMonitorSelect} />);
    
    await waitFor(() => {
      expect(screen.getByText('Built-in Display (Primary) - 1920×1080')).toBeInTheDocument();
    });

    // Open dropdown
    const dropdownButton = screen.getByRole('button', { name: /select monitor/i });
    fireEvent.click(dropdownButton);

    expect(screen.getByText('External Monitor 1 - 2560×1440')).toBeInTheDocument();

    // Click backdrop
    const backdrop = document.querySelector('.fixed.inset-0');
    if (backdrop) {
      fireEvent.click(backdrop);
    }

    await waitFor(() => {
      expect(screen.queryByText('External Monitor 1 - 2560×1440')).not.toBeInTheDocument();
    });
  });

  test('should handle API errors gracefully', async () => {
    mockElectronAPI.invoke.mockRejectedValue(new Error('API Error'));

    render(<MonitorSelector onMonitorSelect={mockOnMonitorSelect} />);
    
    await waitFor(() => {
      expect(screen.getByText('Single monitor detected')).toBeInTheDocument();
    });
  });

  test('should display monitor information correctly', async () => {
    render(<MonitorSelector onMonitorSelect={mockOnMonitorSelect} />);
    
    await waitFor(() => {
      expect(screen.getByText('Built-in Display (Primary) - 1920×1080')).toBeInTheDocument();
    });

    // Open dropdown
    const dropdownButton = screen.getByRole('button', { name: /select monitor/i });
    fireEvent.click(dropdownButton);

    // Check monitor details
    expect(screen.getByText('Built-in Display')).toBeInTheDocument();
    expect(screen.getByText('Primary')).toBeInTheDocument();
    expect(screen.getByText('1920×1080')).toBeInTheDocument();
    expect(screen.getByText('External Monitor 1')).toBeInTheDocument();
    expect(screen.getByText('2560×1440')).toBeInTheDocument();
  });

  test('should show scale factor when not 1', async () => {
    const monitorsWithScale = [
      {
        ...mockMonitors[0],
        scaleFactor: 2,
      },
    ];

    mockElectronAPI.invoke.mockImplementation((channel: string) => {
      switch (channel) {
        case 'get-monitors':
          return Promise.resolve(monitorsWithScale);
        case 'get-current-monitor':
          return Promise.resolve(monitorsWithScale[0]);
        default:
          return Promise.resolve(null);
      }
    });

    render(<MonitorSelector onMonitorSelect={mockOnMonitorSelect} />);
    
    await waitFor(() => {
      expect(screen.getByText('Built-in Display (Primary) - 1920×1080')).toBeInTheDocument();
    });

    // Open dropdown
    const dropdownButton = screen.getByRole('button', { name: /select monitor/i });
    fireEvent.click(dropdownButton);

    expect(screen.getByText('1920×1080 @ 200%')).toBeInTheDocument();
  });

  test('should highlight current monitor', async () => {
    render(<MonitorSelector onMonitorSelect={mockOnMonitorSelect} />);
    
    await waitFor(() => {
      expect(screen.getByText('Built-in Display (Primary) - 1920×1080')).toBeInTheDocument();
    });

    // Open dropdown
    const dropdownButton = screen.getByRole('button', { name: /select monitor/i });
    fireEvent.click(dropdownButton);

    const currentMonitorOption = screen.getByRole('option', { selected: true });
    expect(currentMonitorOption).toBeInTheDocument();
  });

  test('should be accessible', async () => {
    render(<MonitorSelector onMonitorSelect={mockOnMonitorSelect} />);
    
    await waitFor(() => {
      expect(screen.getByText('Built-in Display (Primary) - 1920×1080')).toBeInTheDocument();
    });

    const dropdownButton = screen.getByRole('button', { name: /select monitor/i });
    expect(dropdownButton).toHaveAttribute('aria-expanded', 'false');
    expect(dropdownButton).toHaveAttribute('aria-haspopup', 'listbox');

    fireEvent.click(dropdownButton);
    expect(dropdownButton).toHaveAttribute('aria-expanded', 'true');

    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(2);
    
    options.forEach(option => {
      expect(option).toHaveAttribute('aria-selected');
    });
  });

  test('should handle keyboard navigation', async () => {
    render(<MonitorSelector onMonitorSelect={mockOnMonitorSelect} />);
    
    await waitFor(() => {
      expect(screen.getByText('Built-in Display (Primary) - 1920×1080')).toBeInTheDocument();
    });

    const dropdownButton = screen.getByRole('button', { name: /select monitor/i });
    
    // Test Enter key to open dropdown
    fireEvent.keyDown(dropdownButton, { key: 'Enter' });
    expect(screen.getByText('External Monitor 1 - 2560×1440')).toBeInTheDocument();

    // Test Escape key to close dropdown
    fireEvent.keyDown(dropdownButton, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByText('External Monitor 1 - 2560×1440')).not.toBeInTheDocument();
    });
  });

  test('should apply custom className', () => {
    const customClass = 'custom-monitor-selector';
    render(
      <MonitorSelector 
        onMonitorSelect={mockOnMonitorSelect} 
        className={customClass} 
      />
    );
    
    const container = document.querySelector(`.${customClass}`);
    expect(container).toBeInTheDocument();
  });
});
