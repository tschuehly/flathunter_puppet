echo "Starting SSH Server"
/etc/init.d/ssh restart
echo "SSH Status"
/etc/init.d/ssh status
exec /home/wss/docker-entrypoint.sh "$@"
