# CLI Tools

Bridge includes shell scripts for sending messages from any terminal or CI/CD pipeline.

## bridge.sh

The main CLI tool. Set `BRIDGE_SESSION` env var or `~/.bridge-session` file first.

```bash
export BRIDGE_SESSION="your-session-id"

# Send notifications
./scripts/bridge.sh notify "Build completed!"
./scripts/bridge.sh success "All tests passing"
./scripts/bridge.sh error "API is down"

# Ask the user something
./scripts/bridge.sh ask "Deploy to prod?"

# Read their reply
./scripts/bridge.sh read

# Send status updates
./scripts/bridge.sh status "Running migrations..."

# Send a summary
./scripts/bridge.sh summary "Refactored auth, added 12 tests, fixed 3 bugs"
```

## notify.sh

Simpler script for one-off notifications:

```bash
./scripts/notify.sh SESSION_ID "Your message" [action]

# Examples
./scripts/notify.sh abc123 "Done!" success
./scripts/notify.sh abc123 "Should I continue?" ask
```

## Integration with Claude Code

Add to your `CLAUDE.md`:

```markdown
When you complete a significant task, notify the user:
./scripts/bridge.sh summary "description of what you did"

When you need a decision:
./scripts/bridge.sh ask "your question"
./scripts/bridge.sh read  # check for reply
```
