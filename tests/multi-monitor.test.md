# Multi-Monitor Support Testing Strategy

## Overview
This document outlines the comprehensive testing strategy for the Multi-Monitor Support feature in Interview Coder.

## Test Categories

### 1. Unit Tests

#### MultiMonitorManager Tests
- **Monitor Detection**
  - ✅ Detect single monitor setup
  - ✅ Detect multiple monitors
  - ✅ Handle monitor configuration changes
  - ✅ Identify primary monitor correctly
  - ✅ Generate appropriate monitor names

- **Position Calculations**
  - ✅ Calculate optimal positions for all relative positions
  - ✅ Handle edge cases (monitor boundaries)
  - ✅ Respect work area vs full bounds
  - ✅ Handle high DPI scaling correctly

- **Preset Management**
  - ✅ Create presets from current position
  - ✅ Apply presets correctly
  - ✅ Remove presets
  - ✅ Handle invalid preset IDs
  - ✅ Persist presets across app restarts

#### WindowManager Tests
- **Window State Management**
  - ✅ Save window state correctly
  - ✅ Restore window state on app start
  - ✅ Handle invalid saved positions
  - ✅ Adapt to monitor changes

- **Window Positioning**
  - ✅ Move window to specific monitor
  - ✅ Cycle through monitors
  - ✅ Handle monitor removal gracefully
  - ✅ Maintain window visibility

### 2. Integration Tests

#### Electron Main Process Integration
- **IPC Communication**
  - ✅ All IPC handlers respond correctly
  - ✅ Error handling in IPC calls
  - ✅ Data serialization/deserialization

- **Window Creation Integration**
  - ✅ Window manager integrates with main.ts
  - ✅ Restored positions work on app start
  - ✅ Default positioning works correctly

#### React UI Integration
- **Component Communication**
  - ✅ Monitor selector updates correctly
  - ✅ Position controls reflect current state
  - ✅ Presets management works end-to-end
  - ✅ Settings persistence

### 3. User Experience Tests

#### Multi-Monitor Workflows
- **Setup and Discovery**
  - ✅ App detects monitors on first run
  - ✅ Settings show appropriate options
  - ✅ Single monitor shows appropriate message

- **Window Management**
  - ✅ Quick positioning works smoothly
  - ✅ Monitor switching is responsive
  - ✅ Presets apply instantly
  - ✅ Window stays visible during moves

- **Persistence**
  - ✅ Window position remembered across restarts
  - ✅ Presets persist correctly
  - ✅ Settings are maintained

### 4. Edge Case Tests

#### Hardware Changes
- **Monitor Connection/Disconnection**
  - ✅ Handle monitor being disconnected while app is running
  - ✅ Handle new monitor being connected
  - ✅ Handle primary monitor change
  - ✅ Handle resolution changes

- **Invalid States**
  - ✅ Window positioned off-screen after monitor removal
  - ✅ Preset references non-existent monitor
  - ✅ Corrupted settings data
  - ✅ Invalid position coordinates

#### Performance
- **Resource Usage**
  - ✅ Monitor detection doesn't block UI
  - ✅ Position calculations are fast
  - ✅ No memory leaks in event listeners
  - ✅ Efficient settings persistence

## Manual Testing Checklist

### Setup Testing
- [ ] Install app on single monitor system
- [ ] Install app on dual monitor system
- [ ] Install app on triple+ monitor system
- [ ] Test with different monitor arrangements (side-by-side, stacked, mixed)
- [ ] Test with different resolutions and DPI settings

### Basic Functionality
- [ ] Open settings and verify multi-monitor section appears
- [ ] Monitor selector shows all connected monitors
- [ ] Position controls work for each quadrant and center
- [ ] "Next Monitor" button cycles through all monitors
- [ ] Current monitor is correctly identified and highlighted

### Preset Management
- [ ] Create preset from current position
- [ ] Apply preset moves window correctly
- [ ] Delete preset removes it from list
- [ ] Presets persist after app restart
- [ ] Preset names are editable and saved

### Settings Persistence
- [ ] Window position restored after app restart
- [ ] Settings toggles work and persist
- [ ] Monitor preferences are remembered
- [ ] Invalid settings are handled gracefully

### Edge Cases
- [ ] Disconnect monitor while app is running
- [ ] Connect new monitor while app is running
- [ ] Change primary monitor in OS settings
- [ ] Move window off-screen manually and restart app
- [ ] Corrupt settings file and restart app

### Performance
- [ ] Settings dialog opens quickly
- [ ] Window movements are smooth and responsive
- [ ] No lag when switching between monitors
- [ ] App starts quickly with saved positions

## Automated Test Implementation

### Test Environment Setup
```bash
# Install test dependencies
npm install --save-dev jest @types/jest electron-mock-ipc

# Run tests
npm run test:multi-monitor
```

### Mock Data for Testing
```typescript
const mockMonitors = [
  {
    id: 'monitor-1',
    displayId: 1,
    name: 'Built-in Display',
    bounds: { x: 0, y: 0, width: 1920, height: 1080 },
    workArea: { x: 0, y: 25, width: 1920, height: 1055 },
    scaleFactor: 1,
    isPrimary: true,
    isInternal: true
  },
  {
    id: 'monitor-2',
    displayId: 2,
    name: 'External Monitor 1 (2560x1440)',
    bounds: { x: 1920, y: 0, width: 2560, height: 1440 },
    workArea: { x: 1920, y: 0, width: 2560, height: 1440 },
    scaleFactor: 1,
    isPrimary: false,
    isInternal: false
  }
];
```

## Success Criteria

### Functional Requirements
- ✅ All monitors are detected and listed correctly
- ✅ Window can be positioned on any monitor
- ✅ Position presets work reliably
- ✅ Settings persist across app restarts
- ✅ UI is responsive and intuitive

### Performance Requirements
- ✅ Monitor detection < 100ms
- ✅ Window positioning < 50ms
- ✅ Settings save/load < 200ms
- ✅ No memory leaks over 1 hour of use

### Reliability Requirements
- ✅ Handles hardware changes gracefully
- ✅ Recovers from invalid settings
- ✅ No crashes during monitor changes
- ✅ Consistent behavior across platforms

## Known Limitations

1. **Platform Differences**: Some features may behave differently on Windows/Linux vs macOS
2. **High DPI**: Complex DPI scenarios may need additional testing
3. **Virtual Monitors**: Remote desktop scenarios need validation
4. **Performance**: Very large monitor counts (>4) may need optimization

## Future Enhancements

1. **Monitor Profiles**: Save different window layouts for different monitor configurations
2. **Hotkeys**: Global shortcuts for quick window positioning
3. **Visual Preview**: Show window position preview in settings
4. **Advanced Positioning**: Custom positioning with pixel-perfect control
5. **Multi-Window Support**: Manage multiple app windows across monitors

