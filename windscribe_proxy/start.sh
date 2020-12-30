#!/bin/sh
echo "Starting SSH Server"
service ssh start
exec /home/wss/docker-entrypoint.sh "$@"
