FROM node:20-alpine
RUN apk add --no-cache bash

RUN mkdir -p /opt/server && \
    adduser -D -h /opt/server roboshop && \
    chown roboshop:roboshop -R /opt/server


WORKDIR /opt/server

COPY package.json .
COPY server.js .


RUN npm install --omit=dev


RUN chmod -R 755 /opt/server/node_modules


USER roboshop


EXPOSE 8080


CMD ["node", "server.js"]
