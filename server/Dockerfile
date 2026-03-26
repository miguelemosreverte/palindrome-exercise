FROM ghcr.io/pilinux/opencode:1.2.26

USER root

# Create workspace and data directories
RUN mkdir -p /workspaces /data /app && \
    for i in 0 1 2 3 4; do mkdir -p /workspaces/pool-$i /data/pool-$i; done && \
    chmod -R 777 /workspaces /data

# Ensure python3 is available
RUN apt-get update && apt-get install -y python3 curl && rm -rf /var/lib/apt/lists/* || true

# Copy proxy
COPY proxy.js /app/proxy.js

WORKDIR /app

EXPOSE 8080

ENV INSTANCES=3
ENV PORT=8080
ENV PATH="/usr/local/bin:$PATH"

CMD ["/usr/local/bin/node", "/app/proxy.js"]
