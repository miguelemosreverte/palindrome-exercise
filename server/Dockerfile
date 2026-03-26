FROM node:22-slim

# Install OpenCode + Python
RUN npm install -g opencode@latest
RUN apt-get update && apt-get install -y python3 python3-pip curl git && rm -rf /var/lib/apt/lists/*

# Create workspace and data directories
RUN mkdir -p /workspaces /data /app

# Copy proxy
COPY proxy.js /app/proxy.js

WORKDIR /app

# Expose the proxy port
EXPOSE 8080

# Default: 3 instances
ENV INSTANCES=3
ENV PORT=8080

# Start the proxy (which starts N OpenCode instances)
CMD ["node", "/app/proxy.js"]
