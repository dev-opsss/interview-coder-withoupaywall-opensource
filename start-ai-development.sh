#!/bin/bash

# 🤖 AI-Assisted Development Starter Script
# This script helps you start working on LockedIn AI features with AI assistance

echo "🚀 Interview Coder - AI-Assisted Development"
echo "=============================================="

# Function to display current TODO status
show_todo_status() {
    echo ""
    echo "📊 Current Progress:"
    local completed=$(grep -c "\[x\]" LOCKEDIN_AI_FEATURES_TODO.md 2>/dev/null || echo "0")
    local remaining=$(grep -c "\[ \]" LOCKEDIN_AI_FEATURES_TODO.md 2>/dev/null || echo "0")
    local total=$((completed + remaining))
    
    if [ $total -gt 0 ]; then
        local percentage=$((completed * 100 / total))
        echo "   Completed: $completed/$total ($percentage%)"
    else
        echo "   No TODO file found - creating initial setup..."
    fi
    echo ""
}

# Function to suggest next task
suggest_next_task() {
    echo "🎯 Recommended Next Tasks (Phase 1):"
    echo ""
    echo "1. Resume Analyzer Service (HIGH PRIORITY)"
    echo "   - Quick win, builds momentum"
    echo "   - Files: src/services/resumeAnalyzer.ts, src/types/resume.ts"
    echo "   - Estimated time: 4-6 hours"
    echo ""
    echo "2. Performance Tracker Service (HIGH PRIORITY)" 
    echo "   - Foundation for progress tracking"
    echo "   - Files: src/services/performanceTracker.ts, src/types/performance.ts"
    echo "   - Estimated time: 3-4 hours"
    echo ""
    echo "3. STAR Method Builder (HIGH PRIORITY)"
    echo "   - Core behavioral interview feature"
    echo "   - Files: src/components/Behavioral/STARBuilder.tsx"
    echo "   - Estimated time: 5-7 hours"
    echo ""
}

# Function to create AI prompt for task
create_ai_prompt() {
    local task_name="$1"
    echo ""
    echo "🤖 AI Prompt for '$task_name':"
    echo "================================"
    echo ""
    
    case "$task_name" in
        "resume")
            cat << 'EOF'
I need to create a ResumeAnalyzer service for the Interview Coder app.

Context:
- TypeScript/React/Electron app
- Existing patterns in src/services/googleSpeechService.ts
- Need to integrate with OpenAI/Gemini APIs via window.electronAPI.handleAiQuery()
- Follow existing error handling patterns

Requirements:
- ATS compatibility scoring (1-100 scale)
- Keyword matching against job descriptions
- Formatting issue detection (spacing, fonts, sections)
- Improvement suggestions generation
- Support for text resume input
- Integration with existing AI API patterns

Please provide:
1. Complete ResumeAnalyzer service class with TypeScript
2. ATSReport interface definition
3. Error handling for API failures
4. Integration with existing window.electronAPI patterns
5. Methods for: analyzeForATS(), suggestImprovements(), extractKeywords()
EOF
            ;;
        "performance")
            cat << 'EOF'
I need to create a PerformanceTracker service for the Interview Coder app.

Context:
- TypeScript/React/Electron app
- Need to store interview session data locally
- Integration with existing ConfigHelper patterns
- Track user progress over time

Requirements:
- Store interview session data (questions, responses, scores)
- Calculate progress trends and improvements
- Identify weakness areas
- Generate progress reports
- Data persistence using existing patterns

Please provide:
1. Complete PerformanceTracker service class
2. InterviewSession and ProgressData interfaces
3. Methods for: recordSession(), getProgressReport(), getWeakAreas()
4. Integration with existing data storage patterns
5. Trend calculation algorithms
EOF
            ;;
        "star")
            cat << 'EOF'
I need to create a STARBuilder component for the Interview Coder app.

Context:
- TypeScript React app with Tailwind CSS
- Dark theme consistent with existing UI
- Follow patterns from src/components/Settings/SettingsDialog.tsx
- STAR = Situation, Task, Action, Result framework

Requirements:
- Guided input forms for each STAR component
- AI-powered response generation
- Story bank storage and retrieval
- Export generated responses
- Integration with existing voice transcription

Please provide:
1. Complete STARBuilder React component with TypeScript
2. STAR interface definitions
3. Form handling with validation
4. AI integration for response enhancement
5. Tailwind CSS styling (dark theme)
6. Accessibility features (ARIA labels, keyboard navigation)
EOF
            ;;
        *)
            echo "Available tasks: resume, performance, star"
            ;;
    esac
    echo ""
}

# Function to setup development environment
setup_dev_env() {
    echo "🛠 Setting up development environment..."
    
    # Check if node_modules exists
    if [ ! -d "node_modules" ]; then
        echo "   Installing dependencies..."
        npm install
    else
        echo "   ✅ Dependencies already installed"
    fi
    
    # Create necessary directories
    echo "   Creating directory structure..."
    mkdir -p src/services
    mkdir -p src/types
    mkdir -p src/components/Resume
    mkdir -p src/components/Dashboard
    mkdir -p src/components/Behavioral
    mkdir -p src/components/MockInterview
    
    echo "   ✅ Development environment ready"
}

# Function to start development servers
start_dev_servers() {
    echo ""
    echo "🚀 Starting development servers..."
    echo ""
    echo "Run these commands in separate terminals:"
    echo ""
    echo "Terminal 1 (React Dev Server):"
    echo "   npm run dev"
    echo ""
    echo "Terminal 2 (Electron):"
    echo "   npm run electron:dev"
    echo ""
    echo "Or use the combined command:"
    echo "   npm run dev:electron"
    echo ""
}

# Function to create feature branch
create_feature_branch() {
    local feature_name="$1"
    if [ -z "$feature_name" ]; then
        echo "Usage: create_feature_branch <feature_name>"
        return 1
    fi
    
    echo "🌿 Creating feature branch: feature/$feature_name"
    git checkout -b "feature/$feature_name" 2>/dev/null || {
        echo "   Branch already exists or git error"
        git checkout "feature/$feature_name" 2>/dev/null
    }
    echo "   ✅ Ready to work on: $feature_name"
}

# Main menu
main_menu() {
    while true; do
        echo ""
        echo "Choose an option:"
        echo "1. Show TODO status"
        echo "2. Get task suggestions"
        echo "3. Generate AI prompt for task"
        echo "4. Setup development environment"
        echo "5. Create feature branch"
        echo "6. Start development servers"
        echo "7. Open AI Workflow Guide"
        echo "8. Exit"
        echo ""
        read -p "Enter choice (1-8): " choice
        
        case $choice in
            1)
                show_todo_status
                ;;
            2)
                suggest_next_task
                ;;
            3)
                echo ""
                echo "Available tasks: resume, performance, star"
                read -p "Enter task name: " task
                create_ai_prompt "$task"
                ;;
            4)
                setup_dev_env
                ;;
            5)
                read -p "Enter feature name (e.g., resume-analyzer): " feature
                create_feature_branch "$feature"
                ;;
            6)
                start_dev_servers
                ;;
            7)
                if command -v code &> /dev/null; then
                    code AI_WORKFLOW_GUIDE.md
                elif command -v open &> /dev/null; then
                    open AI_WORKFLOW_GUIDE.md
                else
                    echo "Please open AI_WORKFLOW_GUIDE.md in your editor"
                fi
                ;;
            8)
                echo "Happy coding! 🚀"
                exit 0
                ;;
            *)
                echo "Invalid choice. Please try again."
                ;;
        esac
    done
}

# Check if we're in the right directory
if [ ! -f "package.json" ] || [ ! -f "electron/main.ts" ]; then
    echo "❌ Error: Please run this script from the Interview Coder root directory"
    exit 1
fi

# Show initial status and start menu
show_todo_status
suggest_next_task
main_menu
