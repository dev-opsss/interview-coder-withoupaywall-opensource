# CodeInterviewAssist

> ## ⚠️ IMPORTANT NOTICE TO THE COMMUNITY ⚠️
> 
> **This is a free, open-source initiative - NOT a full-service product!**
> 
> There are numerous paid interview preparation tools charging hundreds of dollars for comprehensive features like live audio capture, automated answer generation, and more. This project is fundamentally different:
> 
> - This is a **small, non-profit, community-driven project** with zero financial incentive behind it
> - The entire codebase is freely available for anyone to use, modify, or extend
> - Want features like voice support? You're welcome to integrate tools like OpenAI's Whisper or other APIs
> - New features should come through **community contributions** - it's unreasonable to expect a single maintainer to implement premium features for free
> - The maintainer receives no portfolio benefit, monetary compensation, or recognition for this work
> 
> **Before submitting feature requests or expecting personalized support, please understand this project exists purely as a community resource.** If you value what's been created, the best way to show appreciation is by contributing code, documentation, or helping other users.

> ## 🔑 API KEY INFORMATION - UPDATED
>
> We have tested and confirmed that **both Gemini and OpenAI APIs work properly** with the current version. If you are experiencing issues with your API keys:
>
> - Try deleting your API key entry from the config file located in your user data directory
> - Log out and log back in to the application
> - Check your API key dashboard to verify the key is active and has sufficient credits
> - Ensure you're using the correct API key format (OpenAI keys start with "sk-")
>
> The configuration file is stored at: `C:\Users\[USERNAME]\AppData\Roaming\interview-coder-v1\config.json` (on Windows) or `/Users/[USERNAME]/Library/Application Support/interview-coder-v1/config.json` (on macOS)

## Free, Open-Source AI-Powered Interview Preparation Tool

This project provides a powerful alternative to premium coding interview platforms. It delivers the core functionality of paid interview preparation tools but in a free, open-source package. Using your own OpenAI API key, you get access to advanced features like AI-powered problem analysis, solution generation, and debugging assistance - all running locally on your machine.

### Why This Exists

The best coding interview tools are often behind expensive paywalls, making them inaccessible to many students and job seekers. This project provides the same powerful functionality without the cost barrier, letting you:

- Use your own API key (pay only for what you use)
- Run everything locally on your machine with complete privacy
- Make customizations to suit your specific needs
- Learn from and contribute to an open-source tool

### Customization Possibilities

The codebase is designed to be adaptable:

- **AI Models**: Though currently using OpenAI's models, you can modify the code to integrate with other providers like Claude, Deepseek, Llama, or any model with an API. All integration code is in `electron/ProcessingHelper.ts` and UI settings are in `src/components/Settings/SettingsDialog.tsx`.
- **Languages**: Add support for additional programming languages
- **Features**: Extend the functionality with new capabilities 
- **UI**: Customize the interface to your preferences

All it takes is modest JavaScript/TypeScript knowledge and understanding of the API you want to integrate.

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
- Start New Problem: [Control or Cmd + R]
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
    2. Ensure that CodeInterviewAssist (or the Terminal/IDE you run it from) has screen recording permission enabled.
    3. **Microphone Permission**: When features using audio input (like potential future voice interaction) are used for the first time, macOS will prompt for microphone access. You **must grant this permission** for audio capture to function.
    4. Restart CodeInterviewAssist after enabling permissions.
    5. **Note on Audio Source**: The initial native macOS audio capture implementation (if used) sources audio from the default **microphone input**. It does **not** require installing virtual audio devices like BlackHole for this specific functionality.
  - On Windows:
    - No additional permissions needed
  - On Linux:
    - May require `xhost` access depending on your distribution

## Running the Application

### Quick Start

1. Clone the repository:

```bash
git clone https://github.com/greeneu/interview-coder-withoupaywall-opensource.git
cd interview-coder-withoupaywall-opensource
```

2. Install dependencies:

```bash
npm install
```

3. **RECOMMENDED**: Clean any previous builds:

```bash
npm run clean
```

4. Run the appropriate script for your platform:

**For Windows:**
```bash
stealth-run.bat
```

**For macOS/Linux:**
```bash
# Make the script executable first
chmod +x stealth-run.sh
./stealth-run.sh
```

# Developer Note (macOS): Building the application from source on macOS requires Xcode and its Command Line Tools (install via `xcode-select --install`). End-users running pre-built packages do not need this.

**IMPORTANT**: The application window will be invisible by default! Use Ctrl+B (or Cmd+B on Mac) to toggle visibility.

### Building Distributable Packages

To create installable packages for distribution:

**For macOS (DMG):**
```bash
# Using npm
npm run package-mac

# Or using yarn
yarn package-mac
```

**For Windows (Installer):**
```bash
# Using npm
npm run package-win

# Or using yarn
yarn package-win
```

The packaged applications will be available in the `release` directory.

**What the scripts do:**
- Create necessary directories for the application
- Clean previous builds to ensure a fresh start
- Build the application in production mode
- Launch the application in invisible mode

### Notes & Troubleshooting

- **Window Manager Compatibility**: Some window management tools (like Rectangle Pro on macOS) may interfere with the app's window movement. Consider disabling them temporarily.

- **API Usage**: Be mindful of your OpenAI API key's rate limits and credit usage. Vision API calls are more expensive than text-only calls.

- **LLM Customization**: You can easily customize the app to include LLMs like Claude, Deepseek, or Grok by modifying the API calls in `ProcessingHelper.ts` and related UI components.

- **Common Issues**:
  - Run `npm run clean` before starting the app for a fresh build
  - Use Ctrl+B/Cmd+B multiple times if the window doesn't appear
  - Adjust window opacity with Ctrl+[/]/Cmd+[/] if needed
  - For macOS: ensure script has execute permissions (`chmod +x stealth-run.sh`)

## Comparison with Paid Interview Tools

| Feature | Premium Tools (Paid) | CodeInterviewAssist (This Project) |
|---------|------------------------|----------------------------------------|
| Price | $60/month subscription | Free (only pay for your API usage) |
| Solution Generation | ✅ | ✅ |
| Debugging Assistance | ✅ | ✅ |
| Invisibility | ✅ | ✅ |
| Multi-language Support | ✅ | ✅ |
| Time/Space Complexity Analysis | ✅ | ✅ |
| Window Management | ✅ | ✅ |
| Auth System | Required | None (Simplified) |
| Payment Processing | Required | None (Use your own API key) |
| Privacy | Server-processed | 100% Local Processing |
| Customization | Limited | Full Source Code Access |
| Model Selection | Limited | Choice Between Models |

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
   - Start a new problem using [Control or Cmd + R]

6. **Language Selection

   - Easily switch between programming languages with a single click
   - Use arrow keys for keyboard navigation through available languages
   - The system dynamically adapts to any languages added or removed from the codebase
   - Your language preference is saved between sessions

## Adding More AI Models

This application is built with extensibility in mind. You can easily add support for additional LLMs alongside the existing OpenAI integration:

- You can add Claude, Deepseek, Grok, or any other AI model as alternative options
- The application architecture allows for multiple LLM backends to coexist
- Users can have the freedom to choose their preferred AI provider

To add new models, simply extend the API integration in `electron/ProcessingHelper.ts` and add the corresponding UI options in `src/components/Settings/SettingsDialog.tsx`. The modular design makes this straightforward without disrupting existing functionality.

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

## Disclaimer and Ethical Usage

This tool is intended as a learning aid and practice assistant. While it can help you understand problems and solution approaches during interviews, consider these ethical guidelines:

- Be honest about using assistance tools if asked directly in an interview
- Use this tool to learn concepts, not just to get answers
- Recognize that understanding solutions is more valuable than simply presenting them
- In take-home assignments, make sure you thoroughly understand any solutions you submit

Remember that the purpose of technical interviews is to assess your problem-solving skills and understanding. This tool works best when used to enhance your learning, not as a substitute for it.

## Support and Questions

If you have questions or need support, please open an issue on the GitHub repository.

---

> **Remember:** This is a community resource. If you find it valuable, consider contributing rather than just requesting features. The project grows through collective effort, not individual demands.

# Google Speech API Integration with gRPC

This project implements an efficient Google Speech API integration for the application using gRPC. It provides both streaming and non-streaming speech recognition with optimized performance.

## Features

- Real-time streaming transcription with Google Speech API
- Efficient gRPC communication for low-latency results
- Error handling with automatic retry logic
- Rate limiting to prevent quota exhaustion
- Support for multiple authentication methods
- Electron IPC bridge for renderer/main process communication
- React component for easy integration

## Setup

### 1. Authentication

You have three options for authentication:

#### Option A: API Key (simplest, but limited features)

1. Get a Google Cloud API key from the Google Cloud Console
2. Add it to your application settings or environment variables:
   ```
   GOOGLE_API_KEY=your_api_key
   ```

#### Option B: Service Account (recommended for production)

1. Create a service account in Google Cloud Console with the "Speech-to-Text User" role:
   - Go to Google Cloud Console → IAM & Admin → Service Accounts
   - Click "Create Service Account"
   - Enter a name (e.g., "speech-to-text-client") and description
   - Click "Create and Continue"
   - Add the "Speech-to-Text User" role (roles/speech.client)
   - Click "Continue" and then "Done"

2. Create and download credentials:
   - Find your new service account in the list
   - Click on the service account name to open its details
   - Go to the "Keys" tab
   - Click "Add Key" → "Create new key"
   - Select "JSON" format and click "Create"
   - The key file will be downloaded automatically

3. Upload the credentials in the application:
   - Open the application settings
   - Go to "Speech Recognition" tab
   - Click "Configure Service Account"
   - Either upload the JSON file or paste its contents
   - Your credentials will be securely encrypted and stored

4. Alternatively, set the path to your credentials file as an environment variable:
   ```
   GOOGLE_APPLICATION_CREDENTIALS=/path/to/your-credentials.json
   ```

#### Option C: Application Default Credentials

1. Install Google Cloud SDK
2. Run `gcloud auth application-default login`
3. The service will use your logged-in credentials

### 2. Enable Google Speech API

1. Go to Google Cloud Console
2. Navigate to "APIs & Services" > "Library"
3. Search for "Speech-to-Text API" and enable it
4. Make sure your account has billing enabled

### 3. Security Considerations

The application implements several security measures for protecting your credentials:

- **Encryption**: Service account JSON is encrypted before storage using AES-256-CTR
- **Machine-specific Key**: The encryption key is derived from a unique machine identifier
- **Isolated Storage**: Credentials are stored separately from other application data
- **Memory Protection**: Credentials are only decrypted when needed, not kept in memory

### 4. Install Dependencies

The application handles dependencies automatically. When first installing or updating:

```bash
npm install
```

This will trigger the postinstall script that rebuilds native modules for Electron compatibility.

## Usage

### Basic Usage with React Component

```jsx
import SpeechRecognition from './components/SpeechRecognition';

function App() {
  const handleTranscription = (text, isFinal) => {
    console.log(`Transcription (${isFinal ? 'final' : 'interim'}): ${text}`);
  };

  const handleError = (error) => {
    console.error('Speech recognition error:', error);
  };

  return (
    <div className="app">
      <h1>Speech Recognition Demo</h1>
      <SpeechRecognition 
        onTranscription={handleTranscription}
        onError={handleError}
        language=""
        maxDuration={120}
      />
    </div>
  );
}
```

### Direct API Usage

```typescript
import { appServices } from './electron/main';

// Get access to the speech service
const speechService = appServices.speechBridge.speechService;

// Start streaming recognition
speechService.startStreamingTranscription((text, isFinal) => {
  console.log(`Transcription: ${text} (${isFinal ? 'Final' : 'Interim'})`);
});

// Send audio chunks
speechService.sendAudioChunk(audioBuffer);

// Stop streaming
speechService.stopStreamingTranscription();

// One-off transcription
const result = await speechService.transcribeAudio(audioBuffer, 'audio/wav');
console.log('Transcription result:', result);
```

## Advanced Configuration

You can customize the speech recognition behavior by modifying the configuration in the `GoogleSpeechService` class:

- Change recognition models for different scenarios (video, phone_call, etc.)
- Adjust sample rates and encoding formats
- Configure language detection
- Customize retry logic and rate limiting

## Troubleshooting

- **Authentication Errors**: 
  - Verify your API key or service account credentials are valid
  - Check if your service account has the "Speech-to-Text User" role
  - Ensure your project has billing enabled

- **Quota Errors**: 
  - You may have exceeded your Google Cloud quota
  - Check your usage in the Google Cloud Console
  - Consider upgrading your quota if needed

- **Audio Format Issues**: 
  - Ensure your audio is in a supported format (LINEAR16, FLAC, etc.)
  - Check sample rate (16000Hz is recommended)
  - Verify your audio isn't corrupted

- **Network Errors**: 
  - Check your internet connection
  - Verify firewall settings allow outbound connections to Google APIs
  - The application will automatically retry on temporary network issues

- **Electron Integration Issues**:
  - If you encounter native module errors, run:
    ```bash
    npm run rebuild-speech
    ```
  - This rebuilds the Speech API modules for Electron

## License

MIT
