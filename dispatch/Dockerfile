FROM golang:alpine3.20
RUN adduser -D roboshop \
    && mkdir -p /opt/server \
    && chown roboshop:roboshop /opt/server
WORKDIR /opt/server
COPY --chown=roboshop:roboshop main.go ./
RUN go mod init dispatch \
    && go get \
    && go build -o dispatch
USER roboshop
EXPOSE 8080
CMD ["./dispatch"]