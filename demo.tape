# vhs tape — git-context-mcp demo (runs locally on macOS).
# Render: vhs demo.tape  →  demo.gif

Output demo.gif

Set FontSize 14
Set Width 1180
Set Height 720
Set Theme "GitHub Dark"
Set TypingSpeed 24ms
Set Padding 14
Set Framerate 24

# Title
Type "# git-context-mcp — semantic git queries with Claude"
Sleep 1500ms
Enter
Sleep 400ms

# Verify wired
Type "claude mcp list 2>&1 | grep git-context"
Sleep 400ms
Enter
Sleep 2500ms

# Q1: who owns this file?
Type "# 1) Who owns src/git.ts?"
Enter
Sleep 600ms
Type `claude --print --permission-mode bypassPermissions "Use git-context who_touched file=src/git.ts. One short line per top author with line count."`
Sleep 400ms
Enter
Sleep 14s

# Q2: what was changed today
Type "# 2) What did I work on this week?"
Enter
Sleep 600ms
Type `claude --print --permission-mode bypassPermissions "Use git-context recent_work. Two-line summary plus a bullet per commit."`
Sleep 400ms
Enter
Sleep 14s

# Q3: full context for a commit
Type "# 3) Tell me about the last commit"
Enter
Sleep 600ms
Type `claude --print --permission-mode bypassPermissions "Use git-context commit_context for HEAD. Subject, files changed, insertions/deletions, related issues."`
Sleep 400ms
Enter
Sleep 14s

# Q4: co-change suggestion
Type "# 4) If I edit src/git.ts, what else should I check?"
Enter
Sleep 600ms
Type `claude --print --permission-mode bypassPermissions "Use git-context co_change file=src/git.ts threshold=1 limit=5. Bullet list."`
Sleep 400ms
Enter
Sleep 12s

# Outro
Type "# Local git + optional GH API. MIT."
Sleep 2500ms
Enter
Sleep 1200ms
