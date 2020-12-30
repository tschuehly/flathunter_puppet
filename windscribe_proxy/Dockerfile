FROM concisions/windscribe-socks-server
RUN apt-get update -y
RUN apt-get install openssh-server sudo -y
RUN useradd -rm -d /home/ubuntu -s /bin/bash -g root -G sudo -u 1000 flathunter
RUN  echo 'flathunter:36jqU7w8AWejGcGyQKvYXxyU1cNpIB9QCSstR2XIPKiU5txSTwWnkYMQ' | chpasswd
RUN service ssh start
WORKDIR /home/wss
RUN ls -la
COPY start.sh /home/wss/
EXPOSE 22
CMD ["sh","/home/wss/start.sh"]
