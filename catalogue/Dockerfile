# Base image
FROM node:20-alpine
RUN apk add --no-cache bash

# Create directory and user
RUN mkdir -p /opt/server && \
    adduser -D -h /opt/server roboshop && \
    chown roboshop:roboshop -R /opt/server

# Set working directory
WORKDIR /opt/server

# Copy application files
COPY package.json .
COPY server.js .

# Install dependencies
RUN npm install --omit=dev

# Grant roboshop user permission to write to Instana modules in node_modules
RUN chown -R roboshop:roboshop /opt/server/node_modules && \
    chmod -R 775 /opt/server/node_modules/@instana

# Switch to non-root user
USER roboshop


# Expose port
EXPOSE 8080

# Start application
CMD ["node", "server.js"]
