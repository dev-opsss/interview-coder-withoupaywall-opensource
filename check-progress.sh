#!/bin/bash

# 📊 Progress Checker for LockedIn AI Feature Parity

echo "📊 LockedIn AI Feature Parity Progress"
echo "======================================"

if [ ! -f "LOCKEDIN_AI_FEATURES_TODO.md" ]; then
    echo "❌ TODO file not found!"
    exit 1
fi

# Count progress (main features only, marked with **)
completed=$(grep -c "^\- \[x\] \*\*" LOCKEDIN_AI_FEATURES_TODO.md)
remaining=$(grep -c "^\- \[ \] \*\*" LOCKEDIN_AI_FEATURES_TODO.md)
total=$((completed + remaining))

if [ $total -eq 0 ]; then
    echo "❌ No tasks found in TODO file"
    exit 1
fi

# Calculate percentage
percentage=$((completed * 100 / total))

echo ""
echo "📈 Overall Progress:"
echo "   Completed: $completed"
echo "   Remaining: $remaining" 
echo "   Total: $total"
echo "   Progress: $percentage%"

# Progress bar
echo ""
echo -n "   "
bar_length=40
filled_length=$((percentage * bar_length / 100))

for ((i=0; i<bar_length; i++)); do
    if [ $i -lt $filled_length ]; then
        echo -n "█"
    else
        echo -n "░"
    fi
done
echo " $percentage%"

# Show current sprint if available
echo ""
echo "🎯 Current Sprint Status:"
if grep -q "CURRENT SPRINT" LOCKEDIN_AI_FEATURES_TODO.md; then
    grep -A 5 "CURRENT SPRINT" LOCKEDIN_AI_FEATURES_TODO.md | head -n 5
else
    echo "   No current sprint defined"
fi

# Show recent completions (main features only)
echo ""
echo "✅ Recent Completions:"
recent_completed=$(grep "^\- \[x\] \*\*" LOCKEDIN_AI_FEATURES_TODO.md | tail -n 3)
if [ -n "$recent_completed" ]; then
    echo "$recent_completed" | sed 's/^/   /'
else
    echo "   No completed tasks yet"
fi

# Show next tasks (main features only)
echo ""
echo "📋 Next Tasks:"
next_tasks=$(grep "^\- \[ \] \*\*" LOCKEDIN_AI_FEATURES_TODO.md | head -n 3)
if [ -n "$next_tasks" ]; then
    echo "$next_tasks" | sed 's/^/   /'
else
    echo "   All tasks completed! 🎉"
fi

echo ""
echo "🚀 Keep up the great work!"
