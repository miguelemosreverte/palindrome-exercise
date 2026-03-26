FROM ghcr.io/pilinux/opencode:1.2.26

USER root

# Install Python for code execution
RUN apt-get update && apt-get install -y python3 curl && rm -rf /var/lib/apt/lists/* || true

# Create workspace and data directories
RUN mkdir -p /workspaces /data /app && \
    for i in 0 1 2 3 4; do mkdir -p /workspaces/pool-$i /data/pool-$i; done && \
    chmod -R 777 /workspaces /data

# Copy proxy — uses /usr/local/bin/opencode (confirmed in pilinux image)
COPY proxy.js /app/proxy.js

WORKDIR /app

EXPOSE 8080

ENV INSTANCES=3
ENV PORT=8080

# Use the full opencode path from pilinux image
CMD ["/usr/local/bin/node", "/app/proxy.js"]
