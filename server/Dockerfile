FROM ghcr.io/pilinux/opencode:1.2.26

USER root

# Create directories
RUN mkdir -p /app /tmp/workspace-0 /tmp/workspace-1 /tmp/workspace-2 /tmp/workspace-3 /tmp/workspace-4 \
             /tmp/data-0 /tmp/data-1 /tmp/data-2 /tmp/data-3 /tmp/data-4 && \
    chmod -R 777 /tmp

# Copy proxy
COPY proxy.js /app/proxy.js

EXPOSE 8080

ENV INSTANCES=3
ENV PORT=8080
ENV PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

# Use the opencode wrapper which knows how to find the right binary
CMD ["node", "/app/proxy.js"]
