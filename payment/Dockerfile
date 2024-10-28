FROM python:alpine3.19


RUN apk add --no-cache \
        build-base \
        pcre-dev \
        libffi-dev \
    && pip3 install uwsgi setuptools \
    && adduser --home /opt/server --disabled-password roboshop \
    && mkdir -p /opt/server \
    && chown roboshop:roboshop -R /opt/server


WORKDIR /opt/server
USER roboshop


COPY --chown=roboshop:roboshop payment.ini payment.py rabbitmq.py requirements.txt ./
RUN pip3 install -r requirements.txt


EXPOSE 8080
CMD ["uwsgi", "--ini", "payment.ini"]
