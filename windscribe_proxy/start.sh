
ping -c1 google.com
if [ $? -eq 0 ]
then
  echo "Internet good"
fi
echo "Starting SSH Server"
/etc/init.d/ssh restart
echo "SSH Status"
/etc/init.d/ssh status
exec /home/wss/docker-entrypoint.sh "$@"
