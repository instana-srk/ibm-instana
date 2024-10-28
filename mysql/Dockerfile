FROM mysql:8.0
COPY app-user.sql /docker-entrypoint-initdb.d/
COPY schema.sql /docker-entrypoint-initdb.d/
COPY master-data.sql /docker-entrypoint-initdb.d/
