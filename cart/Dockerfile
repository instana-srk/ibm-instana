# Base image
FROM node:20-alpine

# Install bash if needed
RUN apk add --no-cache bash

# Create directory and user
RUN mkdir -p /opt/server && \
    adduser -D -h /opt/server roboshop && \
    chown roboshop:roboshop -R /opt/server

# Set working directory
WORKDIR /opt/server

# Copy package files and install dependencies
COPY package.json  ./
RUN npm install --omit=dev

# Copy application files
COPY server.js .

# Grant roboshop user permission to write to Instana modules if necessary
RUN chown -R roboshop:roboshop /opt/server/node_modules && \
    chmod -R 775 /opt/server/node_modules/@instana

# Switch to non-root user
USER roboshop

# Expose port
EXPOSE 8080

# Start application
CMD ["node", "server.js"]