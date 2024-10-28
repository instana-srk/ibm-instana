# Use a Node.js base image
FROM node:16

# Set the working directory
WORKDIR /opt/server

# Copy package.json and server.js to the container
COPY package.json .
COPY server.js .

# Install dependencies as root user
RUN npm install --omit=dev

# Add a non-root user and switch to it
RUN useradd -m roboshop
USER roboshop

# Copy the application files to the non-root user's directory
COPY --chown=roboshop:roboshop . .

# Expose the port the app runs on
EXPOSE 8080

# Start the application
CMD ["node", "server.js"]
