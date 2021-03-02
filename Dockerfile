FROM buildkite/puppeteer

COPY package.json /flathunter/
WORKDIR flathunter
RUN npm i

COPY dist/flathunter.js /flathunter/
COPY healthcheck.sh /flathunter/healthcheck.sh
COPY config /flathunter/config
RUN mkdir /flathunter/err/
CMD ["npm","run","docker-start"]
HEALTHCHECK --interval=60s --timeout=10s --start-period=15s --retries=3 CMD "/flathunter/healthcheck.sh"
