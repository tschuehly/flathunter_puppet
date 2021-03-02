now=$(date +"%Y-%m-%d %T")
now2=$(date --date="10 minutes ago" +"%Y-%m-%d %T")
log=$(tail log/log.txt -n 1 | cut -c 1-19)
echo $now
echo $now2
echo $log

if [[ "$now2" < "$log" ]]; then
  echo "log is newer than now2"
else
  exit 1
fi
