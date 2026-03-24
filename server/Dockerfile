FROM node:22-slim

# Install OpenCode
RUN npm install -g opencode@latest

# Install Python (for OpenCode's code execution)
RUN apt-get update && apt-get install -y python3 python3-pip curl git && rm -rf /var/lib/apt/lists/*

# Create user workspaces
RUN mkdir -p /workspaces

WORKDIR /workspaces

# Expose the web UI port
EXPOSE 8080

# Start OpenCode web server, listening on all interfaces
CMD ["opencode", "web", "--port", "8080", "--hostname", "0.0.0.0"]
