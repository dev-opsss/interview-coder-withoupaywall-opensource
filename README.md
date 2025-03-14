# Interview Coder - Unlocked Edition

An invisible desktop application that helps you pass your technical interviews.

## Features

- 🎯 99% Invisibility: Undetectable window that bypasses most screen capture methods
- 📸 Smart Screenshot Capture: Capture both question text and code separately for better analysis
- 🤖 AI-Powered Analysis: Automatically extracts and analyzes coding problems using GPT-4o
- 💡 Solution Generation: Get detailed explanations and solutions with time/space complexity analysis
- 🔧 Real-time Debugging: Debug your code with AI assistance and structured feedback
- 🎨 Advanced Window Management: Freely move, resize, change opacity, and zoom the window
- 🔄 Model Selection: Choose between GPT-4o and GPT-4o-mini for different processing stages
- 🔒 Privacy-Focused: Your API key and data never leave your computer except for OpenAI API calls

## Global Commands

The application uses unidentifiable global keyboard shortcuts that won't be detected by browsers or other applications:

- Toggle Window Visibility: [Control or Cmd + B]
- Move Window: [Control or Cmd + Arrow keys]
- Take Screenshot: [Control or Cmd + H]
- Delete Last Screenshot: [Control or Cmd + L]
- Process Screenshots: [Control or Cmd + Enter]
- Reset View: [Control or Cmd + R]
- Quit: [Control or Cmd + Q]
- Decrease Opacity: [Control or Cmd + []
- Increase Opacity: [Control or Cmd + ]]
- Zoom Out: [Control or Cmd + -]
- Reset Zoom: [Control or Cmd + 0]
- Zoom In: [Control or Cmd + =]

## Invisibility Compatibility

The application is invisible to:

- Zoom versions below 6.1.6 (inclusive)
- All browser-based screen recording software
- All versions of Discord
- Mac OS _screenshot_ functionality (Command + Shift + 3/4)

Note: The application is **NOT** invisible to:

- Zoom versions 6.1.6 and above
  - https://zoom.en.uptodown.com/mac/versions (link to downgrade Zoom if needed)
- Mac OS native screen _recording_ (Command + Shift + 5)

## Prerequisites

- Node.js (v16 or higher)
- npm or bun package manager
- OpenAI API Key
- Screen Recording Permission for Terminal/IDE
  - On macOS:
    1. Go to System Preferences > Security & Privacy > Privacy > Screen Recording
    2. Ensure that Interview Coder has screen recording permission enabled
    3. Restart Interview Coder after enabling permissions
  - On Windows:
    - No additional permissions needed
  - On Linux:
    - May require `xhost` access depending on your distribution

## Installation

1. Clone the repository:

```bash
git clone https://github.com/yourusername/interview-coder-unlocked.git
cd interview-coder-unlocked
```

2. Install dependencies:

```bash
npm install
# or if using bun
bun install
```

3. Start the application:

```bash
npm run dev
```

4. Enter your OpenAI API key in the settings dialog when prompted.

## Running in Production

1. Build the application:

```bash
npm run build
```

2. The built application will be in the `dist` directory.

3. Alternatively, you can use the provided `stealth-run.bat` to quickly build and launch the application.

## Tech Stack

- Electron
- React
- TypeScript
- Vite
- Tailwind CSS
- Radix UI Components
- OpenAI API

## How It Works

1. **Initial Setup**
   - Launch the invisible window
   - Enter your OpenAI API key in the settings
   - Choose your preferred model for extraction, solution generation, and debugging

2. **Capturing Problem**
   - Use global shortcut [Control or Cmd + H] to take screenshots of code problems
   - Screenshots are automatically added to the queue of up to 2
   - If needed, remove the last screenshot with [Control or Cmd + L]

3. **Processing**
   - Press [Control or Cmd + Enter] to analyze the screenshots
   - AI extracts problem requirements from the screenshots using GPT-4 Vision API
   - The model generates an optimal solution based on the extracted information
   - All analysis is done using your personal OpenAI API key

4. **Solution & Debugging**
   - View the generated solutions with detailed explanations
   - Use debugging feature by taking more screenshots of error messages or code
   - Get structured analysis with identified issues, corrections, and optimizations
   - Toggle between solutions and queue views as needed

5. **Window Management**
   - Move window using [Control or Cmd + Arrow keys]
   - Toggle visibility with [Control or Cmd + B]
   - Adjust opacity with [Control or Cmd + [] and [Control or Cmd + ]]
   - Window remains invisible to specified screen sharing applications
   - Reset view using [Control or Cmd + R]

## Configuration

- **OpenAI API Key**: Your personal API key is stored locally and only used for API calls to OpenAI
- **Model Selection**: You can choose between GPT-4o and GPT-4o-mini for each stage of processing:
  - Problem Extraction: Analyzes screenshots to understand the coding problem
  - Solution Generation: Creates optimized solutions with explanations
  - Debugging: Provides detailed analysis of errors and improvement suggestions
- **Language**: Select your preferred programming language for solutions
- **Window Controls**: Adjust opacity, position, and zoom level using keyboard shortcuts
- **All settings are stored locally** in your user data directory and persist between sessions

## License

This project is licensed under the GNU Affero General Public License v3.0 (AGPL-3.0).

### What This Means

- You are free to use, modify, and distribute this software
- If you modify the code, you must make your changes available under the same license
- If you run a modified version on a network server, you must make the source code available to users
- We strongly encourage you to contribute improvements back to the main project

See the [LICENSE-SHORT](LICENSE-SHORT) file for a summary of terms or visit [GNU AGPL-3.0](https://www.gnu.org/licenses/agpl-3.0.html) for the full license text.

### Contributing

We welcome contributions! Please see our [Contributing Guidelines](CONTRIBUTING.md) for more information.
