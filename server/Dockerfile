FROM ghcr.io/pilinux/opencode:1.2.26

USER root

# Install Node.js for the proxy
RUN apt-get update && apt-get install -y nodejs python3 curl && rm -rf /var/lib/apt/lists/*

# Create workspace and data directories
RUN mkdir -p /workspaces /data /app && \
    for i in 0 1 2 3 4; do mkdir -p /workspaces/pool-$i /data/pool-$i; done && \
    chmod -R 777 /workspaces /data

# Copy proxy
COPY proxy.js /app/proxy.js

WORKDIR /app

EXPOSE 8080

ENV INSTANCES=3
ENV PORT=8080

CMD ["node", "/app/proxy.js"]
